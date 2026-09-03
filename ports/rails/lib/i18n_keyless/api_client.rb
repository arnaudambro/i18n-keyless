# frozen_string_literal: true

require "json"
require "net/http"
require "openssl"
require "uri"

module I18nKeyless
  # The three routes of the i18n-keyless wire format this gem uses, with the
  # network policy of the SDKs (conformance/vectors/backoff.json and
  # retry-decision.json): a per-attempt timeout, three attempts with fixed
  # backoff delays on a network error, a timeout, a 429, a 5xx or an unparsable
  # 200 body; no retry on any other status; nothing ever raised.
  #
  # Usage analytics (POST /translate/last-used-translations) follow the node
  # SDK: the cumulative map is POSTed, at most once every 10 s.
  class ApiClient
    # Sent as the `Version` header (the wire dialect: v3 language codes).
    VERSION = I18nKeyless::VERSION

    # Sent as the `sdk` header. `rails` is registered on the API as a server
    # label, counted like `node`: a server sends no `unique_id`, the API counts
    # it by its source connection, which the client cannot shape.
    SDK = "rails"

    DEFAULT_URL = "https://api.i18n-keyless.com"

    ACTION_PARSE_BODY = "parse-body"
    ACTION_NOT_MODIFIED = "not-modified"
    ACTION_FAIL = "fail"
    ACTION_RETRY = "retry"

    # A network error or a timeout is transient and retried; any other
    # exception ends the call now.
    TRANSIENT_ERRORS = [
      Timeout::Error, SocketError, SystemCallError, EOFError, IOError, OpenSSL::SSL::SSLError
    ].freeze

    Dictionary = Struct.new(:ok, :not_modified, :translations, :etag, :error, keyword_init: true)
    UsageResult = Struct.new(:ok, :sent, :error, keyword_init: true)
    Outcome = Struct.new(:action, :error, :response, :json, keyword_init: true)

    attr_reader :api_key, :api_url, :timeout, :retry_delays, :concurrency
    # The backoff sleep, `->(ms) { sleep(ms / 1000.0) }`. Tests replace it.
    attr_accessor :sleeper

    # @param retry_delays [Array<Integer>] milliseconds between attempts (two entries: three attempts)
    # @param sleeper [#call] receives a number of milliseconds; replaced in tests
    def initialize(api_key:, api_url: DEFAULT_URL, timeout: 10, retry_delays: [500, 1500], concurrency: 30,
                   logger: nil, sleeper: nil)
      @api_key = api_key.to_s
      @api_url = api_url.to_s.sub(%r{/+\z}, "")
      @api_url = DEFAULT_URL if @api_url.empty?
      @timeout = timeout
      @retry_delays = retry_delays.map(&:to_i)
      @concurrency = [concurrency.to_i, 1].max
      @logger = logger
      @sleeper = sleeper || ->(ms) { sleep(ms / 1000.0) }
    end

    def max_attempts
      retry_delays.length + 1
    end

    # The delay after a failed attempt (1-based), or nil when there is no next attempt.
    def delay_after(failed_attempt)
      retry_delays[failed_attempt - 1]
    end

    # GET /translate/{lang}: the whole dictionary of one language, or a 304
    # when the ETag still matches.
    def fetch_dictionary(lang, namespace, etag, last_refresh = "")
      result = Dictionary.new(ok: false, not_modified: false, translations: {}, etag: nil, error: nil)
      url = dictionary_url(lang, namespace, etag, last_refresh)
      outcome = call { request(:get, url, etag: etag) }
      if outcome.action == ACTION_NOT_MODIFIED
        result.ok = true
        result.not_modified = true
        return result
      end
      if outcome.action != ACTION_PARSE_BODY
        result.error = outcome.error
        warn("fetch all translations error: #{outcome.error}")
        return result
      end
      dictionary_from(outcome.json, outcome.response, result)
    end

    # POST /translate/last-used-translations: the cumulative usage map. An
    # empty map is never sent. Same network policy as every other call.
    def send_usage(primary, usage_by_namespace)
      return UsageResult.new(ok: false, sent: false, error: nil) if usage_by_namespace.empty? || api_key.empty?

      body = { "primaryLanguage" => primary, "translationsUsageByNamespace" => usage_by_namespace }
      outcome = call { request(:post, "#{api_url}/translate/last-used-translations", body: body) }
      if outcome.action != ACTION_PARSE_BODY
        warn("send translations usage error: #{outcome.error}")
        return UsageResult.new(ok: false, sent: true, error: outcome.error)
      end
      json = outcome.json
      warn(json["message"].to_s) if json["message"].to_s != ""
      unless json["ok"]
        error = (json["error"] || "not ok").to_s
        warn("send translations usage error: #{error}")
        return UsageResult.new(ok: false, sent: true, error: error)
      end
      UsageResult.new(ok: true, sent: true, error: nil)
    end

    # POST /translate for every miss, at most `concurrency` at a time. Failed
    # attempts are retried together, one backoff sleep per round.
    #
    # @param misses [Array<Miss>]
    # @param languages [Array<String>] the configured languages (the primary is added)
    # @return [Hash{String => Hash{String => String}, nil}] translations by language, keyed by miss id; nil when the call failed
    def translate(misses, primary, languages)
      results = {}
      pending = {}
      misses.each do |miss|
        pending[miss.id] = miss
        results[miss.id] = nil
      end
      errors = {}
      attempt = 1
      while attempt <= max_attempts && !pending.empty?
        retry_next = {}
        pending.values.each_slice(concurrency) do |chunk|
          responses = post_chunk(chunk, primary, languages)
          chunk.each do |miss|
            outcome = outcome_of(responses.fetch(miss.id) { RuntimeError.new("no response") })
            errors[miss.id] = outcome.error
            if outcome.action == ACTION_PARSE_BODY
              json = self.class.decode_json(outcome.response)
              if json.nil?
                errors[miss.id] = "invalid JSON"
                retry_next[miss.id] = miss
                next
              end
              results[miss.id] = translation_from(json, miss)
              next
            end
            if outcome.action == ACTION_RETRY
              retry_next[miss.id] = miss
              next
            end
            # fail (or a 304 that makes no sense on a POST): give up on this miss now
            warn("translate error for \"#{miss.key}\": #{outcome.error}")
          end
        end
        pending = retry_next
        sleep_after(attempt) unless pending.empty?
        attempt += 1
      end
      pending.each_value do |miss|
        warn("translate error for \"#{miss.key}\": #{errors[miss.id] || 'unknown error'}")
      end
      results
    end

    # The body of one POST /translate (conformance/vectors/translate-request.json).
    def translate_body(miss, primary, languages)
      body = {
        "key" => miss.key,
        "context" => miss.context,
        # The default namespace is omitted on the wire, like the SDKs do.
        "namespace" => miss.namespace == Translator::DEFAULT_NAMESPACE ? nil : miss.namespace,
        # The configured list plus the primary, never the locale that missed: the
        # API stores this list as the project's languages (the react SDK sends its
        # required `supported` list the same way).
        "languages" => (Array(languages) + [primary]).uniq,
        "primaryLanguage" => primary
      }
      body.reject { |_, value| value.nil? || value == "" }
    end

    # What one attempt's answer does to the call. Statuses follow
    # conformance/vectors/retry-decision.json; `error` is the reason phrase
    # when non-empty, else `HTTP <code>`.
    def self.decide(status, reason = nil)
      status = status.to_i
      error = reason.to_s.empty? ? "HTTP #{status}" : reason.to_s
      return Outcome.new(action: ACTION_PARSE_BODY, error: "") if status == 200
      return Outcome.new(action: ACTION_NOT_MODIFIED, error: "") if status == 304
      return Outcome.new(action: ACTION_RETRY, error: error) if status == 429 || status >= 500

      Outcome.new(action: ACTION_FAIL, error: error)
    end

    # A network error or a timeout is transient; the SDKs spell a timeout `timeout`.
    def self.error_for(exception)
      return "timeout" if exception.is_a?(Timeout::Error) || exception.message =~ /timed out|timeout/i

      message = exception.message.to_s
      message.empty? ? exception.class.name : message
    end

    def self.transient?(exception)
      TRANSIENT_ERRORS.any? { |klass| exception.is_a?(klass) }
    end

    def self.decode_json(response)
      json = JSON.parse(response.body.to_s)
      json.is_a?(Hash) ? json : nil
    rescue JSON::ParserError, TypeError
      nil
    end

    # The URL of a bulk fetch (conformance/vectors/dictionary-request.json).
    # With an ETag in hand, freshness travels in If-None-Match and the URL
    # stays stable, so shared HTTP caches can hold it. Without one, the delta
    # cursor travels as `last_refresh`: this gem keeps no cursor and sends it
    # empty, which asks for the whole dictionary.
    def dictionary_url(lang, namespace, etag, last_refresh = "")
      # The default namespace is omitted from the query so a plain install
      # hits the exact same URL as the SDKs.
      namespace_query = namespace == Translator::DEFAULT_NAMESPACE ? "" : "&namespace=#{encode(namespace)}"
      query = if etag
                namespace_query.empty? ? "" : "?#{namespace_query[1..]}"
              else
                "?last_refresh=#{last_refresh.nil? ? 'null' : last_refresh}#{namespace_query}"
              end
      "#{api_url}/translate/#{lang}#{query}"
    end

    # The headers every request carries.
    def headers
      {
        "Content-Type" => "application/json",
        "Accept" => "application/json",
        "Authorization" => "Bearer #{api_key}",
        "Version" => VERSION,
        "sdk" => SDK
      }
    end

    private

    # One call with the shared network policy: up to `max_attempts` attempts,
    # a backoff sleep after each failed one. Ends with `parse-body` (and the
    # decoded JSON), `not-modified`, or `fail` with the last error.
    def call
      error = ""
      (1..max_attempts).each do |attempt|
        outcome = begin
          outcome_of(yield)
        rescue Exception => e # rubocop:disable Lint/RescueException -- nothing ever raises out of a translation
          raise if e.is_a?(NoMemoryError) || e.is_a?(SignalException) || e.is_a?(SystemExit)

          outcome_of(e)
        end
        error = outcome.error
        return outcome if outcome.action == ACTION_NOT_MODIFIED

        if outcome.action == ACTION_PARSE_BODY
          json = self.class.decode_json(outcome.response)
          if json
            outcome.json = json
            return outcome
          end
          # An unparsable 200 body is a failed attempt, retried like a 5xx.
          outcome.action = ACTION_RETRY
          error = "invalid JSON"
        end
        break if outcome.action == ACTION_FAIL

        sleep_after(attempt)
      end
      Outcome.new(action: ACTION_FAIL, error: error, response: nil, json: nil)
    end

    # @return [Hash{String => Net::HTTPResponse, Exception}] keyed by miss id
    def post_chunk(chunk, primary, languages)
      threads = chunk.map do |miss|
        Thread.new do
          Thread.current.report_on_exception = false
          [miss.id, begin
            request(:post, "#{api_url}/translate", body: translate_body(miss, primary, languages))
          rescue Exception => e # rubocop:disable Lint/RescueException
            raise if e.is_a?(NoMemoryError) || e.is_a?(SignalException) || e.is_a?(SystemExit)

            e
          end]
        end
      end
      threads.to_h(&:value)
    end

    def outcome_of(answer)
      if answer.is_a?(Exception)
        return Outcome.new(
          action: self.class.transient?(answer) ? ACTION_RETRY : ACTION_FAIL,
          error: self.class.error_for(answer),
          response: nil
        )
      end
      outcome = self.class.decide(answer.code, answer.message)
      outcome.response = answer
      outcome
    end

    def dictionary_from(json, response, result)
      unless json["ok"]
        result.error = (json["error"] || "not ok").to_s
        warn("fetch all translations error: #{result.error}")
        return result
      end
      warn(json["message"].to_s) if json["message"].to_s != ""
      translations = json.dig("data", "translations")
      result.ok = true
      result.translations = translations.is_a?(Hash) ? translations.select { |_, v| v.is_a?(String) } : {}
      etag = response["ETag"].to_s
      result.etag = etag.empty? ? nil : etag
      result
    end

    def translation_from(json, miss)
      unless json["ok"]
        warn("translate error for \"#{miss.key}\": #{json['error'] || 'not ok'}")
        return nil
      end
      warn(json["message"].to_s) if json["message"].to_s != ""
      translation = json.dig("data", "translation")
      translation.is_a?(Hash) ? translation.select { |_, v| v.is_a?(String) } : {}
    end

    def request(method, url, body: nil, etag: nil)
      uri = URI.parse(url)
      req = method == :get ? Net::HTTP::Get.new(uri) : Net::HTTP::Post.new(uri)
      headers.each { |name, value| req[name] = value }
      req["If-None-Match"] = etag if etag
      req.body = JSON.generate(body) if body
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = timeout
      http.read_timeout = timeout
      http.write_timeout = timeout if http.respond_to?(:write_timeout=)
      http.start { |connection| connection.request(req) }
    end

    def encode(value)
      URI.encode_www_form_component(value).gsub("+", "%20")
    end

    def sleep_after(failed_attempt)
      delay = delay_after(failed_attempt)
      @sleeper.call(delay) if delay && delay.positive?
    end

    def warn(message)
      @logger&.warn("i18n-keyless: #{message}")
    rescue StandardError
      # Logging must never take a translation down.
    end
  end
end

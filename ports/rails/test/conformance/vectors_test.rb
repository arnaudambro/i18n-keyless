# frozen_string_literal: true

require "test_helper"

# Replays the shared conformance vectors of the monorepo (conformance/vectors/*.json).
#
# Not replayed, on purpose: replace.json (placeholders are I18n's `%{name}`),
# storage-keys.json and unique-id.json cases (a device storage contract; a server
# sends no id), the usage-*.json device and custom-handler cases, the
# forceTemporary / originLanguage / custom-handler cases (not exposed by this
# gem), and the queue id rule (this gem dedupes by key AND context).
class VectorsTest < I18nKeylessTest::Case
  # assert_equal with a nil expectation is deprecated in minitest; the vectors use null for "no value".
  def assert_value(expected, actual, message = nil)
    expected.nil? ? assert_nil(actual, message) : assert_equal(expected, actual, message)
  end

  def vector(name)
    path = File.join(I18nKeylessTest::VECTORS, "#{name}.json")
    skip "no conformance vector at #{path}" unless File.file?(path)
    JSON.parse(File.read(path))
  end

  def client(api_key = "k", api_url = "https://api.test", timeout: 10, delays: [500, 1500])
    api = I18nKeyless::ApiClient.new(api_key: api_key, api_url: api_url, timeout: timeout, retry_delays: delays,
                                     logger: Logger.new(log))
    api.sleeper = ->(ms) { sleeps << ms }
    api
  end

  def test_resolve_lang
    vector("resolve-lang")["cases"].each do |c|
      input = c["input"]
      assert_value c["expected"], I18nKeyless::Locale.resolve(input["tag"], supported: input["supported"], fallback: input["fallback"]), c["name"]
    end
  end

  def test_languages
    vector("languages")["cases"].each do |c|
      case c["check"]
      when "availableLangs"
        assert_equal c["expected"], I18nKeyless::Locale::AVAILABLE_LANGS, c["name"]
      when "rename"
        # No v2 dialect in this gem: the v2 code is simply not a language.
        assert_nil I18nKeyless::Locale.to_lang(c["input"]), c["name"]
        assert I18nKeyless::Locale.lang?(c["expected"]), c["name"]
      when "stillAvailable"
        c["input"].each { |code| assert I18nKeyless::Locale.lang?(code), c["name"] }
      when "absent"
        refute I18nKeyless::Locale.lang?(c["input"]), c["name"]
      when "regionalized"
        assert_equal c["expected"], I18nKeyless::Locale::AVAILABLE_LANGS.select { |code| code.include?("-") }.sort, c["name"]
      else
        flunk "unknown check #{c['check']}"
      end
    end
  end

  def test_app_store_locales
    v = vector("app-store-locales")
    v["cases"].each { |c| assert_equal c["expected"], I18nKeyless::Locale.to_app_store_locale(c["input"]) }
    assert_equal v["distinctSlots"], I18nKeyless::Locale::APP_STORE_LOCALES.values.uniq.length
  end

  def test_storage_key
    vector("storage-key")["cases"].each do |c|
      assert_equal c["expected"], I18nKeyless::Miss.lookup_key_for(c["input"]["key"], c["input"]["context"]), c["name"]
    end
  end

  def test_namespace_resolution
    vector("namespace")["cases"].each do |c|
      next unless c["fn"] == "resolveNamespace" # originLanguage (user generated content) is not exposed by this gem

      options = c["input"]["options"] || {}
      assert_equal c["expected"],
                   I18nKeyless::Translator.resolve_namespace(options["namespace"], c["input"].dig("config", "defaultNamespace")),
                   c["name"]
    end
  end

  def test_retry_decision
    vector("retry-decision")["cases"].each do |c|
      decision = I18nKeyless::ApiClient.decide(c["input"]["status"], c["input"]["statusText"])
      assert_equal c["expected"]["action"], decision.action, c["input"].to_json
      assert_equal c["expected"]["error"], decision.error, c["input"].to_json if c["expected"].key?("error")
    end
  end

  def test_backoff_schedule
    v = vector("backoff")
    api = client(timeout: v["timeoutMs"] / 1000, delays: v["delaysMs"])
    assert_equal v["maxAttempts"], api.max_attempts
    assert_equal v["timeoutMs"] / 1000, I18nKeyless::Config.new({}).timeout
    assert_equal v["delaysMs"], I18nKeyless::Config.new({}).retry
    v["cases"].each do |c|
      assert_value c["expected"]["waitMs"], api.delay_after(c["input"]["failedAttempt"]), c["name"]
    end
  end

  def test_backoff_scenarios
    v = vector("backoff")
    v["scenarios"].each do |scenario|
      WebMock.reset!
      sleeps.clear
      attempts = 0
      responses = scenario["responses"].dup
      stub_request(:get, %r{https://api\.test/.*}).to_return do |_request|
        attempts += 1
        answer = responses.shift
        raise SocketError, answer["networkError"] if answer.key?("networkError")
        raise Net::OpenTimeout, "execution expired" if answer["timeout"]

        body = answer["invalidJson"] ? "{not json" : (answer.key?("body") ? answer["body"].to_json : "")
        { status: [answer["status"], answer["statusText"] || ""], body: body }
      end
      api = client(delays: v["delaysMs"])

      result = api.fetch_dictionary("en", "default", scenario["name"] == "304 ends the call at once" ? 'W/"x"' : nil)

      assert_equal scenario["expected"]["attempts"], attempts, scenario["name"]
      assert_equal scenario["expected"]["sleepsMs"], sleeps, scenario["name"]
      expected = scenario["expected"]["result"]
      assert_equal expected["ok"], result.ok, scenario["name"]
      assert_equal expected["notModified"], result.not_modified, scenario["name"] if expected.key?("notModified")
      assert_equal expected["error"], result.error, scenario["name"] if expected.key?("error")
    end
  end

  def test_dictionary_request
    vector("dictionary-request")["cases"].each do |c|
      next if c["expected"].key?("handler") # custom handlers are not exposed by this gem

      WebMock.reset!
      input = c["input"]
      stub_request(:get, %r{.*}).to_return(status: 200, body: envelope({}).to_json)
      api = client(input["config"]["API_KEY"], input["config"]["API_URL"] || I18nKeyless::ApiClient::DEFAULT_URL)
      api.fetch_dictionary(input["targetLanguage"], input["namespace"] || "default", input["knownEtag"], input["lastRefresh"])

      expected = c["expected"]
      assert_requested(:get, expected["url"], times: 1) do |request|
        %w[Content-Type Authorization If-None-Match].each do |header|
          assert_equal expected["headers"][header], request.headers[header], "#{c['name']}: #{header}" if expected["headers"].key?(header)
        end
        assert_equal I18nKeyless::ApiClient::VERSION, request.headers["Version"], c["name"]
        # A Rails application is always a server: the sdk header says so, and no device id travels.
        assert_equal I18nKeyless::ApiClient::SDK, request.headers["Sdk"], c["name"]
        refute request.headers.key?("Unique-Id"), c["name"]
        refute request.headers.key?("If-None-Match") && !expected["headers"].key?("If-None-Match"), c["name"]
        true
      end
    end
  end

  def test_dictionary_response
    warnings = []
    vector("dictionary-response")["cases"].each do |c|
      warnings << "i18n-keyless: #{c['expected']['warning']}" if c["expected"].key?("warning")
      WebMock.reset!
      sleeps.clear
      attempts = 0
      responses = c["responses"] || [c["response"]]
      stub_request(:get, %r{.*}).to_return do |_request|
        attempts += 1
        answer = responses.shift
        { status: [answer["status"], answer["statusText"] || ""], body: answer.key?("body") ? answer["body"].to_json : "",
          headers: answer["headers"] || {} }
      end
      api = client(c["input"]["config"]["API_KEY"], I18nKeyless::ApiClient::DEFAULT_URL)
      known_etag = c["input"]["knownEtag"]

      result = api.fetch_dictionary(c["input"]["targetLanguage"], "default", known_etag)

      expected = c["expected"]
      assert_equal expected["attempts"], attempts, c["name"] if expected.key?("attempts")
      if expected["result"].nil?
        assert !result.ok || result.not_modified, c["name"]
        assert_equal({}, result.translations, c["name"])
      else
        assert result.ok, c["name"]
        assert_equal expected["result"]["data"]["translations"], result.translations, c["name"]
        assert_value expected["result"]["etag"], result.etag, c["name"]
      end
      # The ETag a caller keeps afterwards: the new one, else the one it already had on a 304.
      remembered = result.not_modified ? known_etag : result.etag
      assert_value expected["etagRemembered"], remembered, c["name"]
      assert_equal expected["nextRequest"]["url"],
                   api.dictionary_url(c["input"]["targetLanguage"], "default", remembered, "1700000000"), c["name"]
    end
    warnings.each { |warning| assert_equal 1, log.string.scan(warning).length, warning }
  end

  def test_translate_request
    vector("translate-request")["cases"].each do |c|
      options = c["input"]["options"] || {}
      next if c["expected"].key?("handler") || options.key?("forceTemporary") || options.key?("originLanguage")

      WebMock.reset!
      config = c["input"]["config"]
      stub_request(:post, %r{.*}).to_return(status: 200, body: { ok: true, data: { translation: {} }, error: "", message: "" }.to_json)
      api = client(config["API_KEY"], config["API_URL"] || I18nKeyless::ApiClient::DEFAULT_URL)
      miss = I18nKeyless::Miss.new(c["input"]["key"], options["context"],
                                   I18nKeyless::Translator.resolve_namespace(options["namespace"], config["defaultNamespace"]))

      api.translate([miss], config["languages"]["primary"], config["languages"]["supported"])

      expected = c["expected"]
      assert_requested(:post, expected["url"], times: 1) do |request|
        assert_equal expected["headers"]["Content-Type"], request.headers["Content-Type"], c["name"]
        assert_equal expected["headers"]["Authorization"], request.headers["Authorization"], c["name"]
        assert_equal I18nKeyless::ApiClient::VERSION, request.headers["Version"], c["name"]
        assert_equal I18nKeyless::ApiClient::SDK, request.headers["Sdk"], c["name"]
        refute request.headers.key?("Unique-Id"), c["name"]
        assert_equal expected["body"], JSON.parse(request.body), c["name"]
        true
      end
    end
  end

  def test_queue_scenarios
    vector("queue")["scenarios"].each do |scenario|
      next unless scenario["calls"].is_a?(Array) # "31 distinct keys": the in-flight peak is a promise-level property of the SDK queue

      skip_scenario = scenario["calls"].any? do |call|
        options = call["options"] || {}
        options.key?("originLanguage") || options.key?("forceTemporary") || options.key?("context")
      end
      next if skip_scenario # not exposed, or deduplicated differently (this gem keeps one POST per context)

      WebMock.reset!
      configure
      stub_request(:get, %r{https://api\.test/translate/.*}).to_return(status: 200, body: envelope(scenario["translations"] || {}).to_json)
      stub_translate
      I18n.locale = :en

      scenario["calls"].each do |call|
        I18nKeyless.translate(call["key"], namespace: call.dig("options", "namespace"))
      end
      flush

      assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: scenario["expected"]["requests"]) if scenario["expected"]["requests"].positive?
      assert_not_requested(:post, "#{I18nKeylessTest::API}/translate") if scenario["expected"]["requests"].zero?
    end
  end

  def test_translation_lookup
    vector("translation-lookup")["cases"].each do |c|
      options = c["input"]["options"] || {}
      next if %w[originLanguage forceTemporary replace unpersistedNamespace].any? { |o| options.key?(o) } # placeholders are I18n's `%{name}`

      WebMock.reset!
      store = c["input"]["store"]
      configure(primary: store["primary"], namespace: store["defaultNamespace"])
      stub_request(:get, %r{https://api\.test/translate/.*}).to_return(status: 200, body: envelope({}).to_json)
      namespace = I18nKeyless::Translator.resolve_namespace(options["namespace"], store["defaultNamespace"])
      seed_dictionary(store["currentLanguage"], store["translations"], namespace: namespace)
      I18n.locale = store["currentLanguage"]

      text = I18nKeyless.translate(c["input"]["key"], context: options["context"], namespace: options["namespace"])

      assert_equal c["expected"]["text"], text, c["name"]
      queued = I18nKeyless.translator.pending_misses.map(&:namespace).uniq
      assert_equal c["expected"]["queued"].map { |q| q["namespace"] }, queued, c["name"]
    end
  end

  def test_usage_reporting_matches_the_node_runtime
    v = vector("usage-reporting")
    node = v["cases"].find { |c| c.dig("input", "package") == "node" }["expected"]
    # `rails` is registered on the API as a server label with the `node` rules.
    assert_equal "node", node["runtime"]
    assert_equal "rails", I18nKeyless::ApiClient::SDK
    assert node["recordsUsage"]
    assert node["sendsUsage"]
    refute node["sendsUniqueId"]
    rails_label = v["serverLabels"]["cases"].find { |c| c["label"] == "rails" }
    assert rails_label, "usage-reporting.json must list `rails` as a server label"
    assert rails_label["expected"]
    assert I18nKeyless::Config.new({}).usage?
    assert_equal 10, I18nKeyless::DictionaryStore::USAGE_FLUSH_SECONDS

    # End to end: a served key is recorded, and the map leaves after the response.
    stub_dictionary("en", { "Bonjour" => "Hello" })
    stub_usage
    I18n.locale = :en
    assert_equal "Hello", I18n.t("Bonjour")
    flush
    assert_requested(:post, "#{I18nKeylessTest::API}/translate/last-used-translations") do |request|
      refute request.headers.key?("Unique-Id")
      assert_equal "rails", request.headers["Sdk"]
      assert_equal({ "default" => { "Bonjour" => today } }, JSON.parse(request.body)["translationsUsageByNamespace"])
      true
    end
  end

  def test_usage_request
    vector("usage-request")["cases"].each do |c|
      config = c["input"]["config"]
      next if c["expected"].key?("handler") # custom handlers are not exposed by this gem

      WebMock.reset!
      stub_request(:post, %r{.*}).to_return(status: 200, body: { ok: true, error: "", message: "" }.to_json)
      api = client(config["API_KEY"], config["API_URL"] || I18nKeyless::ApiClient::DEFAULT_URL)

      result = api.send_usage(config["languages"]["primary"], c["input"]["usage"])

      expected = c["expected"]
      if expected["http"] == false
        refute result.sent, c["name"]
        assert_not_requested(:post, %r{.*})
        next
      end
      assert result.ok, c["name"]
      assert_requested(:post, expected["url"], times: 1) do |request|
        assert_equal expected["headers"]["Content-Type"], request.headers["Content-Type"], c["name"]
        assert_equal expected["headers"]["Authorization"], request.headers["Authorization"], c["name"]
        assert_equal I18nKeyless::ApiClient::VERSION, request.headers["Version"], c["name"]
        assert_equal I18nKeyless::ApiClient::SDK, request.headers["Sdk"], c["name"]
        refute request.headers.key?("Unique-Id"), c["name"]
        assert_equal expected["body"], JSON.parse(request.body), c["name"]
        true
      end
    end
  end

  def test_a_server_sends_no_device_id
    v = vector("unique-id")
    assert_includes v["description"], "A server runtime sends no id"
    stub_request(:get, %r{.*}).to_return(status: 200, body: envelope({}).to_json)
    client.fetch_dictionary("en", "default", nil)
    assert_requested(:get, "https://api.test/translate/en?last_refresh=") do |request|
      !request.headers.key?("Unique-Id") && request.headers["Sdk"] == "rails"
    end
  end
end

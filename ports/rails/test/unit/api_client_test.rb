# frozen_string_literal: true

require "test_helper"

class ApiClientTest < Minitest::Test
  API = "https://api.test"

  def setup
    @log = StringIO.new
    @sleeps = []
    @api = client
  end

  def client(**options)
    api = I18nKeyless::ApiClient.new(api_key: "k", api_url: API, logger: Logger.new(@log), **options)
    api.sleeper = ->(ms) { @sleeps << ms }
    api
  end

  def test_constants_and_headers
    assert_equal I18nKeyless::VERSION, I18nKeyless::ApiClient::VERSION
    assert_match(/\A3\.\d+\.\d+/, I18nKeyless::ApiClient::VERSION)
    assert_equal "rails", I18nKeyless::ApiClient::SDK
    headers = @api.headers
    assert_equal "Bearer k", headers["Authorization"]
    assert_equal "application/json", headers["Content-Type"]
    assert_equal "rails", headers["sdk"]
    refute headers.key?("unique_id")
  end

  def test_url_normalisation
    assert_equal API, I18nKeyless::ApiClient.new(api_key: "k", api_url: "#{API}//").api_url
    assert_equal I18nKeyless::ApiClient::DEFAULT_URL, I18nKeyless::ApiClient.new(api_key: "k", api_url: "").api_url
    assert_equal "#{API}/translate/en?last_refresh=", @api.dictionary_url("en", "default", nil)
    assert_equal "#{API}/translate/en?last_refresh=null", @api.dictionary_url("en", "default", nil, nil)
    assert_equal "#{API}/translate/en?last_refresh=&namespace=check%20out", @api.dictionary_url("en", "check out", nil)
    assert_equal "#{API}/translate/en", @api.dictionary_url("en", "default", '"v1"')
    assert_equal "#{API}/translate/en?namespace=app", @api.dictionary_url("en", "app", '"v1"')
  end

  def test_translate_body
    miss = I18nKeyless::Miss.new("8 heures", "time", "checkout")
    assert_equal({ "key" => "8 heures", "context" => "time", "namespace" => "checkout", "languages" => %w[en es fr], "primaryLanguage" => "fr" },
                 @api.translate_body(miss, "fr", %w[en es]))
    assert_equal({ "key" => "Bonjour", "languages" => %w[fr en], "primaryLanguage" => "fr" },
                 @api.translate_body(I18nKeyless::Miss.new("Bonjour"), "fr", %w[fr en]))
  end

  def test_error_for
    assert_equal "timeout", I18nKeyless::ApiClient.error_for(Net::OpenTimeout.new("execution expired"))
    assert_equal "timeout", I18nKeyless::ApiClient.error_for(StandardError.new("Operation timed out"))
    assert_equal "offline", I18nKeyless::ApiClient.error_for(SocketError.new("offline"))
    assert_equal "RuntimeError", I18nKeyless::ApiClient.error_for(RuntimeError.new(""))
    assert I18nKeyless::ApiClient.transient?(Errno::ECONNREFUSED.new)
    refute I18nKeyless::ApiClient.transient?(RuntimeError.new("boom"))
  end

  def test_a_non_transient_exception_ends_the_call_without_retry
    stub_request(:get, %r{.*}).to_raise(RuntimeError.new("boom"))
    result = @api.fetch_dictionary("en", "default", nil)
    refute result.ok
    assert_equal "boom", result.error
    assert_equal [], @sleeps
    assert_requested(:get, "#{API}/translate/en?last_refresh=", times: 1)
    assert_includes @log.string, "i18n-keyless: fetch all translations error: boom"
  end

  def test_fetch_dictionary_ok_false_and_message
    stub_request(:get, %r{.*}).to_return(status: 200, body: { ok: false, error: "invalid api key", message: "" }.to_json)
    result = @api.fetch_dictionary("en", "default", nil)
    refute result.ok
    assert_equal "invalid api key", result.error
    stub_request(:get, %r{.*}).to_return(status: 200, body: { ok: false, message: "" }.to_json)
    assert_equal "not ok", @api.fetch_dictionary("en", "default", nil).error
    stub_request(:get, %r{.*}).to_return(status: 200, body: { ok: true, data: { translations: { "A" => "a", "B" => 3 } }, message: "heads up" }.to_json)
    result = @api.fetch_dictionary("en", "default", nil)
    assert_equal({ "A" => "a" }, result.translations)
    assert_includes @log.string, "i18n-keyless: heads up"
    stub_request(:get, %r{.*}).to_return(status: 200, body: { ok: true, data: { translations: "nope" } }.to_json)
    assert_equal({}, @api.fetch_dictionary("en", "default", nil).translations)
  end

  def test_translate_retries_together_and_gives_up_per_miss
    calls = Hash.new(0)
    stub_request(:post, "#{API}/translate").to_return do |request|
      key = JSON.parse(request.body)["key"]
      calls[key] += 1
      case key
      when "flaky" then calls[key] == 1 ? { status: 503 } : { status: 200, body: { ok: true, data: { translation: { "en" => "Flaky" } } }.to_json }
      when "bad" then { status: [400, "Bad Request"] }
      when "dead" then { status: 500 }
      when "broken" then { status: 200, body: "{not json" }
      when "notok" then { status: 200, body: { ok: false, error: "nope" }.to_json }
      when "odd" then { status: 200, body: { ok: true, data: { translation: "?" }, message: "note" }.to_json }
      else { status: 200, body: { ok: true, data: { translation: { "en" => "Fine", "es" => nil } } }.to_json }
      end
    end
    misses = %w[fine flaky bad dead broken notok odd].map { |k| I18nKeyless::Miss.new(k) }
    results = client(concurrency: 2).translate(misses, "fr", %w[fr en])
    assert_equal({ "en" => "Fine" }, results["default:fine"])
    assert_equal({ "en" => "Flaky" }, results["default:flaky"])
    assert_nil results["default:bad"]
    assert_nil results["default:dead"]
    assert_nil results["default:broken"]
    assert_nil results["default:notok"]
    assert_equal({}, results["default:odd"])
    assert_equal 1, calls["bad"]
    assert_equal 3, calls["dead"]
    assert_equal 3, calls["broken"]
    assert_equal [500, 1500], @sleeps
    assert_includes @log.string, 'translate error for "bad": Bad Request'
    assert_includes @log.string, 'translate error for "dead": HTTP 500'
    assert_includes @log.string, 'translate error for "broken": invalid JSON'
    assert_includes @log.string, 'translate error for "notok": nope'
    assert_includes @log.string, "i18n-keyless: note"
  end

  def test_translate_survives_an_exception_in_a_thread
    stub_request(:post, "#{API}/translate").to_raise(RuntimeError.new("boom"))
    results = @api.translate([I18nKeyless::Miss.new("x")], "fr", %w[en])
    assert_nil results["default:x"]
    assert_includes @log.string, 'translate error for "x": boom'
  end

  def test_send_usage
    stub_request(:post, "#{API}/translate/last-used-translations").to_return(status: 200, body: { ok: false, error: "bad", message: "m" }.to_json)
    result = @api.send_usage("fr", { "default" => { "A" => "2026-01-01" } })
    refute result.ok
    assert result.sent
    assert_equal "bad", result.error
    assert_includes @log.string, "i18n-keyless: m"
    stub_request(:post, "#{API}/translate/last-used-translations").to_return(status: 200, body: { ok: false }.to_json)
    assert_equal "not ok", @api.send_usage("fr", { "default" => { "A" => "2026-01-01" } }).error
    stub_request(:post, "#{API}/translate/last-used-translations").to_return(status: [503, "Service Unavailable"])
    result = @api.send_usage("fr", { "default" => { "A" => "2026-01-01" } })
    refute result.ok
    assert_equal "Service Unavailable", result.error
    refute I18nKeyless::ApiClient.new(api_key: "", api_url: API).send_usage("fr", { "default" => { "A" => "x" } }).sent
  end

  def test_logging_failures_are_swallowed
    broken = Object.new
    def broken.warn(*)
      raise "logger down"
    end
    api = I18nKeyless::ApiClient.new(api_key: "k", api_url: API, logger: broken)
    api.sleeper = ->(_) {}
    stub_request(:get, %r{.*}).to_return(status: [404, "Not Found"])
    refute api.fetch_dictionary("en", "default", nil).ok
  end
end

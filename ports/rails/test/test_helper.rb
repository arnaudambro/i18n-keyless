# frozen_string_literal: true

require "minitest/autorun"
require "webmock/minitest"
require "stringio"
require "logger"
require "json"
require "active_support"
require "active_support/cache"
require "active_job"
require "i18n_keyless"

WebMock.disable_net_connect!
ActiveJob::Base.logger = Logger.new(nil)

module I18nKeylessTest
  API = "https://api.test"
  VECTORS = File.expand_path("../../../conformance/vectors", __dir__)

  # A test case with a fresh I18n, a fresh memory cache, a captured log, and
  # the keyless backend chained after a plain Simple backend that holds
  # `fixtures/en.yml`-like lines.
  class Case < Minitest::Test
    attr_reader :cache, :log, :sleeps

    def setup
      super
      I18n.enforce_available_locales = false
      I18n.backend = I18n::Backend::Simple.new
      I18n.backend.store_translations(:en, { "hello" => "Hello from YAML", "users" => { "index" => { "title" => "Users" } },
                                             "From the file" => "From the YAML file" })
      I18n.default_locale = :fr
      I18n.locale = :en
      @cache = ActiveSupport::Cache::MemoryStore.new
      @log = StringIO.new
      @sleeps = []
      configure
    end

    def teardown
      super
      I18nKeyless.uninstall!
      I18nKeyless.reset!
      I18nKeyless.instance_variable_set(:@config, nil)
      I18n.locale = :en
    end

    def configure(**overrides)
      I18nKeyless.instance_variable_set(:@config, I18nKeyless::Config.new({}))
      I18nKeyless.configure do |c|
        c.api_key = "test-key"
        c.api_url = API
        c.primary = "fr"
        c.languages = %w[fr en es]
        c.cache = @cache
        c.logger = Logger.new(@log)
        overrides.each { |name, value| c.public_send("#{name}=", value) }
      end
      I18nKeyless.uninstall!
      I18nKeyless.install! if I18nKeyless.enabled?
      I18nKeyless.translator.api.sleeper = ->(ms) { @sleeps << ms } if I18nKeyless.enabled?
    end

    def envelope(translations)
      { ok: true, data: { translations: translations }, error: "", message: "" }
    end

    def stub_dictionary(lang, translations = {}, headers: {}, status: 200, namespace: nil)
      query = namespace ? { last_refresh: "", namespace: namespace } : { last_refresh: "" }
      stub_request(:get, "#{API}/translate/#{lang}").with(query: query)
        .to_return(status: status, body: envelope(translations).to_json,
                   headers: { "Content-Type" => "application/json" }.merge(headers))
    end

    def stub_translate(translation = {}, status: 200)
      stub_request(:post, "#{API}/translate")
        .to_return(status: status, body: { ok: true, data: { translation: translation }, error: "", message: "" }.to_json,
                   headers: { "Content-Type" => "application/json" })
    end

    def stub_usage
      stub_request(:post, "#{API}/translate/last-used-translations")
        .to_return(status: 200, body: { ok: true, error: "", message: "" }.to_json,
                   headers: { "Content-Type" => "application/json" })
    end

    def flush
      I18nKeyless.flush
    end

    def with_locale(locale)
      previous = I18n.locale
      I18n.locale = locale
      yield
    ensure
      I18n.locale = previous
    end

    def dict_key(lang, namespace = "default")
      "i18n-keyless:#{I18nKeyless::DictionaryStore.hash_key('test-key')}:dict:#{namespace}:#{lang}"
    end

    def seed_dictionary(lang, translations, namespace: "default", fetched_at: Time.now.to_i, etag: nil, failed: false)
      cache.write(dict_key(lang, namespace), { translations: translations, etag: etag, fetched_at: fetched_at, failed: failed })
    end

    def posted_bodies(path = "/translate")
      bodies = []
      WebMock::RequestRegistry.instance.requested_signatures.each do |signature, count|
        next unless signature.method == :post && signature.uri.path == path

        count.times { bodies << JSON.parse(signature.body) }
      end
      bodies
    end

    def today
      Time.now.utc.strftime("%Y-%m-%d")
    end
  end
end

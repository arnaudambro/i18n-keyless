# frozen_string_literal: true

require "test_helper"

class ConfigTest < Minitest::Test
  def test_defaults_without_environment
    c = I18nKeyless::Config.new({})
    assert_equal true, c.enabled
    assert_nil c.api_key
    refute c.enabled?
    assert_equal "https://api.i18n-keyless.com", c.resolved_api_url
    assert_equal 3600, c.cache_ttl
    assert_equal 10, c.timeout
    assert_equal [500, 1500], c.retry
    assert_equal 30, c.concurrency
    assert c.usage?
    assert_nil c.queue
    assert_equal "default", c.resolved_namespace
    assert_equal [], c.resolved_languages
    assert_kind_of ActiveSupport::Cache::MemoryStore, c.resolved_cache
    assert_respond_to c.resolved_logger, :warn
  end

  def test_reads_the_environment
    env = {
      "I18N_KEYLESS_ENABLED" => "true", "I18N_KEYLESS_API_KEY" => "k", "I18N_KEYLESS_API_URL" => "https://self.hosted/",
      "I18N_KEYLESS_PRIMARY_LANG" => "pt_BR", "I18N_KEYLESS_LANGUAGES" => "pt_BR, en ,xx,en", "I18N_KEYLESS_NAMESPACE" => "app",
      "I18N_KEYLESS_CACHE_TTL" => "60", "I18N_KEYLESS_USAGE" => "false", "I18N_KEYLESS_QUEUE" => "i18n"
    }
    c = I18nKeyless::Config.new(env)
    assert c.enabled?
    assert_equal "https://self.hosted", c.resolved_api_url
    assert_equal "pt-BR", c.resolved_primary
    assert_equal %w[pt-BR en], c.resolved_languages
    assert_equal "app", c.resolved_namespace
    assert_equal 60, c.cache_ttl
    refute c.usage?
    assert_equal "i18n", c.queue
  end

  def test_enabled_flag_spellings
    %w[false 0 off no].each do |value|
      refute I18nKeyless::Config.new({ "I18N_KEYLESS_ENABLED" => value, "I18N_KEYLESS_API_KEY" => "k" }).enabled?, value
    end
    assert I18nKeyless::Config.new({ "I18N_KEYLESS_ENABLED" => "1", "I18N_KEYLESS_API_KEY" => "k" }).enabled?
    c = I18nKeyless::Config.new({ "I18N_KEYLESS_API_KEY" => "k" })
    c.enabled = false
    refute c.enabled?
    c.enabled = true
    c.api_key = "  "
    refute c.enabled?
  end

  def test_primary_falls_back_to_the_default_locale
    previous = I18n.default_locale
    enforce = I18n.enforce_available_locales
    I18n.enforce_available_locales = false
    I18n.default_locale = :"pt-BR"
    assert_equal "pt-BR", I18nKeyless::Config.new({}).resolved_primary
    I18n.default_locale = :xx
    assert_equal "en", I18nKeyless::Config.new({}).resolved_primary
  ensure
    I18n.default_locale = previous
    I18n.enforce_available_locales = enforce
  end

  def test_languages_accept_an_array_and_an_invalid_ttl
    c = I18nKeyless::Config.new({ "I18N_KEYLESS_CACHE_TTL" => "soon" })
    c.languages = [:en, "zh_TW", "xx"]
    assert_equal %w[en zh-Hant], c.resolved_languages
    assert_equal 3600, c.cache_ttl
  end

  def test_keyless_key_rule
    I18nKeyless.instance_variable_set(:@config, I18nKeyless::Config.new({}))
    assert I18nKeyless.keyless_key?("Welcome to our app")
    assert I18nKeyless.keyless_key?("Bonjour")
    assert I18nKeyless.keyless_key?("Bonjour. Ça va ?")
    assert I18nKeyless.keyless_key?("8 heures")
    refute I18nKeyless.keyless_key?("hello")
    refute I18nKeyless.keyless_key?("users.index.title")
    refute I18nKeyless.keyless_key?("activerecord.errors.models.user")
    refute I18nKeyless.keyless_key?(:hello)
    refute I18nKeyless.keyless_key?("")
    refute I18nKeyless.keyless_key?(nil)
    I18nKeyless.config.rails_key_pattern = nil
    assert I18nKeyless.keyless_key?("hello")
  ensure
    I18nKeyless.instance_variable_set(:@config, nil)
  end
end

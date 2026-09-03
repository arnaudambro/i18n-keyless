# frozen_string_literal: true

require "test_helper"
require "rails"
require "action_controller/railtie"
require "action_view/railtie"
require "active_job/railtie"
require "rack/test"

ENV["I18N_KEYLESS_API_KEY"] = "test-key"
ENV["I18N_KEYLESS_API_URL"] = I18nKeylessTest::API
ENV["I18N_KEYLESS_PRIMARY_LANG"] = "fr"
ENV["I18N_KEYLESS_LANGUAGES"] = "fr,en"
require "i18n_keyless/railtie"

# A one-file Rails application, booted once for the process, to check what the
# Railtie wires: the chained backend, the helper, the middleware.
class RailtieApp < Rails::Application
  config.root = File.expand_path("../..", __dir__)
  config.eager_load = false
  config.secret_key_base = "x" * 64
  config.logger = Logger.new(nil)
  config.cache_store = :memory_store
  config.i18n.available_locales = %i[fr en]
  config.i18n.default_locale = :fr
  config.hosts.clear if config.respond_to?(:hosts)
  config.active_job.queue_adapter = :test
end

class GreetingsController < ActionController::Base
  def hello
    I18n.locale = :en
    render plain: "#{t('Bonjour le monde')}|#{i18nk('8 heures', context: 'durée')}|#{t('goodbye')}"
  ensure
    I18n.locale = :fr
  end
end

RailtieApp.initialize!
RailtieApp.routes.draw do
  get "/hello", to: "greetings#hello"
end

class RailtieTest < Minitest::Test
  include Rack::Test::Methods

  def app
    RailtieApp
  end

  def setup
    super
    I18nKeyless.instance_variable_set(:@config, nil)
    I18nKeyless.reset!
    I18nKeyless.config.cache = ActiveSupport::Cache::MemoryStore.new
    I18nKeyless.config.logger = Logger.new(nil)
    I18nKeyless.install!
    I18nKeyless.translator.api.sleeper = ->(_ms) {}
  end

  def teardown
    super
    I18nKeyless.instance_variable_set(:@config, nil)
    I18nKeyless.reset!
  end

  def test_the_backend_is_chained_after_the_application_backend
    assert_kind_of I18n::Backend::Chain, I18n.backend
    assert_kind_of I18nKeyless::Backend, I18n.backend.backends.last
    refute_kind_of I18nKeyless::Backend, I18n.backend.backends.first
    assert I18nKeyless.enabled?
    assert_equal "fr", I18nKeyless.config.resolved_primary
    assert_equal %w[fr en], I18nKeyless.config.resolved_languages
  end

  def test_the_middleware_and_the_helper_are_installed
    assert_includes RailtieApp.middleware.map(&:klass), I18nKeyless::Middleware
    assert ActionView::Base.method_defined?(:i18nk)
    assert ActionController::Base.method_defined?(:i18nk)
    assert ActiveJob::Base.method_defined?(:i18nk)
  end

  def test_a_request_is_served_then_flushed
    stub_request(:get, "#{I18nKeylessTest::API}/translate/en").with(query: { last_refresh: "" })
      .to_return(status: 200, body: { ok: true, data: { translations: { "8 heures__durée" => "8 hours" } } }.to_json)
    stub_request(:post, "#{I18nKeylessTest::API}/translate")
      .to_return(status: 200, body: { ok: true, data: { translation: { "en" => "Hello world" } } }.to_json)
    stub_request(:post, "#{I18nKeylessTest::API}/translate/last-used-translations").to_return(status: 200, body: { ok: true }.to_json)
    get "/hello"
    assert_equal 200, last_response.status
    assert_equal "Bonjour le monde|8 hours|Translation missing: en.goodbye", last_response.body
    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 1)
    get "/hello"
    assert_equal "Hello world|8 hours|Translation missing: en.goodbye", last_response.body
  end
end

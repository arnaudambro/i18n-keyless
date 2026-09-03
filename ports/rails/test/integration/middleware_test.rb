# frozen_string_literal: true

require "test_helper"
require "rack"
require "rack/test"

class MiddlewareTest < I18nKeylessTest::Case
  include Rack::Test::Methods

  def app
    @app ||= I18nKeyless::Middleware.new(lambda { |env|
      raise "boom" if env["PATH_INFO"] == "/boom"

      [200, { "content-type" => "text/plain" }, [I18n.t("Bonjour")]]
    })
  end

  def test_the_flush_runs_after_the_body_is_closed
    stub_dictionary("en")
    stub_translate({ "en" => "Hello" })
    stub_usage
    get "/"
    assert_equal "Bonjour", last_response.body
    # rack-test closes the body: the miss left after the response
    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 1)
    get "/"
    assert_equal "Hello", last_response.body
  end

  def test_the_flush_runs_when_the_request_raises
    stub_dictionary("en")
    stub_translate({ "en" => "Hello" })
    stub_usage
    I18n.t("Bonjour")
    assert_raises(RuntimeError) { get "/boom" }
    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 1)
  end

  def test_without_rack_body_proxy_the_flush_runs_inline
    stub_dictionary("en")
    stub_translate({ "en" => "Hello" })
    stub_usage
    proxy = Rack.send(:remove_const, :BodyProxy)
    begin
      status, _headers, body = app.call(Rack::MockRequest.env_for("/"))
      assert_equal 200, status
      assert_equal ["Bonjour"], body
      assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 1)
    ensure
      Rack.const_set(:BodyProxy, proxy)
    end
  end
end

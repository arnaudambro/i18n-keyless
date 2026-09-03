# frozen_string_literal: true

begin
  require "rack/body_proxy"
rescue LoadError
  # Rack is not a dependency of the gem: without it the flush runs before the response leaves.
end

module I18nKeyless
  # Flushes the misses, the revalidations and the usage after each response
  # is sent (the body is closed), so a translation never delays a page.
  class Middleware
    def initialize(app)
      @app = app
    end

    def call(env)
      status, headers, body = @app.call(env)
      if defined?(::Rack::BodyProxy)
        [status, headers, ::Rack::BodyProxy.new(body) { I18nKeyless.flush }]
      else
        I18nKeyless.flush
        [status, headers, body]
      end
    rescue Exception # rubocop:disable Lint/RescueException -- the flush still runs after a failed request
      I18nKeyless.flush
      raise
    end
  end
end

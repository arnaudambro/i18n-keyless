# frozen_string_literal: true

module I18nKeyless
  # Auto-loaded by Rails. Chains the backend after the application's I18n
  # backend, mixes `i18nk` into views, controllers, mailers and jobs, and
  # flushes the misses after each response (Rack middleware), after each job,
  # and at exit (rake tasks, `rails runner`).
  class Railtie < ::Rails::Railtie
    initializer "i18n_keyless.middleware" do |app|
      app.middleware.use I18nKeyless::Middleware
    end

    initializer "i18n_keyless.helpers" do
      ActiveSupport.on_load(:action_view) { include I18nKeyless::Helper }
      ActiveSupport.on_load(:action_controller) { include I18nKeyless::Helper }
      ActiveSupport.on_load(:action_mailer) { include I18nKeyless::Helper }
      ActiveSupport.on_load(:active_job) do
        include I18nKeyless::Helper
        after_perform { I18nKeyless.flush }
      end
    end

    # After the application's own `config.i18n.backend`, which Rails applies in
    # its own after_initialize (registered before this one).
    config.after_initialize do
      I18nKeyless.reset!
      I18nKeyless.install! if I18nKeyless.enabled?
      at_exit { I18nKeyless.flush }
    end
  end
end

# frozen_string_literal: true

require "i18n"
require "logger"
require "active_support"
require "active_support/cache"
require "active_support/core_ext/object/blank"

require_relative "i18n_keyless/version"
require_relative "i18n_keyless/config"
require_relative "i18n_keyless/locale"
require_relative "i18n_keyless/miss"
require_relative "i18n_keyless/api_client"
require_relative "i18n_keyless/dictionary_store"
require_relative "i18n_keyless/translator"
require_relative "i18n_keyless/backend"
require_relative "i18n_keyless/helper"
require_relative "i18n_keyless/middleware"

# Keyless translations for Ruby on Rails.
#
# `t('Welcome to our app')` resolves through the i18n-keyless API: a missing
# string is translated by AI once, for every language, cached in `Rails.cache`
# and served from there. The gem is an `I18n` backend chained AFTER the
# application's own backend, so `config/locales/*.yml` keeps working and wins.
#
#   I18nKeyless.configure do |c|
#     c.api_key = "..."
#     c.languages = %w[en fr es]
#   end
#
# Every value also has an `I18N_KEYLESS_*` environment counterpart (see Config).
module I18nKeyless
  class << self
    def config
      @config ||= Config.new
    end

    # Yields the config, then rebuilds the translator so the new values apply.
    def configure
      yield config if block_given?
      reset!
      config
    end

    # Forgets the built translator (and its per-process dictionaries). The next
    # call builds a new one from `config`.
    def reset!
      @translator = nil
    end

    def enabled?
      config.enabled?
    end

    def translator
      @translator ||= Translator.build(config)
    end

    # The `i18nk` helper: a translation with an optional `context`, `%{name}`
    # placeholders replaced by I18n. Returns the source text when the gem is
    # disabled, when the locale is the primary language, or on a miss.
    #
    #   I18nKeyless.translate("8 heures", context: "duration")
    #   I18nKeyless.translate("Bienvenue %{name}", name: "Ada", context: "greeting")
    def translate(text, values = nil, context: nil, locale: nil, namespace: nil, **more_values)
      text = text.to_s
      values = (values || {}).merge(more_values).transform_keys(&:to_sym)
      return interpolate(text, values) unless enabled?

      translator.get(text, values, context: context, locale: locale, namespace: namespace)
    end
    alias t translate

    # POSTs the recorded misses, revalidates the stale dictionaries served
    # since the last flush, and sends the usage analytics. Called by the Rack
    # middleware after each response, after each ActiveJob, and at exit.
    # Never raises.
    def flush
      return unless enabled? && @translator

      @translator.flush
    end

    # Chains the keyless backend after `base` (the current `I18n.backend` by
    # default). Idempotent: an already chained backend is left alone.
    def install!(base = I18n.backend)
      return base if base.is_a?(Backend)
      return base if base.is_a?(I18n::Backend::Chain) && base.backends.any? { |b| b.is_a?(Backend) }

      I18n.backend = I18n::Backend::Chain.new(base, Backend.new)
    end

    # Removes the keyless backend from the chain, restoring the application's own backend.
    def uninstall!
      backend = I18n.backend
      return backend unless backend.is_a?(I18n::Backend::Chain) && backend.backends.any? { |b| b.is_a?(Backend) }

      rest = backend.backends.reject { |b| b.is_a?(Backend) }
      I18n.backend = rest.length == 1 ? rest.first : I18n::Backend::Chain.new(*rest)
    end

    # Is this `I18n.t` key a keyless source string, or a Rails key?
    #
    # A Rails key is a lowercase identifier path: `hello`, `users.index.title`,
    # `activerecord.errors.models.user`. Those are left to the YAML files (and
    # never sent to the API). Anything else, a space, an uppercase letter, a
    # punctuation mark, is a source string. `config.rails_key_pattern` holds the
    # rule; `nil` makes every string keyless.
    def keyless_key?(key)
      return false unless key.is_a?(String) && !key.empty?

      pattern = config.rails_key_pattern
      pattern.nil? || !pattern.match?(key)
    end

    # `%{name}` placeholders, I18n's own replacement, applied only when values
    # are given (like I18n::Backend::Base#translate).
    def interpolate(text, values)
      return text if values.nil? || values.empty?

      I18n.interpolate(text, values)
    end
  end
end

ActiveSupport.on_load(:active_job) { require_relative "i18n_keyless/translate_missing_keys_job" }

require_relative "i18n_keyless/railtie" if defined?(::Rails::Railtie)

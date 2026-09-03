# frozen_string_literal: true

require "i18n"

module I18nKeyless
  # The I18n backend. Chained AFTER the application's own backend
  # (`I18n::Backend::Chain.new(I18n.backend, I18nKeyless::Backend.new)`), so a
  # key found in `config/locales/*.yml` wins and only what the YAML files do
  # not have reaches the API.
  #
  # `I18n.t("Welcome to our app")` therefore resolves through i18n-keyless,
  # while `I18n.t("users.index.title")` or `t(:hello)` stay Rails keys (see
  # `I18nKeyless.keyless_key?`) and are never sent.
  #
  # `context:` and `namespace:` travel as I18n options:
  # `t("8 heures", context: "duration")` is stored as `8 heures__duration`.
  class Backend
    include I18n::Backend::Base

    def available_locales
      []
    end

    def initialized?
      true
    end

    def reload!
      I18nKeyless.translator.reset_loaded! if I18nKeyless.enabled?
      self
    end

    def eager_load!
      self
    end

    def store_translations(_locale, _data, _options = {}); end

    def translations(*)
      {}
    end

    protected

    def lookup(locale, key, scope = [], options = {})
      return nil unless I18nKeyless.enabled?
      return nil unless key.is_a?(String) && (scope.nil? || Array(scope).empty?) && I18nKeyless.keyless_key?(key)

      I18nKeyless.translator.lookup(locale.to_s, key, context: options[:context], namespace: options[:namespace])
    end
  end
end

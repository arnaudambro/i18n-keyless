# frozen_string_literal: true

module I18nKeyless
  # The `i18nk` helper, mixed into views, controllers, mailers and jobs by the
  # Railtie. `t()` with an i18n-keyless `context`, for ambiguous strings:
  #
  #   i18nk("8 heures", context: "duration")    # "8 hours"
  #   i18nk("8 heures", context: "clock time")  # "8 AM"
  #   i18nk("Bienvenue %{name}", name: user.name, context: "greeting")
  #   i18nk("Payer", namespace: "checkout")
  #
  # The string is stored as "key__context", exactly like the SDKs. `%{name}`
  # placeholders are I18n's own replacement. Unlike `t()`, `i18nk` never treats
  # its argument as a Rails key: `i18nk("close")` is the source string "close".
  module Helper
    def i18nk(text, values = nil, context: nil, locale: nil, namespace: nil, **more_values)
      values = (values || {}).merge(more_values)
      I18nKeyless.translate(text, values, context: context, locale: locale, namespace: namespace)
    end
  end
end

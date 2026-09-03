# frozen_string_literal: true

module I18nKeyless
  # Maps a Rails locale ("fr", :"pt-BR", "zh_CN", "en-GB") onto one of the 48
  # i18n-keyless language codes. A port of `resolveLang` from i18n-keyless-core.
  module Locale
    # The 48 languages i18n-keyless translates into, as the API spells them (v3).
    AVAILABLE_LANGS = %w[
      ar bn ca zh-Hans zh-Hant hr cs da nl en en-GB fi
      fr fr-CA de el gu he hi hu id it ja kn ko ms
      ml mr no or pl pt pt-BR pa ro ru sk sl es es-MX
      sv ta te th tr uk ur vi
    ].freeze

    # Chinese is selected by script, not by region, and the regions do not map
    # to a script by name, so the common region tags are spelled out.
    CHINESE_REGION_SCRIPTS = {
      "cn" => "zh-Hans", "sg" => "zh-Hans", "hans" => "zh-Hans",
      "tw" => "zh-Hant", "hk" => "zh-Hant", "mo" => "zh-Hant", "hant" => "zh-Hant"
    }.freeze

    # The App Store Connect listing slot of each code (a convenience the SDKs
    # ship; not a wire concern).
    APP_STORE_LOCALES = {
      "ar" => "ar-SA", "bn" => "bn", "ca" => "ca", "zh-Hans" => "zh-Hans", "zh-Hant" => "zh-Hant",
      "hr" => "hr", "cs" => "cs", "da" => "da", "nl" => "nl-NL", "en" => "en-US", "en-GB" => "en-GB",
      "fi" => "fi", "fr" => "fr-FR", "fr-CA" => "fr-CA", "de" => "de-DE", "el" => "el", "gu" => "gu",
      "he" => "he", "hi" => "hi", "hu" => "hu", "id" => "id", "it" => "it", "ja" => "ja", "kn" => "kn",
      "ko" => "ko", "ms" => "ms", "ml" => "ml", "mr" => "mr", "no" => "no", "or" => "or", "pl" => "pl",
      "pt" => "pt-PT", "pt-BR" => "pt-BR", "pa" => "pa", "ro" => "ro", "ru" => "ru", "sk" => "sk",
      "sl" => "sl", "es" => "es-ES", "es-MX" => "es-MX", "sv" => "sv", "ta" => "ta", "te" => "te",
      "th" => "th", "tr" => "tr", "uk" => "uk", "ur" => "ur", "vi" => "vi"
    }.freeze

    BY_LOWERCASE = AVAILABLE_LANGS.to_h { |lang| [lang.downcase, lang] }.freeze
    private_constant :BY_LOWERCASE

    module_function

    # The i18n-keyless code for a locale tag, most specific match first, or
    # nil when no supported language matches.
    #
    #   to_lang("pt_BR")  # => "pt-BR"
    #   to_lang("pt-AO")  # => "pt"
    #   to_lang("zh_CN")  # => "zh-Hans"
    #   to_lang("zh_TW")  # => "zh-Hant"
    #   to_lang("es-419") # => "es-MX"
    #   to_lang("xx")     # => nil
    def to_lang(tag)
      resolve(tag)
    end

    # `resolveLang(tag, { supported, fallback })` of the SDKs: the first
    # candidate present in `supported` (when given), else `fallback`.
    #
    #   resolve("pt-BR", supported: ["pt", "en"], fallback: "en") # => "pt"
    #   resolve("ja", supported: ["pt", "en"], fallback: "en")    # => "en"
    def resolve(tag, supported: nil, fallback: nil)
      candidates(tag).each do |candidate|
        return candidate if supported.nil? || supported.include?(candidate)
      end
      fallback
    end

    # `to_app_store_locale("fr")` # => "fr-FR"
    def to_app_store_locale(lang)
      APP_STORE_LOCALES[lang.to_s]
    end

    def lang?(code)
      AVAILABLE_LANGS.include?(code.to_s)
    end

    def candidates(tag)
      return [] if tag.nil?

      normalized = tag.to_s.tr("_", "-").strip.downcase
      return [] if normalized.empty?

      parts = normalized.split("-")
      language = parts.first
      region = parts.last
      list = []
      push = ->(lang) { list << lang if lang && !list.include?(lang) }

      # 1. the tag as written ("pt-BR", "zh-Hans")
      push.call(BY_LOWERCASE[normalized])

      # 2. Chinese resolves by script and never falls back to a bare language
      if language == "zh"
        push.call(CHINESE_REGION_SCRIPTS.fetch(region, "zh-Hans"))
        return list
      end

      # 3. UN M49 code for Latin America, which is what the es-MX slot really covers
      push.call("es-MX") if normalized == "es-419"

      # 4. the bare language ("pt-AO" => "pt")
      push.call(BY_LOWERCASE[language])
      list
    end
  end
end

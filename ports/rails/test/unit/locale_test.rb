# frozen_string_literal: true

require "test_helper"

class LocaleTest < Minitest::Test
  L = I18nKeyless::Locale

  def test_maps_rails_locales_onto_codes
    assert_equal "fr", L.to_lang("fr")
    assert_equal "fr", L.to_lang(:fr)
    assert_equal "pt-BR", L.to_lang("pt_BR")
    assert_equal "pt-BR", L.to_lang(:"pt-BR")
    assert_equal "pt", L.to_lang("pt-AO")
    assert_equal "zh-Hans", L.to_lang("zh_CN")
    assert_equal "zh-Hant", L.to_lang("zh_TW")
    assert_equal "en", L.to_lang("en_US")
    assert_equal "es-MX", L.to_lang("es-419")
    assert_nil L.to_lang("xx")
    assert_nil L.to_lang(nil)
    assert_nil L.to_lang("")
  end

  def test_resolve_with_supported_and_fallback
    assert_equal "pt", L.resolve("pt-BR", supported: %w[pt en], fallback: "en")
    assert_equal "en", L.resolve("ja", supported: %w[pt en], fallback: "en")
    assert_nil L.resolve("ja", supported: %w[pt en])
  end

  def test_app_store_locales_and_lang
    assert_equal "fr-FR", L.to_app_store_locale("fr")
    assert_nil L.to_app_store_locale("xx")
    assert L.lang?("zh-Hans")
    refute L.lang?("cn")
    assert_equal 48, L::AVAILABLE_LANGS.length
  end
end

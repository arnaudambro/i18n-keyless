# frozen_string_literal: true

require "test_helper"

class UsageTest < I18nKeylessTest::Case
  def test_usage_is_recorded_in_every_locale_and_posted_at_most_every_ten_seconds
    stub_dictionary("en", { "Bonjour" => "Hello" })
    stub_usage
    with_locale(:fr) { I18n.t("Bonjour") }
    I18n.t("Bonjour")
    I18n.t("8 heures", context: "durée")
    I18n.t("Payer", namespace: "checkout") rescue nil
    assert_equal({ "default" => { "Bonjour" => today, "8 heures__durée" => today }, "checkout" => { "Payer" => today } },
                 I18nKeyless.translator.pending_usage)
    stub_dictionary("en", {}, namespace: "checkout")
    stub_translate
    flush
    assert_requested(:post, "#{I18nKeylessTest::API}/translate/last-used-translations", times: 1)
    body = posted_bodies("/translate/last-used-translations").first
    assert_equal "fr", body["primaryLanguage"]
    assert_equal({ "default" => { "Bonjour" => today, "8 heures__durée" => today }, "checkout" => { "Payer" => today } },
                 body["translationsUsageByNamespace"])
    assert_empty I18nKeyless.translator.pending_usage
    # same day, same keys: nothing changed, nothing sent
    I18n.t("Bonjour")
    flush
    assert_requested(:post, "#{I18nKeylessTest::API}/translate/last-used-translations", times: 1)
    # a new key changed the map, but the 10 s slot is taken: it waits in the cache
    I18n.t("Autre")
    flush
    assert_requested(:post, "#{I18nKeylessTest::API}/translate/last-used-translations", times: 1)
    assert I18nKeyless.translator.store.usage_dirty?
    cache.delete("#{I18nKeyless.translator.store.usage_key}:lock")
    flush
    assert_requested(:post, "#{I18nKeylessTest::API}/translate/last-used-translations", times: 2)
    refute I18nKeyless.translator.store.usage_dirty?
  end

  def test_a_failed_usage_post_keeps_the_changes
    stub_dictionary("en", { "Bonjour" => "Hello" })
    stub_request(:post, "#{I18nKeylessTest::API}/translate/last-used-translations").to_return(status: [500, "Internal Server Error"])
    I18n.t("Bonjour")
    flush
    assert I18nKeyless.translator.store.usage_dirty?
    assert_equal({ "default" => { "Bonjour" => today } }, I18nKeyless.translator.store.usage)
    assert_includes log.string, "send translations usage error: Internal Server Error"
  end

  def test_usage_disabled
    configure(usage: false)
    stub_dictionary("en", { "Bonjour" => "Hello" })
    assert_equal "Hello", I18n.t("Bonjour")
    assert_empty I18nKeyless.translator.pending_usage
    flush
    assert_not_requested(:post, "#{I18nKeylessTest::API}/translate/last-used-translations")
    refute I18nKeyless.translator.usage_enabled?
  end

  def test_usage_survives_a_broken_store
    stub_dictionary("en", { "Bonjour" => "Hello" })
    I18n.t("Bonjour")
    store = I18nKeyless.translator.store
    def store.merge_usage(_recorded)
      raise "cache down"
    end
    flush
    refute_includes log.string, "flush error"
  end
end

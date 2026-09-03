# frozen_string_literal: true

require "test_helper"

class ResilienceTest < I18nKeylessTest::Case
  def test_a_failed_first_fetch_serves_the_source_and_is_remembered
    stub_request(:get, "#{I18nKeylessTest::API}/translate/en").with(query: { last_refresh: "" }).to_return(status: [503, "Service Unavailable"])
    assert_equal "Bonjour", I18n.t("Bonjour")
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/en?last_refresh=", times: 3)
    assert_equal [500, 1500], sleeps
    entry = cache.read(dict_key("en"))
    assert entry[:failed]
    assert_equal({}, entry[:translations])
    assert_includes log.string, "i18n-keyless: fetch all translations error: Service Unavailable"
    # a second process within 60 s does not ask again, and the miss is still recorded
    I18nKeyless.reset!
    assert_equal "Bonjour", I18n.t("Bonjour")
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/en?last_refresh=", times: 3)
  end

  def test_a_stale_dictionary_is_served_then_revalidated_with_its_etag
    seed_dictionary("en", { "Bonjour" => "Hello" }, fetched_at: Time.now.to_i - 4000, etag: 'W/"v1"')
    stub_request(:get, "#{I18nKeylessTest::API}/translate/en").with(headers: { "If-None-Match" => 'W/"v1"' }).to_return(status: 304)
    stub_usage
    assert_equal "Hello", I18n.t("Bonjour")
    assert_not_requested(:get, %r{.*})
    flush
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/en", times: 1)
    entry = cache.read(dict_key("en"))
    assert_equal 'W/"v1"', entry[:etag]
    assert_in_delta Time.now.to_i, entry[:fetched_at], 5
    refute I18nKeyless.translator.store.stale?(entry)
  end

  def test_a_revalidation_with_a_new_dictionary_updates_the_process
    seed_dictionary("en", { "Bonjour" => "Hello" }, fetched_at: 0, etag: 'W/"v1"')
    stub_request(:get, "#{I18nKeylessTest::API}/translate/en").with(headers: { "If-None-Match" => 'W/"v1"' })
      .to_return(status: 200, body: envelope({ "Bonjour" => "Hi" }).to_json, headers: { "ETag" => 'W/"v2"' })
    stub_usage
    assert_equal "Hello", I18n.t("Bonjour")
    flush
    assert_equal "Hi", I18n.t("Bonjour")
    assert_equal 'W/"v2"', cache.read(dict_key("en"))[:etag]
  end

  def test_a_failed_revalidation_keeps_the_dictionary_and_backs_off
    seed_dictionary("en", { "Bonjour" => "Hello" }, fetched_at: 0, etag: 'W/"v1"')
    stub_request(:get, "#{I18nKeylessTest::API}/translate/en").to_return(status: [500, "Internal Server Error"])
    stub_usage
    assert_equal "Hello", I18n.t("Bonjour")
    flush
    entry = cache.read(dict_key("en"))
    assert_equal({ "Bonjour" => "Hello" }, entry[:translations])
    assert entry[:failed]
    assert_equal 'W/"v1"', entry[:etag]
    assert_equal "Hello", I18n.t("Bonjour")
  end

  def test_a_failed_post_releases_the_miss_for_a_later_request
    stub_dictionary("en")
    stub_request(:post, "#{I18nKeylessTest::API}/translate").to_return(status: [502, "Bad Gateway"])
    stub_usage
    I18n.t("Nouveau")
    flush
    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 3)
    assert_includes log.string, 'translate error for "Nouveau": Bad Gateway'
    stub_translate({ "en" => "New" })
    I18n.t("Nouveau")
    flush
    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 4)
    assert_equal "New", I18n.t("Nouveau")
  end

  def test_a_network_error_never_raises
    stub_request(:get, %r{.*}).to_raise(Errno::ECONNREFUSED)
    assert_equal "Bonjour", I18n.t("Bonjour")
    stub_request(:post, %r{.*}).to_timeout
    flush
    assert_includes log.string, 'translate error for "Bonjour": timeout'
  end

  def test_flush_survives_a_broken_cache
    stub_dictionary("en")
    I18n.t("Nouveau")
    broken = I18nKeyless.translator.store
    def broken.claim_miss(_miss)
      raise "cache down"
    end
    flush
    assert_includes log.string, "i18n-keyless: flush error: cache down"
  end

  def test_without_languages_nothing_is_sent_and_one_warning_is_logged
    configure(languages: nil)
    stub_dictionary("en")
    I18n.t("Nouveau")
    flush
    I18n.t("Encore")
    flush
    assert_not_requested(:post, "#{I18nKeylessTest::API}/translate")
    assert_equal 1, log.string.scan("I18N_KEYLESS_LANGUAGES is required").length
    assert_empty I18nKeyless.translator.pending_misses
  end

  def test_disabled_by_flag_or_missing_key
    configure(enabled: false)
    refute I18nKeyless.enabled?
    assert_kind_of I18n::Backend::Simple, I18n.backend
    assert_equal "Translation missing: en.Bonjour", I18n.t("Bonjour")
    assert_equal "Bonjour Ada", I18nKeyless.t("Bonjour %{name}", name: "Ada")
    assert_nil I18nKeyless.flush
    configure(api_key: nil)
    refute I18nKeyless.enabled?
    # a chained backend answers nil while the gem is off
    backend = I18nKeyless::Backend.new
    assert_nil backend.send(:lookup, :en, "Bonjour")
    assert_not_requested(:get, %r{.*})
  end

  def test_flush_before_any_lookup_is_a_no_op
    assert_nil I18nKeyless.flush
    assert_not_requested(:post, %r{.*})
  end
end

# frozen_string_literal: true

require "test_helper"
require "tmpdir"
require "fileutils"

# The precompiled bundle (PROTOCOL.md 7.4) through `bundle_path`: every
# (namespace, lang) the manifest covers is seeded at boot from the files,
# never fetched; anything else behaves exactly as without a bundle.
class BundleTest < I18nKeylessTest::Case
  CURSOR = "1757000000000"

  def setup
    super
    @dirs = []
  end

  def teardown
    @dirs.each { |dir| FileUtils.rm_rf(dir) }
    super
  end

  # Writes a bundle directory: `manifest.json` from `namespaces` (namespace =>
  # lang => dictionary), one `<namespace>/<lang>.json` per dictionary.
  def write_bundle(namespaces, cursor = CURSOR)
    dir = Dir.mktmpdir("i18n-keyless-bundle-")
    @dirs << dir
    manifest = { "primaryLanguage" => "fr", "languages" => %w[en es fr], "exportedAt" => cursor, "namespaces" => {} }
    namespaces.each do |namespace, langs|
      manifest["namespaces"][namespace] = { "lastRefresh" => cursor, "languages" => langs.keys }
      FileUtils.mkdir_p(File.join(dir, namespace))
      langs.each { |lang, translations| File.write(File.join(dir, namespace, "#{lang}.json"), JSON.generate(translations)) }
    end
    File.write(File.join(dir, "manifest.json"), JSON.generate(manifest))
    dir
  end

  def entry(lang, namespace = "default")
    cache.read(dict_key(lang, namespace))
  end

  def test_boot_seeds_every_covered_pair_without_a_request
    dir = write_bundle("default" => { "en" => { "Bonjour" => "Hello", "Merci" => "Thanks" }, "es" => { "Bonjour" => "Hola" },
                                      "fr" => { "Bonjour" => "Bonjour" } },
                       "checkout" => { "en" => { "Panier" => "Cart" } })
    configure(bundle_path: dir)

    assert_not_requested(:get, %r{.*})
    assert_equal({ "Bonjour" => "Hello", "Merci" => "Thanks" }, entry("en")[:translations])
    assert_equal({ "Bonjour" => "Hola" }, entry("es")[:translations])
    assert_equal({ "Panier" => "Cart" }, entry("en", "checkout")[:translations])
    assert_nil entry("fr"), "the primary language is never looked up, so never seeded"
    assert_equal CURSOR, entry("en")[:last_refresh]
    assert_nil entry("en")[:etag]
    refute_nil I18nKeyless.translator.bundle
  end

  def test_a_covered_pair_is_served_from_the_file_and_never_fetched
    dir = write_bundle("default" => { "en" => { "Bonjour" => "Hello" }, "es" => { "Bonjour" => "Hola" } })
    configure(bundle_path: dir)
    stub_request(:get, %r{.*}).to_return(status: 200, body: envelope({ "Bonjour" => "From the API" }).to_json)
    stub_usage

    assert_equal "Hello", I18n.t("Bonjour")
    with_locale(:es) { assert_equal "Hola", I18n.t("Bonjour") }
    flush

    assert_not_requested(:get, %r{.*})
    assert_not_requested(:post, "#{I18nKeylessTest::API}/translate")
  end

  def test_a_pair_the_manifest_does_not_cover_is_still_fetched
    # `checkout` lists only `en`; `es` and the `chat` namespace are not in the bundle.
    dir = write_bundle("default" => { "en" => { "Bonjour" => "Hello" } }, "checkout" => { "en" => { "Panier" => "Cart" } })
    configure(bundle_path: dir)
    stub_dictionary("es", { "Bonjour" => "Hola" })
    stub_dictionary("es", { "Panier" => "Carrito" }, namespace: "checkout")
    stub_dictionary("en", { "Salut" => "Hi" }, namespace: "chat")

    assert_equal "Cart", I18nKeyless.translate("Panier", namespace: "checkout")
    assert_equal "Hi", I18nKeyless.translate("Salut", namespace: "chat")
    with_locale(:es) do
      assert_equal "Hola", I18n.t("Bonjour")
      assert_equal "Carrito", I18nKeyless.translate("Panier", namespace: "checkout")
    end

    assert_requested(:get, "#{I18nKeylessTest::API}/translate/es?last_refresh=", times: 1)
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/es?last_refresh=&namespace=checkout", times: 1)
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/en?last_refresh=&namespace=chat", times: 1)
    assert_not_requested(:get, "#{I18nKeylessTest::API}/translate/en?last_refresh=")
    assert_not_requested(:get, "#{I18nKeylessTest::API}/translate/en?last_refresh=&namespace=checkout")
  end

  def test_a_miss_still_posts_and_its_answer_is_merged_next_to_the_bundle
    dir = write_bundle("default" => { "en" => { "Bonjour" => "Hello" } })
    configure(bundle_path: dir)
    stub_translate({ "fr" => "Au revoir", "en" => "Goodbye", "es" => "Adiós" })
    stub_usage

    assert_equal "Hello", I18n.t("Bonjour")
    assert_equal "Au revoir", I18n.t("Au revoir"), "a miss returns the source text"
    flush

    assert_not_requested(:get, %r{.*})
    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 1)
    assert_equal({ "key" => "Au revoir", "languages" => %w[fr en es], "primaryLanguage" => "fr" }, posted_bodies.first)
    assert_equal({ "Bonjour" => "Hello", "Au revoir" => "Goodbye" }, entry("en")[:translations])
    assert_equal CURSOR, entry("en")[:last_refresh], "a POST answer does not move the cursor"
    assert_equal "Goodbye", I18n.t("Au revoir")
  end

  def test_a_cache_newer_than_the_bundle_keeps_its_text_and_its_cursor
    dir = write_bundle("default" => { "en" => { "Bonjour" => "Hello", "Merci" => "Thanks" } })
    cache.write(dict_key("en"), { translations: { "Bonjour" => "Hello there" }, etag: 'W/"reviewed"', fetched_at: Time.now.to_i,
                                  failed: false, last_refresh: "1757000600000" })
    configure(bundle_path: dir)

    assert_equal "Hello there", I18n.t("Bonjour"), "the reviewed text of a fresher cache wins"
    assert_equal "Thanks", I18n.t("Merci"), "a key only the bundle has is merged underneath"
    flush

    assert_not_requested(:get, %r{.*})
    assert_equal "1757000600000", entry("en")[:last_refresh]
    assert_equal 'W/"reviewed"', entry("en")[:etag], "the cache keeps its ETag when it wins"
  end

  def test_a_cache_older_than_the_bundle_is_overwritten_but_keeps_its_extra_keys
    dir = write_bundle("default" => { "en" => { "Bonjour" => "Hello" } })
    cache.write(dict_key("en"), { translations: { "Bonjour" => "Old hello", "Au revoir" => "Goodbye" }, etag: 'W/"old"',
                                  fetched_at: 0, failed: false, last_refresh: "1756000000000" })
    configure(bundle_path: dir)

    assert_equal "Hello", I18n.t("Bonjour")
    assert_equal "Goodbye", I18n.t("Au revoir")
    flush

    assert_not_requested(:get, %r{.*}) # seeded fresh: no revalidation either
    assert_equal CURSOR, entry("en")[:last_refresh]
    assert_nil entry("en")[:etag]
  end

  def test_a_cache_without_a_cursor_never_outranks_the_bundle
    dir = write_bundle("default" => { "en" => { "Bonjour" => "Hello" } })
    # An entry written by a version of the gem that kept no cursor.
    cache.write(dict_key("en"), { translations: { "Bonjour" => "Stale" }, etag: 'W/"1"', fetched_at: Time.now.to_i, failed: false })
    configure(bundle_path: dir)

    assert_equal "Hello", I18n.t("Bonjour")
    assert_not_requested(:get, %r{.*})
  end

  def test_a_missing_dictionary_file_is_fetched_lazily_not_at_boot
    dir = write_bundle("default" => { "en" => { "Bonjour" => "Hello" }, "es" => { "Bonjour" => "Hola" } })
    File.delete(File.join(dir, "default", "en.json"))
    configure(bundle_path: dir)

    assert_not_requested(:get, %r{.*}) # boot never fetches
    assert_includes log.string, "bundle file"
    assert_includes log.string, "default/en is fetched instead"
    assert_equal({ "Bonjour" => "Hola" }, entry("es")[:translations])

    stub_dictionary("en", { "Bonjour" => "From the API" })
    assert_equal "From the API", I18n.t("Bonjour")
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/en?last_refresh=", times: 1)
  end

  def test_a_bundle_path_without_a_manifest_is_ignored_with_one_warning
    configure(bundle_path: File.join(Dir.tmpdir, "i18n-keyless-no-such-bundle-#{rand(1 << 32)}"))
    stub_dictionary("en", { "Bonjour" => "From the API" })

    assert_nil I18nKeyless.translator.bundle
    assert_equal 1, log.string.scan("manifest.json").length
    assert_equal "From the API", I18n.t("Bonjour")
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/en?last_refresh=", times: 1)
  end

  def test_reload_seeds_again_from_the_file_without_a_request
    dir = write_bundle("default" => { "en" => { "Bonjour" => "Hello" } })
    configure(bundle_path: dir)
    assert_equal "Hello", I18n.t("Bonjour")

    I18n.reload!
    assert_equal "Hello", I18n.t("Bonjour")
    assert_not_requested(:get, %r{.*})
  end

  def test_the_bundle_exposes_its_manifest
    dir = write_bundle("default" => { "en" => { "Bonjour" => "Hello" }, "fr" => { "Bonjour" => "Bonjour" } }, "checkout" => { "en" => {} })
    bundle = I18nKeyless::Bundle.load("#{dir}/")

    refute_nil bundle
    assert_equal dir, bundle.path
    assert_equal %w[default checkout], bundle.namespaces
    assert_equal [%w[default en], %w[default fr], %w[checkout en]], bundle.pairs
    assert_equal CURSOR, bundle.last_refresh("default")
    assert_nil bundle.last_refresh("chat")
    assert bundle.covers?("default", "fr")
    refute bundle.covers?("checkout", "fr")
    assert_equal({ translations: { "Bonjour" => "Hello" }, last_refresh: CURSOR }, bundle.seed("default", "en"))
    assert_equal({ translations: {}, last_refresh: CURSOR }, bundle.seed("checkout", "en"))
    assert_nil bundle.seed("checkout", "fr")
    assert_nil I18nKeyless::Bundle.load(nil)
    assert_nil I18nKeyless::Bundle.load("  ")
  end
end

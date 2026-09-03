# frozen_string_literal: true

require "test_helper"

class TranslationTest < I18nKeylessTest::Case
  def test_the_primary_locale_returns_the_source_and_calls_nothing
    with_locale(:fr) { assert_equal "Bonjour le monde", I18n.t("Bonjour le monde") }
    assert_not_requested(:get, %r{.*})
    assert_empty I18nKeyless.translator.pending_misses
  end

  def test_the_first_miss_fetches_the_dictionary_once_then_serves_from_the_process
    stub_dictionary("en", { "Bonjour le monde" => "Hello world", "Vide" => "" })
    assert_equal "Hello world", I18n.t("Bonjour le monde")
    assert_equal "Hello world", I18n.t("Bonjour le monde")
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/en?last_refresh=", times: 1)
    # the dictionary is in the cache, for every other process
    assert_equal "Hello world", cache.read(dict_key("en"))[:translations]["Bonjour le monde"]
    # an empty translation is a miss
    assert_equal "Vide", I18n.t("Vide")
    assert_equal ["default:Vide"], I18nKeyless.translator.pending_misses.map(&:id)
  end

  def test_a_miss_returns_the_source_now_and_is_posted_after_the_response
    stub_dictionary("en")
    stub_dictionary("es")
    stub_translate({ "fr" => "Changer de langue", "en" => "Switch language", "es" => "Cambiar idioma", "de" => nil })
    stub_usage
    assert_equal "Changer de langue", I18n.t("Changer de langue")
    with_locale(:es) { assert_equal "Changer de langue", I18n.t("Changer de langue") }
    assert_not_requested(:post, "#{I18nKeylessTest::API}/translate")
    miss = I18nKeyless.translator.pending_misses.first
    assert_equal %w[en es], miss.langs

    flush

    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 1)
    assert_equal({ "key" => "Changer de langue", "languages" => %w[fr en es], "primaryLanguage" => "fr" }, posted_bodies.first)
    # merged into the cache and into this process: the next lookup hits, no second POST
    assert_equal "Switch language", I18n.t("Changer de langue")
    with_locale(:es) { assert_equal "Cambiar idioma", I18n.t("Changer de langue") }
    assert_equal "Switch language", cache.read(dict_key("en"))[:translations]["Changer de langue"]
    assert_empty I18nKeyless.translator.pending_misses
    flush
    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 1)
  end

  def test_the_same_miss_is_posted_once_across_processes
    stub_dictionary("en")
    stub_translate
    stub_usage
    I18n.t("Nouveau")
    flush
    # a second process (a fresh translator on the same cache) sees the claim
    I18nKeyless.reset!
    I18nKeyless.translator.api.sleeper = ->(ms) { sleeps << ms }
    I18n.t("Nouveau")
    flush
    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 1)
  end

  def test_placeholders_are_i18n_s_job
    stub_dictionary("en", { "Bienvenue %{name}" => "Welcome %{name}" })
    assert_equal "Welcome Ada", I18n.t("Bienvenue %{name}", name: "Ada")
    # on a miss the source text gets the placeholders too
    assert_equal "Bonjour Ada", I18n.t("Bonjour %{name}", name: "Ada")
    assert_equal "Bonjour %{name}", I18n.t("Bonjour %{name}")
  end

  def test_context_through_t_and_through_the_helper
    stub_dictionary("en", { "8 heures__durée" => "8 hours", "8 heures__heure" => "8 AM", "8 heures" => "8 o'clock" })
    assert_equal "8 hours", I18n.t("8 heures", context: "durée")
    assert_equal "8 AM", I18n.t("8 heures", context: "heure")
    assert_equal "8 o'clock", I18n.t("8 heures")
    # a context miss never falls back to the plain entry, and never leaks key__context
    assert_equal "8 heures", I18n.t("8 heures", context: "inconnu")
    assert_equal ["default:8 heures__inconnu"], I18nKeyless.translator.pending_misses.map(&:id)
    helper = Object.new.extend(I18nKeyless::Helper)
    assert_equal "8 hours", helper.i18nk("8 heures", context: "durée")
    assert_equal "8 AM", helper.i18nk("8 heures", { name: "x" }, context: "heure")
  end

  def test_the_helper_interpolates_and_never_treats_the_text_as_a_rails_key
    stub_dictionary("en", { "Bienvenue %{name}__salut" => "Welcome %{name}", "fermer" => "close" })
    helper = Object.new.extend(I18nKeyless::Helper)
    assert_equal "Welcome Ada", helper.i18nk("Bienvenue %{name}", name: "Ada", context: "salut")
    assert_equal "Welcome Ada", helper.i18nk("Bienvenue %{name}", { name: "Ada" }, context: "salut")
    assert_equal "close", helper.i18nk("fermer")
    assert_equal "", helper.i18nk("")
    assert_equal "fermer", helper.i18nk("fermer", locale: :fr)
    assert_equal "close", I18nKeyless.t("fermer")
  end

  def test_namespaces
    stub_dictionary("en", { "Payer" => "Pay (default)" })
    stub_dictionary("en", { "Payer" => "Pay (checkout)" }, namespace: "checkout")
    stub_translate
    stub_usage
    assert_equal "Pay (default)", I18n.t("Payer")
    assert_equal "Pay (checkout)", I18n.t("Payer", namespace: "checkout")
    assert_equal "Pay (checkout)", I18nKeyless.t("Payer", namespace: "checkout")
    assert_equal "Panier", I18n.t("Panier", namespace: "checkout")
    flush
    assert_equal({ "key" => "Panier", "namespace" => "checkout", "languages" => %w[fr en es], "primaryLanguage" => "fr" }, posted_bodies.first)
    stub_dictionary("en", { "Panier" => "Cart" }, namespace: "check out")
    assert_equal "Cart", I18n.t("Panier", namespace: "check out")
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/en?last_refresh=&namespace=check%20out", times: 1)
  end

  def test_a_configured_namespace_is_the_default
    configure(namespace: "app")
    stub_dictionary("en", { "Bonjour" => "Hello" }, namespace: "app")
    assert_equal "Hello", I18n.t("Bonjour")
  end

  def test_yaml_lines_win_and_rails_keys_never_reach_the_api
    stub_dictionary("en", { "From the file" => "From the API" })
    assert_equal "From the YAML file", I18n.t("From the file")
    assert_equal "Hello from YAML", I18n.t("hello")
    assert_equal "Users", I18n.t("users.index.title")
    assert_equal "Users", I18n.t(:title, scope: "users.index")
    # a missing Rails key stays a missing translation
    assert_equal "Translation missing: en.users.index.missing", I18n.t("users.index.missing")
    assert_raises(I18n::MissingTranslationData) { I18n.t("users.index.missing", raise: true) }
    assert_equal "fallback", I18n.t("users.index.missing", default: "fallback")
    assert_equal "fallback", I18n.t(:missing, default: "fallback")
    assert_empty I18nKeyless.translator.pending_misses
    flush
    assert_not_requested(:post, "#{I18nKeylessTest::API}/translate")
  end

  def test_a_dotted_source_string_is_not_split
    stub_dictionary("en", { "Bonjour. Ça va ?" => "Hello. How are you?" })
    assert_equal "Hello. How are you?", I18n.t("Bonjour. Ça va ?")
  end

  def test_an_unknown_locale_returns_the_source_and_sends_nothing
    with_locale(:xx) { assert_equal "Bonjour", I18n.t("Bonjour") }
    assert_not_requested(:get, %r{.*})
    assert_empty I18nKeyless.translator.pending_misses
  end

  def test_rails_locales_are_mapped
    stub_dictionary("pt-BR", { "Bonjour" => "Olá" })
    with_locale(:"pt-BR") { assert_equal "Olá", I18n.t("Bonjour") }
    with_locale(:pt_BR) { assert_equal "Olá", I18n.t("Bonjour") }
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/pt-BR?last_refresh=", times: 1)
  end

  def test_a_locale_outside_the_configured_list_is_served_but_never_translated
    stub_dictionary("de", { "Bonjour" => "Hallo" })
    stub_translate
    stub_usage
    with_locale(:de) do
      assert_equal "Hallo", I18n.t("Bonjour")
      assert_equal "Neu", I18n.t("Neu")
    end
    flush
    # the miss is posted with the configured list (the API stores it as the project's languages), not `de`
    assert_equal %w[fr en es], posted_bodies.first["languages"]
  end

  def test_reload_forgets_the_process_dictionaries_but_keeps_the_cache
    stub_dictionary("en", { "Bonjour" => "Hello" })
    assert_equal "Hello", I18n.t("Bonjour")
    cache.write(dict_key("en"), { translations: { "Bonjour" => "Hi" }, etag: nil, fetched_at: Time.now.to_i, failed: false })
    assert_equal "Hello", I18n.t("Bonjour")
    I18n.reload!
    assert_equal "Hi", I18n.t("Bonjour")
    assert_requested(:get, "#{I18nKeylessTest::API}/translate/en?last_refresh=", times: 1)
  end

  def test_install_is_idempotent_and_uninstall_restores_the_backend
    chain = I18n.backend
    assert_kind_of I18n::Backend::Chain, chain
    assert_same chain, I18nKeyless.install!
    assert_equal 1, chain.backends.count { |b| b.is_a?(I18nKeyless::Backend) }
    I18nKeyless.uninstall!
    assert_kind_of I18n::Backend::Simple, I18n.backend
    assert_same I18n.backend, I18nKeyless.uninstall!
    only = I18nKeyless::Backend.new
    assert_same only, I18nKeyless.install!(only)
    I18n.backend = I18n::Backend::Chain.new(I18n::Backend::Simple.new, only, I18n::Backend::Simple.new)
    I18nKeyless.uninstall!
    assert_equal 2, I18n.backend.backends.length
  end

  def test_backend_protocol_methods
    backend = I18nKeyless::Backend.new
    assert_equal [], backend.available_locales
    assert backend.initialized?
    assert_same backend, backend.eager_load!
    assert_equal({}, backend.translations)
    assert_nil backend.store_translations(:en, { "a" => "b" })
    assert_same backend, backend.reload!
  end
end

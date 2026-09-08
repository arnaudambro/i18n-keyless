package io.i18nkeyless

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The precompiled bundle (docs/PROTOCOL.md 7.4): a namespace the manifest covers in the
 * current language is seeded from the shipped file, with the bundle's cursor, instead of
 * fetched, at boot and on a language switch. Storage wins only when newer and in the same
 * language. Everything not covered keeps the fetch, and a miss still POSTs.
 */
class BundleTest {
    companion object {
        const val CURSOR = "1757000000000"

        val manifest = BundleManifest.fromJson(
            mapOf(
                "primaryLanguage" to "fr",
                "languages" to listOf("en", "es", "fr"),
                "exportedAt" to CURSOR,
                "namespaces" to mapOf(
                    "default" to mapOf("lastRefresh" to CURSOR, "languages" to listOf("en", "es", "fr")),
                    "checkout" to mapOf("lastRefresh" to CURSOR, "languages" to listOf("en")),
                ),
            ),
        )

        val files = mapOf(
            "default/en" to mapOf("Bonjour" to "Hello", "Merci" to "Thanks"),
            "default/es" to mapOf("Bonjour" to "Hola", "Merci" to "Gracias"),
            "default/fr" to mapOf("Bonjour" to "Bonjour", "Merci" to "Merci"),
            "checkout/en" to mapOf("Panier" to "Cart"),
        )
    }

    /** A bundle whose loader records its calls. */
    class Loads(private val failing: Boolean = false) {
        val calls = CopyOnWriteArrayList<String>()
        val bundle = I18nKeylessBundle(manifest) { namespace, lang ->
            calls.add("$namespace/${lang.code}")
            if (failing) throw IllegalStateException("missing")
            files["$namespace/${lang.code}"]
        }
    }

    private fun storageWith(vararg entries: Pair<String, String>): MemoryStorage =
        MemoryStorage().apply { for ((key, value) in entries) setItem(key, value) }

    private fun boot(
        transport: FakeTransport,
        storage: MemoryStorage,
        bundle: I18nKeylessBundle?,
        languages: LanguagesConfig = LanguagesConfig(Lang.FR, listOf(Lang.FR, Lang.EN, Lang.ES)),
    ): I18nKeylessClient {
        val client = newClient(transport)
        client.init(
            I18nKeylessConfig(
                apiKey = "k-bundle",
                apiUrl = "https://api.test",
                languages = languages,
                storage = storage,
                bundle = bundle,
                logger = quietLogger(),
            ),
        ).get()
        client.waitForIdle()
        return client
    }

    private fun slice(storage: MemoryStorage, namespace: String = DEFAULT_NAMESPACE): Map<String, Any?>? =
        storage.getItem(StorageKeys.translationsKeyFor(namespace))?.let { Json.parse(it).asMap() }

    @Test
    fun `boot seeds every bundled namespace in the current language, with the bundle cursor, and fetches nothing`() {
        val transport = FakeTransport(mapOf("Fetched" to "From the API"))
        val storage = storageWith(StorageKeys.CURRENT_LANGUAGE to "en")
        val loads = Loads()
        val client = boot(transport, storage, loads.bundle)

        assertEquals(Lang.EN, client.currentLanguage)
        assertEquals("Hello", client.t("Bonjour"))
        assertEquals("Cart", client.t("Panier", namespace = "checkout"))
        assertEquals(mapOf("Bonjour" to "Hello", "Merci" to "Thanks", "Panier" to "Cart"), client.translationsSnapshot)
        assertTrue(transport.dictionaries.isEmpty())
        assertEquals(setOf("default/en", "checkout/en"), loads.calls.toSet())
        // Persisted like a fetched dictionary, so the delta cursor survives a reload.
        assertEquals(CURSOR, storage.getItem(StorageKeys.LAST_REFRESH))
        assertEquals(CURSOR, storage.getItem(StorageKeys.lastRefreshKeyFor("checkout")))
        assertEquals(listOf("default", "checkout"), Json.parse(storage.getItem(StorageKeys.NAMESPACES)!!))
    }

    @Test
    fun `boot seeds the bundled primary dictionary too, and fetches only an origin namespace the bundle does not cover`() {
        val transport = FakeTransport(mapOf("Fetched" to "From the API"))
        val storage = storageWith(StorageKeys.CURRENT_LANGUAGE to "fr", StorageKeys.ORIGIN_NAMESPACES to "[\"chat\"]")
        boot(transport, storage, Loads().bundle)

        assertEquals(mapOf("Bonjour" to "Bonjour", "Merci" to "Merci"), slice(storage))
        assertEquals(listOf("https://api.test/translate/fr?last_refresh=null&namespace=chat"), transport.dictionaries.map { it.url })
    }

    @Test
    fun `boot fetches a language the bundle does not cover for a namespace`() {
        val transport = FakeTransport(mapOf("Fetched" to "From the API"))
        val storage = storageWith(StorageKeys.CURRENT_LANGUAGE to "es")
        val client = boot(transport, storage, Loads().bundle)

        // default/es is bundled, checkout/es is not.
        assertEquals("Hola", client.t("Bonjour"))
        assertEquals(listOf("https://api.test/translate/es?last_refresh=null&namespace=checkout"), transport.dictionaries.map { it.url })
        assertEquals(mapOf("Fetched" to "From the API"), slice(storage, "checkout"))
    }

    @Test
    fun `boot keeps a stored slice on top of the bundle when it is newer and in the same language`() {
        val transport = FakeTransport()
        val newer = (CURSOR.toLong() + 60_000).toString()
        val storage = storageWith(
            StorageKeys.CURRENT_LANGUAGE to "en",
            StorageKeys.NAMESPACES to "[\"default\"]",
            StorageKeys.TRANSLATIONS to "{\"Bonjour\":\"Hello, reviewed\"}",
            StorageKeys.LAST_REFRESH to newer,
        )
        val client = boot(transport, storage, Loads().bundle)

        assertEquals("Hello, reviewed", client.t("Bonjour"))
        assertEquals("Thanks", client.t("Merci"))
        assertEquals(mapOf("Bonjour" to "Hello, reviewed", "Merci" to "Thanks"), slice(storage))
        assertEquals(newer, storage.getItem(StorageKeys.LAST_REFRESH))
        assertTrue(transport.dictionaries.isEmpty())
    }

    @Test
    fun `boot ignores a stored slice that is older than the bundle`() {
        val transport = FakeTransport()
        val storage = storageWith(
            StorageKeys.CURRENT_LANGUAGE to "en",
            StorageKeys.NAMESPACES to "[\"default\"]",
            StorageKeys.TRANSLATIONS to "{\"Bonjour\":\"Old hello\"}",
            StorageKeys.LAST_REFRESH to (CURSOR.toLong() - 60_000).toString(),
        )
        val client = boot(transport, storage, Loads().bundle)

        assertEquals("Hello", client.t("Bonjour"))
        assertEquals(CURSOR, storage.getItem(StorageKeys.LAST_REFRESH))
    }

    @Test
    fun `boot never mixes in a newer stored slice written in another language`() {
        val transport = FakeTransport()
        // Storage holds English, the app boots in Spanish (skipCurrentLanguageHydration).
        val storage = storageWith(
            StorageKeys.CURRENT_LANGUAGE to "en",
            StorageKeys.NAMESPACES to "[\"default\"]",
            StorageKeys.TRANSLATIONS to "{\"Bonjour\":\"Hello\"}",
            StorageKeys.LAST_REFRESH to (CURSOR.toLong() + 60_000).toString(),
        )
        val client = boot(
            transport,
            storage,
            Loads().bundle,
            LanguagesConfig(Lang.FR, listOf(Lang.FR, Lang.EN, Lang.ES), initWithDefault = Lang.ES, skipCurrentLanguageHydration = true),
        )

        assertEquals(Lang.ES, client.currentLanguage)
        assertEquals("Hola", client.t("Bonjour"))
        assertEquals(mapOf("Bonjour" to "Hola", "Merci" to "Gracias"), slice(storage))
        assertEquals(CURSOR, storage.getItem(StorageKeys.LAST_REFRESH))
    }

    @Test
    fun `boot falls back to the fetch when the loader throws`() {
        val transport = FakeTransport(mapOf("Fetched" to "From the API"))
        val storage = storageWith(StorageKeys.CURRENT_LANGUAGE to "en")
        val client = boot(transport, storage, Loads(failing = true).bundle)

        assertEquals(2, transport.dictionaries.size)
        assertEquals("From the API", client.t("Fetched"))
    }

    @Test
    fun `a language switch seeds the new language from the bundle and never mixes the previous language in`() {
        val transport = FakeTransport(mapOf("Fetched" to "From the API"))
        val storage = storageWith(StorageKeys.CURRENT_LANGUAGE to "en")
        val client = boot(transport, storage, Loads().bundle)
        assertTrue(transport.dictionaries.isEmpty())

        client.setLanguage(Lang.ES).get()
        client.waitForIdle()

        assertEquals("Hola", client.t("Bonjour"))
        assertEquals(mapOf("Bonjour" to "Hola", "Merci" to "Gracias"), slice(storage))
        assertEquals(CURSOR, storage.getItem(StorageKeys.LAST_REFRESH))
        // checkout has no Spanish file: fetched.
        assertEquals(listOf("https://api.test/translate/es?last_refresh=null&namespace=checkout"), transport.dictionaries.map { it.url })
    }

    @Test
    fun `a miss still POSTs, and the delta after it starts from the bundle cursor`() {
        val transport = FakeTransport(mapOf("Fetched" to "From the API"))
        val storage = storageWith(StorageKeys.CURRENT_LANGUAGE to "en")
        val client = boot(transport, storage, Loads().bundle)

        assertEquals("Nouveau", client.t("Nouveau"))
        client.waitForIdle()

        assertEquals("Nouveau", Json.parse(transport.translates.single().body!!).asMap()["key"])
        assertEquals(listOf("https://api.test/translate/en?last_refresh=$CURSOR"), transport.dictionaries.map { it.url })
        assertEquals("From the API", client.t("Fetched"))
        assertEquals("Hello", client.t("Bonjour"))
    }

    @Test
    fun `without a bundle it fetches exactly as before`() {
        val transport = FakeTransport()
        val storage = storageWith(StorageKeys.CURRENT_LANGUAGE to "en")
        boot(transport, storage, null)

        assertEquals(listOf("https://api.test/translate/en?last_refresh=null"), transport.dictionaries.map { it.url })
    }

    @Test
    fun `from reads the manifest now and the dictionaries on demand`(@TempDir dir: File) {
        File(dir, "default").mkdirs()
        File(dir, "manifest.json").writeText(
            Json.stringify(
                mapOf(
                    "primaryLanguage" to "fr",
                    "languages" to listOf("en", "fr"),
                    "exportedAt" to CURSOR,
                    "namespaces" to mapOf("default" to mapOf("lastRefresh" to CURSOR, "languages" to listOf("en", "fr"))),
                ),
            ),
        )
        File(dir, "default/en.json").writeText(Json.stringify(mapOf("Bonjour" to "Hello")))

        val bundle = I18nKeylessBundle.from { path -> File(dir, path).takeIf { it.isFile }?.readText() }
        assertEquals("fr", bundle.manifest.primaryLanguage)
        assertEquals(listOf("en", "fr"), bundle.manifest.namespaces["default"]?.languages)
        assertEquals(listOf("default"), bundleNamespaces(bundle.manifest))
        assertEquals(mapOf("Bonjour" to "Hello"), bundle.load("default", Lang.EN))
        assertEquals(null, bundle.load("default", Lang.FR))
        assertFalse(bundleCovers(bundle.manifest, "default", "es"))
        assertThrows(JsonException::class.java) { I18nKeylessBundle.from { null } }
    }
}

package io.i18nkeyless

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

/** The client end to end against a fake transport: the device model of PROTOCOL.md 5 to 11. */
class ClientTest {
    private val fixedClock: Clock = Clock.fixed(Instant.parse("2026-08-04T23:30:00Z"), ZoneOffset.UTC)

    @Test
    fun `before init the source text is rendered with replace applied`() {
        val client = newClient(FakeTransport())
        assertFalse(client.isInitialized)
        assertEquals("Hello Arnaud", client.t("Hello {{name}}", replace = mapOf("{{name}}" to "Arnaud")))
        assertThrows(IllegalStateException::class.java) { client.configuration }
    }

    @Test
    fun `init refuses an empty key or no supported language`() {
        val client = newClient(FakeTransport())
        assertThrows(IllegalArgumentException::class.java) { client.init(frEnConfig("")) }
        assertThrows(IllegalArgumentException::class.java) {
            client.init(I18nKeylessConfig(apiKey = "k", languages = LanguagesConfig(Lang.FR, emptyList())))
        }
    }

    @Test
    fun `boot with an empty storage persists a device id first and never replaces it`() {
        val storage = RecordingStorage()
        val transport = FakeTransport()
        val client = newClient(transport)
        client.init(frEnConfig("k-boot", storage)).get()
        client.waitForIdle()
        val id = storage.getItem(StorageKeys.UNIQUE_ID)
        assertNotNull(id)
        assertTrue(deviceIdPattern.matches(id!!), id)
        assertEquals(StorageKeys.UNIQUE_ID, storage.reads.first())
        assertEquals(id, client.deviceId)
        // A dictionary answer echoes another id: the persisted one wins.
        client.setLanguage(Lang.EN).get()
        client.waitForIdle()
        assertEquals(id, client.deviceId)
        assertEquals(id, storage.getItem(StorageKeys.UNIQUE_ID))
        // Every request carried it.
        for (request in transport.requests) assertEquals(id, request.headers["unique_id"])
    }

    @Test
    fun `an invalid stored id is replaced, a valid one is kept`() {
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.UNIQUE_ID, "bad id with spaces")
        val client = newClient(FakeTransport())
        client.init(frEnConfig("k-id", storage)).get()
        assertTrue(deviceIdPattern.matches(client.deviceId!!))

        val kept = MemoryStorage()
        kept.setItem(StorageKeys.UNIQUE_ID, "deviceIdABCDEF12")
        val second = newClient(FakeTransport())
        second.init(frEnConfig("k-id-2", kept)).get()
        assertEquals("deviceIdABCDEF12", second.deviceId)
    }

    @Test
    fun `hydration restores translations, namespaces, cursors, language and usage`() {
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.NAMESPACES, Json.stringify(listOf("default", "checkout")))
        storage.setItem(StorageKeys.TRANSLATIONS, Json.stringify(mapOf("Bonjour" to "Hello")))
        storage.setItem(StorageKeys.translationsKeyFor("checkout"), Json.stringify(mapOf("Payer" to "Pay")))
        storage.setItem(StorageKeys.LAST_REFRESH, "1700000000")
        storage.setItem(StorageKeys.CURRENT_LANGUAGE, "en")
        storage.setItem(StorageKeys.TRANSLATIONS_USAGE, Json.stringify(mapOf("default" to mapOf("Bonjour" to "2026-01-01"))))
        val transport = FakeTransport(mapOf("Bonjour" to "Hello", "Autre" to "Other"))
        val client = newClient(transport)
        var initLang: Lang? = null
        client.init(
            I18nKeylessConfig(
                apiKey = "k-hydrate",
                languages = LanguagesConfig(Lang.FR, listOf(Lang.FR, Lang.EN)),
                storage = storage,
                onInit = { initLang = it },
                logger = quietLogger(),
            ),
        ).get()
        assertEquals(Lang.EN, initLang)
        assertEquals(Lang.EN, client.currentLanguage)
        // Cached translations render before any network answer.
        assertEquals("Hello", client.translationsSnapshot["Bonjour"])
        assertEquals("Pay", client.translationsSnapshot["Payer"])
        client.waitForIdle()
        assertEquals("Hello", client.t("Bonjour"))
        assertEquals("Pay", client.t("Payer", namespace = "checkout"))
        // The boot language switch fetched both known namespaces with a null cursor.
        val urls = transport.dictionaries.map { it.url }
        assertTrue(urls.contains("$DEFAULT_API_URL/translate/en?last_refresh=null"), urls.toString())
        assertTrue(urls.contains("$DEFAULT_API_URL/translate/en?last_refresh=null&namespace=checkout"), urls.toString())
        assertEquals("Other", client.t("Autre"))
        // The seeded usage left once, at boot.
        assertEquals(1, transport.usages.size)
        assertEquals(mapOf("Bonjour" to "2026-01-01"), Json.parse(transport.usages.single().body!!).asMap()["translationsUsageByNamespace"].asMap()["default"])
    }

    @Test
    fun `a legacy flat usage map is discarded`() {
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.TRANSLATIONS_USAGE, Json.stringify(mapOf("Bonjour" to "2026-01-01")))
        val transport = FakeTransport()
        val client = newClient(transport)
        client.init(frEnConfig("k-legacy", storage)).get()
        client.waitForIdle()
        assertTrue(transport.usages.isEmpty())
    }

    @Test
    fun `skipCurrentLanguageHydration ignores the stored language`() {
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.CURRENT_LANGUAGE, "en")
        val client = newClient(FakeTransport())
        client.init(
            I18nKeylessConfig(
                apiKey = "k-skip",
                languages = LanguagesConfig(Lang.FR, listOf(Lang.FR, Lang.EN), initWithDefault = Lang.FR, skipCurrentLanguageHydration = true),
                storage = storage,
                logger = quietLogger(),
            ),
        ).get()
        assertEquals(Lang.FR, client.currentLanguage)
    }

    @Test
    fun `a miss posts the key, then the bulk fetch fills the cache and notifies`() {
        val transport = FakeTransport()
        val client = newClient(transport)
        client.init(frEnConfig("k-miss")).get()
        client.setLanguage(Lang.EN).get()
        client.waitForIdle()
        transport.requests.clear()
        val notified = CountDownLatch(1)
        client.addListener { if (client.t("Bonjour") == "Hello") notified.countDown() }
        // The API translates the key between the POST and the bulk fetch.
        transport.dictionary["Bonjour"] = "Hello"
        assertEquals("Bonjour", client.t("Bonjour"))
        client.waitForIdle()
        assertEquals(1, transport.translates.size)
        assertEquals(
            mapOf("key" to "Bonjour", "languages" to listOf("fr", "en"), "primaryLanguage" to "fr"),
            Json.parse(transport.translates.single().body!!),
        )
        assertEquals(1, transport.dictionaries.size)
        assertEquals("Hello", client.t("Bonjour"))
        assertTrue(notified.await(1, java.util.concurrent.TimeUnit.SECONDS))
    }

    @Test
    fun `the same text rendered twice is one request, and is not re-requested until the fetch lands`() {
        val transport = FakeTransport().apply { gate = CountDownLatch(1) }
        val client = newClient(transport)
        client.init(frEnConfig("k-dedupe")).get()
        client.setLanguage(Lang.EN).get()
        repeat(5) { client.t("Bonjour") }
        client.t("Bonjour", context = "greeting") // same queue id: the context is not part of it
        transport.awaitInFlight(1)
        repeat(5) { client.text("  Bonjour  ") }
        transport.release()
        client.waitForIdle()
        assertEquals(1, transport.translates.size)
        // The fetch landed without the key (the fake answers an empty dictionary): the next
        // render requests it again.
        client.t("Bonjour")
        client.waitForIdle()
        assertEquals(2, transport.translates.size)
    }

    @Test
    fun `31 misses run at most 30 in flight`() {
        val transport = FakeTransport().apply { gate = CountDownLatch(1) }
        val client = newClient(transport)
        client.init(frEnConfig("k-peak")).get()
        client.setLanguage(Lang.EN).get()
        repeat(31) { client.t("key-$it") }
        transport.awaitInFlight(30)
        Thread.sleep(20)
        assertEquals(30, transport.peakInFlightTranslates.get())
        transport.release()
        client.waitForIdle()
        assertEquals(31, transport.translates.size)
        assertEquals(30, transport.peakInFlightTranslates.get())
    }

    @Test
    fun `usage is recorded per render with the UTC date and sent once per init`() {
        val storage = MemoryStorage()
        val transport = FakeTransport(mapOf("Bonjour" to "Hello"))
        val client = newClient(transport, fixedClock)
        client.init(frEnConfig("k-usage", storage)).get()
        client.waitForIdle()
        assertTrue(transport.usages.isEmpty(), "an empty map is never sent")
        client.t("Bonjour")
        client.t("8 heures", context = "time")
        client.t("Payer", namespace = "checkout")
        client.t("Transient", namespace = "chat-1", unpersistedNamespace = true)
        client.waitForIdle()
        val recorded = Json.parse(storage.getItem(StorageKeys.TRANSLATIONS_USAGE)!!)
        assertEquals(
            mapOf("default" to mapOf("Bonjour" to "2026-08-04", "8 heures__time" to "2026-08-04"), "checkout" to mapOf("Payer" to "2026-08-04")),
            recorded,
        )
        assertTrue(transport.usages.isEmpty(), "sent once per init, not per render")

        // The next boot sends it, with the exact header set, then clears it.
        val second = newClient(transport, fixedClock)
        second.init(frEnConfig("k-usage", storage)).get()
        second.waitForIdle()
        val request = transport.usages.single()
        assertEquals("$DEFAULT_API_URL/translate/last-used-translations", request.url)
        assertEquals(
            setOf("Content-Type", "Authorization", "Version", "sdk", "unique_id"),
            request.headers.keys,
        )
        assertEquals(SDK_RUNTIME_CLIENT, request.headers["sdk"])
        assertEquals(VERSION, request.headers["Version"])
        assertEquals("Bearer k-usage", request.headers["Authorization"])
        assertEquals("application/json", request.headers["Content-Type"])
        assertEquals(second.deviceId, request.headers["unique_id"])
        assertEquals(mapOf("primaryLanguage" to "fr", "translationsUsageByNamespace" to recorded), Json.parse(request.body!!))
        assertEquals("", storage.getItem(StorageKeys.TRANSLATIONS_USAGE))
    }

    @Test
    fun `server mode sends kotlin-server, no device id, and no usage`() {
        val storage = RecordingStorage()
        val transport = FakeTransport(mapOf("Bonjour" to "Hello"))
        val client = newClient(transport)
        client.init(frEnConfig("k-server", storage, server = true)).get()
        assertEquals(SDK_RUNTIME_SERVER, client.runtime)
        assertNull(client.deviceId)
        assertFalse(StorageKeys.UNIQUE_ID in storage.reads, "a server never reads or mints a device id")
        client.setLanguage(Lang.EN).get()
        assertEquals("Hello", client.t("Bonjour"))
        client.t("Autre")
        client.waitForIdle()
        assertTrue(transport.requests.isNotEmpty())
        for (request in transport.requests) {
            assertEquals(SDK_RUNTIME_SERVER, request.headers["sdk"])
            assertFalse("unique_id" in request.headers)
        }
        assertTrue(transport.usages.isEmpty())
        assertNull(storage.getItem(StorageKeys.TRANSLATIONS_USAGE))
        assertNull(storage.getItem(StorageKeys.UNIQUE_ID))
    }

    @Test
    fun `a 304 keeps the stored dictionary and the ETag`() {
        val transport = FakeTransport(mapOf("Bonjour" to "Hello")).apply { etag = "W/\"v1\"" }
        val client = newClient(transport)
        client.init(frEnConfig("k-304")).get()
        client.setLanguage(Lang.EN).get()
        assertEquals("Hello", client.t("Bonjour"))
        assertEquals("W/\"v1\"", client.dictionaryEtags[etagCacheKey("k-304", "en")])
        // A miss triggers a refetch: it revalidates and the answer is a 304.
        client.t("Autre")
        client.waitForIdle()
        val revalidation = transport.dictionaries.last()
        assertEquals("$DEFAULT_API_URL/translate/en", revalidation.url)
        assertEquals("W/\"v1\"", revalidation.headers["If-None-Match"])
        assertEquals("Hello", client.t("Bonjour"))
        assertEquals("W/\"v1\"", client.dictionaryEtags[etagCacheKey("k-304", "en")])
    }

    @Test
    fun `a language switch validates, persists, resets the cursors and refetches every known namespace`() {
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.NAMESPACES, Json.stringify(listOf("default", "checkout")))
        storage.setItem(StorageKeys.TRANSLATIONS, "{}")
        storage.setItem(StorageKeys.translationsKeyFor("checkout"), "{}")
        val transport = FakeTransport(mapOf("Bonjour" to "Hello"))
        val client = newClient(transport)
        val switched = ArrayList<Lang>()
        client.init(
            I18nKeylessConfig(
                apiKey = "k-switch",
                languages = LanguagesConfig(Lang.FR, listOf(Lang.FR, Lang.EN), fallback = Lang.EN),
                storage = storage,
                onSetLanguage = { switched.add(it) },
                logger = quietLogger(),
            ),
        ).get()
        client.waitForIdle()
        transport.requests.clear()
        client.setLanguage(Lang.EN).get()
        assertEquals(Lang.EN, client.currentLanguage)
        assertEquals("en", storage.getItem(StorageKeys.CURRENT_LANGUAGE))
        assertEquals(2, transport.dictionaries.size)
        assertEquals("1", storage.getItem(StorageKeys.LAST_REFRESH))
        assertEquals("1", storage.getItem(StorageKeys.lastRefreshKeyFor("checkout")))
        assertEquals("1", client.lastRefresh)

        // An unsupported language falls back; the cursors are reset before the fetch.
        client.setLanguage(Lang.JA).get()
        assertEquals(Lang.EN, client.currentLanguage)
        assertEquals(listOf(Lang.EN, Lang.JA), switched)

        // Back to the primary: nothing fetched, the cursors are reset to the empty string.
        transport.requests.clear()
        client.setLanguage(Lang.FR).get()
        assertTrue(transport.dictionaries.isEmpty())
        assertEquals("", storage.getItem(StorageKeys.LAST_REFRESH))
        assertNull(client.lastRefresh)
        assertEquals("Bonjour", client.t("Bonjour"))
    }

    @Test
    fun `a UGC namespace is fetched in the primary language too`() {
        val storage = MemoryStorage()
        val transport = FakeTransport(mapOf("Hola mundo" to "Bonjour le monde"))
        val client = newClient(transport)
        client.init(frEnConfig("k-ugc", storage, supported = listOf(Lang.FR, Lang.EN, Lang.ES))).get()
        client.waitForIdle()
        client.t("Hola mundo", originLanguage = Lang.ES)
        client.waitForIdle()
        assertEquals("[\"default\"]", storage.getItem(StorageKeys.ORIGIN_NAMESPACES))
        assertEquals("Bonjour le monde", client.t("Hola mundo", originLanguage = Lang.ES))
        transport.requests.clear()
        client.setLanguage(Lang.FR).get()
        assertEquals(1, transport.dictionaries.size)
    }

    @Test
    fun `an unpersisted namespace never touches storage`() {
        val storage = MemoryStorage()
        val transport = FakeTransport(mapOf("Hi" to "Salut"))
        val client = newClient(transport)
        client.init(frEnConfig("k-unpersisted", storage)).get()
        client.setLanguage(Lang.EN).get()
        client.t("Hi", namespace = "chat-1", unpersistedNamespace = true)
        client.waitForIdle()
        assertEquals("Salut", client.t("Hi", namespace = "chat-1", unpersistedNamespace = true))
        assertNull(storage.getItem(StorageKeys.translationsKeyFor("chat-1")))
        assertNull(storage.getItem(StorageKeys.lastRefreshKeyFor("chat-1")))
        assertEquals(listOf("default"), Json.parse(storage.getItem(StorageKeys.NAMESPACES)!!))
    }

    @Test
    fun `clearStorage removes the cache and keeps the device id and the config`() {
        val storage = MemoryStorage()
        val transport = FakeTransport(mapOf("Bonjour" to "Hello"))
        val client = newClient(transport)
        client.init(frEnConfig("k-clear-2", storage)).get()
        client.setLanguage(Lang.EN).get()
        client.t("Bonjour")
        client.waitForIdle()
        val id = client.deviceId!!
        assertEquals("Hello", client.t("Bonjour"))
        client.clearStorage()
        assertEquals(mapOf(StorageKeys.UNIQUE_ID to id), storage.entries)
        assertEquals(id, client.deviceId)
        assertTrue(client.isInitialized)
        assertEquals("Bonjour", client.t("Bonjour"))
    }

    @Test
    fun `a failed fetch never clears the cache and never throws`() {
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.TRANSLATIONS, Json.stringify(mapOf("Bonjour" to "Hello")))
        storage.setItem(StorageKeys.CURRENT_LANGUAGE, "en")
        val transport = ScriptedTransport(listOf(mapOf("status" to 500L, "statusText" to "Internal Server Error")))
        val logs = ArrayList<String>()
        val client = I18nKeylessClient(api = Api(transport, RecordingSleeper(), timeoutMs = 20))
        client.init(frEnConfig("k-fail", storage, logger = { logs.add(it) })).get()
        client.t("Autre")
        client.waitForIdle()
        assertEquals("Hello", client.t("Bonjour"))
        assertEquals("Autre", client.t("Autre"))
        assertTrue(logs.any { "Internal Server Error" in it }, logs.toString())
    }

    @Test
    fun `custom handlers replace the HTTP calls`() {
        val handled = ArrayList<String>()
        val transport = FakeTransport()
        val client = newClient(transport)
        client.init(
            I18nKeylessConfig(
                apiKey = "k-handlers",
                languages = LanguagesConfig(Lang.FR, listOf(Lang.FR, Lang.EN)),
                handleTranslate = { key -> handled.add(key); HandleTranslateResult(ok = true) },
                getAllTranslations = { TranslationsResponse(ok = true, translations = mapOf("Bonjour" to "Hello")) },
                sendTranslationsUsage = { UsageResponse(ok = true) },
                logger = quietLogger(),
            ),
        ).get()
        client.setLanguage(Lang.EN).get()
        assertEquals("Hello", client.t("Bonjour"))
        client.t("Autre")
        client.waitForIdle()
        assertEquals(listOf("Autre"), handled)
        assertTrue(transport.requests.isEmpty())
    }

    @Test
    fun `listeners fire on the language switch and on a merge, and can be removed`() {
        val transport = FakeTransport(mapOf("Bonjour" to "Hello"))
        val client = newClient(transport)
        client.init(frEnConfig("k-listeners")).get()
        val calls = AtomicInteger()
        val listener = { calls.incrementAndGet(); Unit }
        client.addListener(listener)
        client.setLanguage(Lang.EN).get()
        client.waitForIdle()
        assertTrue(calls.get() >= 2, "switch + merge: ${calls.get()}")
        client.removeListener(listener)
        val before = calls.get()
        client.setLanguage(Lang.FR).get()
        assertEquals(before, calls.get())
    }

    @Test
    fun `the component path trims and warns once, the function path does not`(@TempDir dir: File) {
        val logs = ArrayList<String>()
        val transport = FakeTransport().apply { gate = CountDownLatch(1) }
        val client = newClient(transport)
        client.init(frEnConfig("k-trim", FileStorage(dir), logger = { logs.add(it) }, debug = true)).get()
        client.setLanguage(Lang.EN).get()
        client.text("  Bonjour ")
        client.text("  Bonjour ")
        client.t(" Bonjour ")
        transport.awaitInFlight(2)
        transport.release()
        client.waitForIdle()
        assertEquals(setOf("Bonjour", " Bonjour "), transport.translates.map { Json.parse(it.body!!).asMap()["key"] }.toSet())
        assertEquals(1, logs.count { "whitespace" in it })
    }

    @Test
    fun `FileStorage persists across clients and survives a restart`(@TempDir dir: File) {
        val transport = FakeTransport(mapOf("Bonjour" to "Hello"))
        val first = newClient(transport)
        first.init(frEnConfig("k-file", FileStorage(dir))).get()
        first.setLanguage(Lang.EN).get()
        first.t("Payer", namespace = "check out/1")
        first.waitForIdle()
        val id = first.deviceId

        val second = newClient(FakeTransport())
        second.init(frEnConfig("k-file", FileStorage(dir))).get()
        assertEquals(id, second.deviceId)
        assertEquals(Lang.EN, second.currentLanguage)
        assertEquals("Hello", second.t("Bonjour"))
        assertEquals("Hello", second.t("Bonjour", namespace = "check out/1"))
        second.waitForIdle()
    }

    @Test
    fun `the default instance delegates to its client`() {
        val transport = FakeTransport(mapOf("Bonjour" to "Hello"))
        I18nKeyless.client = newClient(transport)
        I18nKeyless.initBlocking(frEnConfig("k-object"))
        I18nKeyless.setLanguage(Lang.EN).get()
        assertEquals(Lang.EN, I18nKeyless.currentLanguage)
        assertEquals("Hello", I18nKeyless.text(" Bonjour "))
        assertEquals(listOf(Lang.FR, Lang.EN), I18nKeyless.supportedLanguages)
    }
}

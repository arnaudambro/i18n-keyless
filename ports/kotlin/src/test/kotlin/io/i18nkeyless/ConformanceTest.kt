package io.i18nkeyless

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.util.concurrent.CountDownLatch

/**
 * Replays the language-neutral vectors of the `conformance/vectors` directory (see
 * `conformance/README.md` and `docs/PROTOCOL.md` at the repository root).
 *
 * The vectors are read from the repository at test time. Cases for the `node` runtime are
 * not applicable (this port has no debounced server usage); every device case runs with
 * `server = false` and every `*-server` case with `server = true`.
 */
class ConformanceTest {
    companion object {
        @JvmStatic
        @BeforeAll
        fun vectorsPresent() {
            assumeTrue(vectorsDir.isDirectory, "conformance/vectors not found at ${vectorsDir.absolutePath}")
        }
    }

    private fun tests(vector: String, field: String = "cases", body: (Map<String, Any?>) -> Unit): List<DynamicTest> =
        casesOf(loadVector(vector), field).map { case -> dynamicTest(nameOf(case)) { body(case) } }

    @TestFactory
    fun `storage-key json`() = tests("storage-key.json") { c ->
        val input = c["input"].asMap()
        assertEquals(c["expected"], storageKeyFor(input["key"] as String, input["context"] as String?))
    }

    @TestFactory
    fun `replace json`() = tests("replace.json") { c ->
        val input = c["input"].asMap()
        assertEquals(c["expected"], applyReplace(input["text"] as String, (input["replace"] as Map<*, *>?)?.asStringMap()))
    }

    @Test
    fun `namespace json constant`() {
        assertEquals(loadVector("namespace.json")["defaultNamespace"], DEFAULT_NAMESPACE)
    }

    @TestFactory
    fun `namespace json`() = tests("namespace.json") { c ->
        val input = c["input"].asMap()
        val options = input["options"]?.let { optionsOf(it) }
        if (c["fn"] == "resolveNamespace") {
            assertEquals(c["expected"], resolveNamespace(options?.namespace, input["config"].asMap()["defaultNamespace"] as String?))
        } else {
            assertEquals(c["expected"], resolveOriginLanguage(options?.originLanguage, langOf(input["primary"]))?.code)
        }
    }

    @TestFactory
    fun `resolve-lang json`() = tests("resolve-lang.json") { c ->
        val input = c["input"].asMap()
        val resolved = resolveLang(
            input["tag"] as String?,
            supported = (input["supported"] as List<*>?)?.map { langOf(it) },
            fallback = input["fallback"]?.let { langOf(it) },
        )
        assertEquals(c["expected"], resolved?.code)
    }

    @TestFactory
    fun `languages json`() = tests("languages.json") { c ->
        when (c["check"]) {
            "availableLangs" -> assertEquals(c["expected"], AVAILABLE_LANG_CODES)
            "rename" -> {
                assertNull(Lang.fromCode(c["input"] as String))
                assertTrue(c["expected"] in AVAILABLE_LANG_CODES)
            }
            "stillAvailable" -> assertTrue(AVAILABLE_LANG_CODES.containsAll(c["input"].asList()))
            "absent" -> assertFalse(c["input"] in AVAILABLE_LANG_CODES)
            "regionalized" -> assertEquals(c["expected"].asList().toSet(), AVAILABLE_LANG_CODES.filter { '-' in it }.toSet())
            else -> fail("unknown check ${c["check"]}")
        }
    }

    @Test
    fun `app-store-locales json distinct slots`() {
        assertEquals((loadVector("app-store-locales.json")["distinctSlots"] as Long).toInt(), AVAILABLE_LANGS.map(::toAppStoreLocale).toSet().size)
    }

    @TestFactory
    fun `app-store-locales json`() = tests("app-store-locales.json") { c ->
        assertEquals(c["expected"], toAppStoreLocale(langOf(c["input"])))
    }

    @Test
    fun `unique-id json generation`() {
        val vector = loadVector("unique-id.json")
        val pattern = Regex(vector["idPattern"] as String)
        assertEquals(vector["alphabet"], UNIQUE_ID_ALPHABET)
        assertEquals((vector["alphabetLength"] as Long).toInt(), UNIQUE_ID_ALPHABET.length)
        assertEquals((vector["idLength"] as Long).toInt(), UNIQUE_ID_LENGTH)
        assertEquals((vector["largestUsableByteExclusive"] as Long).toInt(), UNIQUE_ID_LARGEST_USABLE_BYTE)
        assertEquals(vector["storageKey"], StorageKeys.UNIQUE_ID)
        repeat(200) {
            val id = generateUniqueId()
            assertEquals(UNIQUE_ID_LENGTH, id.length)
            assertTrue(pattern.matches(id), id)
            assertTrue(isUniqueId(id))
        }
    }

    @TestFactory
    fun `unique-id json`() = tests("unique-id.json") { c ->
        assertEquals(c["expected"], isUniqueId(c["input"]))
    }

    @Test
    fun `backoff json constants`() {
        val vector = loadVector("backoff.json")
        assertEquals((vector["timeoutMs"] as Long).toInt(), Api.DEFAULT_TIMEOUT_MS)
        assertEquals(vector["delaysMs"].asList().map { (it as Long) }, Api.DEFAULT_RETRY_DELAYS_MS)
        assertEquals((vector["maxAttempts"] as Long).toInt(), Api.MAX_ATTEMPTS)
    }

    @TestFactory
    fun `backoff json schedule`() = tests("backoff.json") { c ->
        val failed = (c["input"].asMap()["failedAttempt"] as Long).toInt()
        val expected = c["expected"].asMap()
        val delays = Api.DEFAULT_RETRY_DELAYS_MS
        if (failed <= delays.size) {
            assertEquals(expected["waitMs"], delays[failed - 1])
            assertEquals(expected["nextAttempt"], (failed + 1).toLong())
        } else {
            assertNull(expected["waitMs"])
            assertNull(expected["nextAttempt"])
        }
    }

    @TestFactory
    fun `backoff json scenarios`() = tests("backoff.json", "scenarios") { s ->
        val transport = ScriptedTransport(s["responses"].asList().map { it.asMap() })
        val sleeper = RecordingSleeper()
        val api = Api(transport, sleeper, timeoutMs = 20)
        val result = api.get("https://api.test/translate/en", emptyMap())
        val expected = s["expected"].asMap()
        assertEquals((expected["attempts"] as Long).toInt(), api.attempts)
        assertEquals(expected["sleepsMs"].asList(), sleeper.sleeps)
        val expectedResult = expected["result"].asMap()
        assertEquals(expectedResult["ok"], result.ok)
        if ("error" in expectedResult) assertEquals(expectedResult["error"], result.error)
        if ("notModified" in expectedResult) assertEquals(expectedResult["notModified"], result.notModified)
        if (expectedResult["ok"] == true && !result.notModified) assertEquals(expectedResult, result.json)
    }

    @TestFactory
    fun `retry-decision json`() = tests("retry-decision.json") { c ->
        val input = c["input"].asMap()
        val expected = c["expected"].asMap()
        val status = (input["status"] as Long).toInt()
        val outcome = LinkedHashMap(input)
        if (status == 200) {
            outcome["body"] = mapOf("ok" to true)
            outcome["headers"] = mapOf("etag" to "\"e1\"")
        }
        val transport = ScriptedTransport(listOf(outcome))
        val sleeper = RecordingSleeper()
        val api = Api(transport, sleeper)
        val result = api.get("https://api.test/translate/en", emptyMap())
        when (expected["action"]) {
            "parse-body" -> {
                assertEquals(1, api.attempts)
                assertTrue(result.ok)
                assertEquals(mapOf("ok" to true), result.json)
                assertEquals("\"e1\"", result.etag)
            }
            "not-modified" -> {
                assertEquals(1, api.attempts)
                assertTrue(result.ok)
                assertTrue(result.notModified)
            }
            "fail" -> {
                assertEquals(1, api.attempts)
                assertTrue(sleeper.sleeps.isEmpty())
                assertFalse(result.ok)
                assertEquals(expected["error"], result.error)
            }
            "retry" -> {
                assertEquals(3, api.attempts)
                assertEquals(2, sleeper.sleeps.size)
                assertFalse(result.ok)
                assertEquals(expected["error"], result.error)
            }
            else -> fail("unknown action ${expected["action"]}")
        }
        assertEquals(isRetryableStatus(status), expected["action"] == "retry")
    }

    @Test
    fun `queue json constants`() {
        val vector = loadVector("queue.json")
        assertEquals((vector["concurrency"] as Long).toInt(), PQueue().concurrency)
        assertEquals("namespace + ':' + key", vector["idRule"])
    }

    @TestFactory
    fun `queue json ids`() = tests("queue.json") { c ->
        val input = c["input"].asMap()
        assertEquals(c["expected"], queueIdFor(input["namespace"] as String, input["key"] as String))
    }

    @TestFactory
    fun `queue json scenarios`() = tests("queue.json", "scenarios") { s ->
        val transport = FakeTransport().apply { gate = CountDownLatch(1) }
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.CURRENT_LANGUAGE, "en")
        (s["translations"] as Map<*, *>?)?.let { storage.setItem(StorageKeys.TRANSLATIONS, Json.stringify(it)) }
        val client = newClient(transport)
        client.init(frEnConfig("k-queue", storage, apiUrl = "https://api.test", supported = listOf(Lang.FR, Lang.EN, Lang.ES, Lang.PT))).get()
        val calls: List<Map<String, Any?>> =
            if (s["calls"] is String) (0 until 31).map { mapOf("key" to "key-$it") } else s["calls"].asList().map { it.asMap() }
        for (call in calls) client.translate(call["key"] as String, optionsOf(call["options"]))
        val expected = s["expected"].asMap()
        val peak = expected["peakInFlight"] as Long?
        // Let the queue hand its tasks to the transport, then open the gate.
        if (peak != null) transport.awaitInFlight(peak.toInt())
        transport.release()
        client.waitForIdle()
        assertEquals((expected["requests"] as Long).toInt(), transport.translates.size)
        if (peak != null) assertEquals(peak.toInt(), transport.peakInFlightTranslates.get())
    }

    @TestFactory
    fun `translation-lookup json`() = tests("translation-lookup.json") { c ->
        val input = c["input"].asMap()
        val store = input["store"].asMap()
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.CURRENT_LANGUAGE, store["currentLanguage"] as String)
        val translations = store["translations"].asStringMap()
        if (translations.isNotEmpty()) storage.setItem(StorageKeys.TRANSLATIONS, Json.stringify(translations))
        // The gate keeps the miss from settling before the queued namespaces are read.
        val transport = FakeTransport().apply { gate = CountDownLatch(1) }
        val client = newClient(transport)
        client.init(
            I18nKeylessConfig(
                apiKey = "k-lookup",
                apiUrl = "https://api.test",
                defaultNamespace = store["defaultNamespace"] as String?,
                languages = LanguagesConfig(primary = langOf(store["primary"]), supported = listOf(Lang.FR, Lang.EN, Lang.ES)),
                storage = storage,
                logger = quietLogger(),
            ),
        ).get()
        val text = client.translate(input["key"] as String, optionsOf(input["options"]))
        val queued = client.namespacesAwaitingFetch.map { mapOf("namespace" to it.key, "unpersisted" to it.value) }
        val expected = c["expected"].asMap()
        assertEquals(expected["text"], text)
        assertEquals(expected["queued"], queued)
        transport.release()
        client.waitForIdle()
    }

    /** `react-client` runs as a device, `react-server` as a server; `node` does not apply. */
    private fun serverFor(runtime: String): Boolean? = when (runtime) {
        "react-client" -> false
        "react-server" -> true
        else -> null
    }

    @TestFactory
    fun `translate-request json`() = tests("translate-request.json") { c ->
        val input = c["input"].asMap()
        val server = serverFor(input["runtime"] as String)
        assumeTrue(server != null, "runtime ${input["runtime"]} is not applicable to this port")
        val config = input["config"].asMap()
        val expected = c["expected"].asMap()
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.CURRENT_LANGUAGE, input["currentLanguage"] as String)
        input["translations"]?.let { storage.setItem(StorageKeys.TRANSLATIONS, Json.stringify(it)) }
        val transport = FakeTransport()
        val handlerArgs = ArrayList<String>()
        val client = newClient(transport)
        client.init(
            configFrom(
                config,
                storage = storage,
                server = server!!,
                handleTranslate = if (config["handleTranslate"] == true) { key -> handlerArgs.add(key); HandleTranslateResult(ok = true) } else null,
            ),
        ).get()
        client.translate(input["key"] as String, optionsOf(input["options"]))
        client.waitForIdle()
        if (expected["http"] == false) {
            assertTrue(transport.translates.isEmpty())
            assertEquals(expected["handlerArgs"], handlerArgs)
            return@tests
        }
        val request = transport.translates.single()
        assertEquals(expected["url"], request.url)
        assertEquals(expected["method"], request.method)
        expectHeaders(request, expected["headers"].asMap())
        assertEquals(expected["body"], Json.parse(request.body!!))
    }

    @TestFactory
    fun `dictionary-request json`(): List<DynamicTest> = casesOf(loadVector("dictionary-request.json")).flatMap { c ->
        val input = c["input"].asMap()
        val server = serverFor(input["runtime"] as String)
        val config = input["config"].asMap()
        val expected = c["expected"].asMap()
        val target = input["targetLanguage"] as String
        val namespace = input["namespace"] as String?
        val knownEtag = input["knownEtag"] as String?
        listOf(
            dynamicTest("${nameOf(c)}: URL and ETag key") {
                assumeTrue(server != null, "runtime ${input["runtime"]} is not applicable to this port")
                if (expected["http"] == false) return@dynamicTest
                assertEquals(
                    expected["url"],
                    buildDictionaryUrl(config["API_URL"] as String? ?: DEFAULT_API_URL, target, input["lastRefresh"] as String?, namespace, knownEtag),
                )
                assertEquals(expected["etagCacheKey"], etagCacheKey(config["API_KEY"] as String, target, namespace))
            },
            dynamicTest("${nameOf(c)}: headers on the wire") {
                assumeTrue(server != null, "runtime ${input["runtime"]} is not applicable to this port")
                val transport = FakeTransport()
                var handlerCalls = 0
                val client = newClient(transport)
                client.init(
                    configFrom(
                        config,
                        server = server!!,
                        getAllTranslations = if (config["getAllTranslations"] == true) { { handlerCalls++; TranslationsResponse(ok = true) } } else null,
                    ),
                ).get()
                if (knownEtag != null) client.seedEtag(knownEtag, langOf(target), namespace)
                (input["knownEtagFor"] as Map<*, *>?)?.let { client.seedEtag(it["etag"] as String, langOf(it["lang"])) }
                // A miss in the namespace, then the drain of the queue fetches it.
                client.setLanguage(langOf(target)).get()
                client.translate("Bonjour", TranslationOptions(namespace = namespace))
                client.waitForIdle()
                if (expected["http"] == false) {
                    assertTrue(transport.dictionaries.isEmpty())
                    assertTrue(handlerCalls > 0)
                    return@dynamicTest
                }
                // The cursor of the switch's fetch is in the query by now: the path is the check.
                val request = transport.dictionaries.last()
                assertEquals(expected["method"], request.method)
                assertEquals((expected["url"] as String).substringBefore('?'), request.url.substringBefore('?'))
                expectHeaders(request, expected["headers"].asMap())
            },
        )
    }

    @TestFactory
    fun `dictionary-response json`() = tests("dictionary-response.json") { c ->
        val input = c["input"].asMap()
        val apiKey = input["config"].asMap()["API_KEY"] as String
        val expected = c["expected"].asMap()
        val outcomes = (c["responses"] as List<*>?)?.map { it.asMap() } ?: listOf(c["response"].asMap())
        val transport = ScriptedTransport(outcomes)
        val api = Api(transport, RecordingSleeper(), timeoutMs = 20)
        val logs = ArrayList<String>()
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.TRANSLATIONS, Json.stringify(mapOf("Existing" to "Kept")))
        val client = I18nKeylessClient(api = api)
        client.init(frEnConfig(apiKey, storage, logger = { logs.add(it) })).get()
        (input["knownEtag"] as String?)?.let { client.seedEtag(it, Lang.EN) }
        // The first request of this (API key, language): the language switch.
        client.setLanguage(Lang.EN).get()
        client.waitForIdle()
        (expected["attempts"] as Long?)?.let { assertEquals(it.toInt(), api.attempts) }
        val translations = client.translationsSnapshot
        assertEquals("Kept", translations["Existing"], "the stored dictionary is kept")
        val result = expected["result"] as Map<*, *>?
        if (result == null) {
            assertFalse("Bonjour" in translations)
        } else {
            for ((key, value) in result.asMap()["data"].asMap()["translations"].asStringMap()) assertEquals(value, translations[key])
        }
        (expected["warning"] as String?)?.let { assertTrue("i18n-keyless: $it" in logs, logs.toString()) }
        val remembered = client.dictionaryEtags[etagCacheKey(apiKey, "en")]
        assertEquals(expected["etagRemembered"], remembered)
        val next = expected["nextRequest"].asMap()
        assertEquals(next["url"], buildDictionaryUrl(DEFAULT_API_URL, "en", "1700000000", etag = remembered))
        assertEquals(next["ifNoneMatch"], remembered)
    }

    @TestFactory
    fun `usage-request json`() = tests("usage-request.json") { c ->
        val input = c["input"].asMap()
        val server = serverFor(input["runtime"] as String)
        assumeTrue(server != null, "runtime ${input["runtime"]} is not applicable to this port")
        val config = input["config"].asMap()
        val expected = c["expected"].asMap()
        val storage = MemoryStorage()
        val usage = input["usage"].asMap()
        if (usage.isNotEmpty()) storage.setItem(StorageKeys.TRANSLATIONS_USAGE, Json.stringify(usage))
        val transport = FakeTransport()
        val handlerArgs = ArrayList<Map<String, String>>()
        val client = newClient(transport)
        if ((config["API_KEY"] as String).isEmpty()) {
            // `init` refuses an empty key, so nothing can be sent.
            assertThrows(IllegalArgumentException::class.java) { client.init(configFrom(config, storage = storage)) }
            assertTrue(transport.requests.isEmpty())
            return@tests
        }
        client.init(
            configFrom(
                config,
                storage = storage,
                server = server!!,
                sendTranslationsUsage = if (config["sendTranslationsUsage"] == true) { bucket -> handlerArgs.add(bucket); UsageResponse(ok = true) } else null,
            ),
        ).get()
        client.waitForIdle()
        if (expected["http"] == false) {
            assertTrue(transport.usages.isEmpty())
            expected["handlerArgs"]?.let { assertEquals(it, handlerArgs) }
            return@tests
        }
        val request = transport.usages.single()
        assertEquals(expected["url"], request.url)
        assertEquals(expected["method"], request.method)
        expectHeaders(request, expected["headers"].asMap())
        assertEquals(expected["body"], Json.parse(request.body!!))
    }

    @TestFactory
    fun `usage-reporting json server labels`() =
        casesOf(loadVector("usage-reporting.json")["serverLabels"].asMap()).map { c ->
            dynamicTest("server label: ${c["label"]}") { assertEquals(c["expected"], isServerRuntime(c["label"] as String)) }
        }

    @Test
    fun `usage-reporting json names this port`() {
        val vector = loadVector("usage-reporting.json")
        val labels = casesOf(vector["serverLabels"].asMap()).associate { it["label"] to it["expected"] }
        assertEquals(false, labels[SDK_RUNTIME_CLIENT], "usage-reporting.json must list kotlin-client as a device")
        assertEquals(true, labels[SDK_RUNTIME_SERVER], "usage-reporting.json must list kotlin-server as a server")
        assertTrue((vector["usageFlush"].asMap().keys).any { "kotlin-client" in it })
    }

    @TestFactory
    fun `usage-reporting json`() = tests("usage-reporting.json") { c ->
        val expected = c["expected"].asMap()
        val runtime = expected["runtime"] as String
        val server = when {
            runtime.endsWith("-server") -> true
            runtime.endsWith("-client") || runtime == "browser" -> false
            else -> null
        }
        assumeTrue(server != null, "runtime $runtime is not applicable to this port")
        assertEquals(isServerRuntime(runtime), server)
        assertEquals(expected["sendsUsage"], isUsageReportingEnabled(if (server!!) SDK_RUNTIME_SERVER else SDK_RUNTIME_CLIENT))
        val storage = MemoryStorage()
        storage.setItem(StorageKeys.TRANSLATIONS_USAGE, Json.stringify(mapOf("default" to mapOf("x" to "2026-01-01"))))
        val transport = FakeTransport()
        val client = newClient(transport)
        client.init(frEnConfig("k-reporting", storage, server = server)).get()
        // The boot POST first, so the record below is not swept by its success.
        client.waitForIdle()
        client.setLanguage(Lang.EN).get()
        client.translate("Bonjour")
        client.waitForIdle()
        assertEquals(expected["sendsUsage"], transport.usages.isNotEmpty())
        val stored = storage.getItem(StorageKeys.TRANSLATIONS_USAGE)
        val recorded = stored != null && (Json.parseOrNull(stored) as? Map<*, *>)?.get("default")?.asMap()?.containsKey("Bonjour") == true
        assertEquals(expected["recordsUsage"], recorded)
        val request = transport.translates.single()
        assertEquals(expected["sendsUniqueId"], "unique_id" in request.headers)
        assertEquals(if (server) SDK_RUNTIME_SERVER else SDK_RUNTIME_CLIENT, request.headers["sdk"])
    }

    @Test
    fun `storage-keys json fixed key names`() {
        val fixed = loadVector("storage-keys.json")["fixedKeys"].asMap()
        fun key(name: String) = fixed[name].asMap()["key"]
        assertEquals(key("uniqueId"), StorageKeys.UNIQUE_ID)
        assertEquals(key("currentLanguage"), StorageKeys.CURRENT_LANGUAGE)
        assertEquals(key("lastRefresh"), StorageKeys.LAST_REFRESH)
        assertEquals(key("translations"), StorageKeys.TRANSLATIONS)
        assertEquals(key("translationsUsage"), StorageKeys.TRANSLATIONS_USAGE)
        assertEquals(key("namespaces"), StorageKeys.NAMESPACES)
        assertEquals(key("originNamespaces"), StorageKeys.ORIGIN_NAMESPACES)
        assertEquals(false, fixed["uniqueId"].asMap()["clearedByClear"])
    }

    @Test
    fun `storage-keys json hydration order`() {
        val storage = RecordingStorage()
        val client = newClient(FakeTransport())
        client.init(frEnConfig("k-order", storage)).get()
        client.waitForIdle()
        assertEquals(
            listOf(
                StorageKeys.UNIQUE_ID,
                StorageKeys.NAMESPACES,
                StorageKeys.TRANSLATIONS,
                StorageKeys.LAST_REFRESH,
                StorageKeys.ORIGIN_NAMESPACES,
                StorageKeys.TRANSLATIONS_USAGE,
                StorageKeys.CURRENT_LANGUAGE,
                StorageKeys.LAST_REFRESH,
            ),
            storage.reads,
        )
    }

    @TestFactory
    fun `storage-keys json`() = tests("storage-keys.json") { c ->
        when (c["fn"]) {
            "translationsKeyFor" -> assertEquals(c["expected"], StorageKeys.translationsKeyFor(c["input"] as String))
            "lastRefreshKeyFor" -> assertEquals(c["expected"], StorageKeys.lastRefreshKeyFor(c["input"] as String))
            "clearI18nKeylessStorage" -> {
                val index = c["input"].asMap()["namespacesIndex"].asList().map { it as String }
                val expected = c["expected"].asMap()
                val deleted = expected["deleted"].asList().map { it as String }
                val kept = expected["kept"].asList().map { it as String }
                val storage = MemoryStorage()
                storage.setItem(StorageKeys.NAMESPACES, Json.stringify(index))
                for (key in deleted + kept) {
                    if (key !in storage.entries) {
                        storage.setItem(
                            key,
                            when {
                                key == StorageKeys.UNIQUE_ID -> "deviceIdABCDEF12"
                                "translations" in key || "namespaces" in key -> "{}"
                                else -> "x"
                            },
                        )
                    }
                }
                val client = newClient(FakeTransport())
                client.init(frEnConfig("k-clear", storage)).get()
                client.waitForIdle()
                client.clearStorage()
                for (key in deleted) assertFalse(key in storage.entries, key)
                for (key in kept) assertEquals("deviceIdABCDEF12", storage.entries[key], key)
                assertNotNull(client.deviceId)
            }
            else -> fail("unknown fn ${c["fn"]}")
        }
    }
}

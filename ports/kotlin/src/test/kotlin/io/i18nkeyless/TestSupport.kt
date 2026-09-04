package io.i18nkeyless

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import java.io.File
import java.io.IOException
import java.net.SocketTimeoutException
import java.time.Clock
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** The shared vectors, read from the repository at test time (`conformance/README.md`). */
val vectorsDir: File = File("../../conformance/vectors")

@Suppress("UNCHECKED_CAST")
fun loadVector(name: String): Map<String, Any?> = Json.parse(File(vectorsDir, name).readText()) as Map<String, Any?>

@Suppress("UNCHECKED_CAST")
fun casesOf(vector: Map<String, Any?>, field: String = "cases"): List<Map<String, Any?>> =
    (vector[field] as List<Any?>).map { it as Map<String, Any?> }

fun nameOf(case: Map<String, Any?>): String = case["name"]?.toString() ?: Json.stringify(case["input"])

@Suppress("UNCHECKED_CAST")
fun Any?.asMap(): Map<String, Any?> = this as Map<String, Any?>

@Suppress("UNCHECKED_CAST")
fun Any?.asStringMap(): Map<String, String> = (this as Map<String, Any?>).mapValues { it.value as String }

@Suppress("UNCHECKED_CAST")
fun Any?.asList(): List<Any?> = this as List<Any?>

fun langOf(code: Any?): Lang = Lang.fromCode(code as String) ?: error("unknown language $code")

fun optionsOf(raw: Any?): TranslationOptions {
    val o = raw?.asMap() ?: emptyMap()
    return TranslationOptions(
        context = o["context"] as String?,
        namespace = o["namespace"] as String?,
        unpersistedNamespace = o["unpersistedNamespace"] == true,
        replace = (o["replace"] as Map<*, *>?)?.let { it.asStringMap() },
        originLanguage = o["originLanguage"]?.let { langOf(it) },
        forceTemporary = (o["forceTemporary"] as Map<*, *>?)?.entries?.associate { langOf(it.key) to it.value as String },
    )
}

val deviceIdPattern = Regex("^[0-9A-Z_a-z]{16}$")

/**
 * Exact header set: every expected header present with its value, and no other. The
 * vectors are the react package's: a device case expects `react-client`, a server case
 * `react-server`; this port is the same kind of client under its own labels.
 */
fun expectHeaders(request: HttpRequest, expected: Map<String, Any?>) {
    val actual = request.headers.mapKeys { it.key.lowercase() }
    for ((name, value) in expected) {
        val got = actual[name.lowercase()]
        when {
            value == "\$SDK_VERSION" -> assertEquals(VERSION, got, "header $name")
            value == "\$DEVICE_ID" -> assertTrue(got != null && deviceIdPattern.matches(got), "header $name: $got")
            name.lowercase() == "sdk" && value == "react-client" -> assertEquals(SDK_RUNTIME_CLIENT, got, "header sdk")
            name.lowercase() == "sdk" && value == "react-server" -> assertEquals(SDK_RUNTIME_SERVER, got, "header sdk")
            else -> assertEquals(value, got, "header $name")
        }
    }
    assertEquals(expected.keys.map { it.lowercase() }.toSet(), actual.keys, "exact header set")
}

fun envelope(data: Map<String, Any?>, headers: Map<String, String> = emptyMap()): HttpResponse =
    HttpResponse(200, "OK", headers, Json.stringify(mapOf("ok" to true, "data" to data, "error" to "", "message" to "")))

/**
 * A backend that answers every route `ok`, records requests, and can hold `POST /translate`
 * answers until [release] (for the queue scenarios and for reading state before a fetch).
 */
class FakeTransport(initial: Map<String, String> = emptyMap()) : HttpTransport {
    /** What every dictionary GET answers. Mutable so a test can add a key after boot. */
    val dictionary: MutableMap<String, String> = java.util.concurrent.ConcurrentHashMap(initial)
    val requests = CopyOnWriteArrayList<HttpRequest>()

    @Volatile
    var gate: CountDownLatch? = null
    private val inFlightTranslates = AtomicInteger()
    val peakInFlightTranslates = AtomicInteger()
    var etag: String? = null

    val translates: List<HttpRequest> get() = requests.filter { it.method == "POST" && it.url.endsWith("/translate") }
    val dictionaries: List<HttpRequest> get() = requests.filter { it.method == "GET" }
    val usages: List<HttpRequest> get() = requests.filter { it.url.endsWith("/translate/last-used-translations") }

    fun release() {
        gate?.countDown()
    }

    /** Waits until [count] translate requests are blocked on the gate. */
    fun awaitInFlight(count: Int) {
        val deadline = System.currentTimeMillis() + 5000
        while (inFlightTranslates.get() < count) {
            check(System.currentTimeMillis() < deadline) { "only ${inFlightTranslates.get()} of $count requests in flight" }
            Thread.sleep(2)
        }
    }

    override fun send(request: HttpRequest): HttpResponse {
        requests.add(request)
        if (request.method == "POST" && request.url.endsWith("/translate")) {
            val now = inFlightTranslates.incrementAndGet()
            peakInFlightTranslates.updateAndGet { maxOf(it, now) }
            try {
                gate?.await(10, TimeUnit.SECONDS)
            } finally {
                inFlightTranslates.decrementAndGet()
            }
            return envelope(mapOf("translation" to emptyMap<String, String>()))
        }
        if (request.method == "GET") {
            val known = etag
            if (known != null && request.headers["If-None-Match"] == known) {
                return HttpResponse(304, "Not Modified", mapOf("etag" to known), "")
            }
            return envelope(
                mapOf("translations" to dictionary, "uniqueId" to null, "lastRefresh" to "1"),
                if (known != null) mapOf("etag" to known) else emptyMap(),
            )
        }
        return HttpResponse(200, "OK", emptyMap(), Json.stringify(mapOf("ok" to true, "message" to "")))
    }
}

/**
 * A transport that plays scripted outcomes (`{status, statusText, headers, body,
 * invalidJson, networkError, timeout}`) in order, then repeats the last one.
 */
class ScriptedTransport(private val outcomes: List<Map<String, Any?>>) : HttpTransport {
    val requests = CopyOnWriteArrayList<HttpRequest>()

    override fun send(request: HttpRequest): HttpResponse {
        requests.add(request)
        val outcome = outcomes[minOf(requests.size - 1, outcomes.size - 1)]
        if (outcome["timeout"] == true) throw SocketTimeoutException("Read timed out")
        (outcome["networkError"] as String?)?.let { throw IOException(it) }
        val status = (outcome["status"] as Number).toInt()
        val headers = (outcome["headers"] as Map<*, *>?)?.asStringMap() ?: emptyMap()
        val body = when {
            outcome["invalidJson"] == true -> "{not json"
            outcome["body"] != null -> Json.stringify(outcome["body"])
            else -> ""
        }
        return HttpResponse(status, outcome["statusText"] as String? ?: "", headers, body)
    }
}

/** Records the sleeps instead of waiting. */
class RecordingSleeper : Sleeper {
    val sleeps = ArrayList<Long>()
    override fun sleep(ms: Long) {
        sleeps.add(ms)
    }
}

class RecordingStorage : MemoryStorage() {
    val reads = CopyOnWriteArrayList<String>()
    override fun getItem(key: String): String? {
        reads.add(key)
        return super.getItem(key)
    }
}

fun quietLogger(): (String) -> Unit = {}

fun fakeApi(transport: HttpTransport, timeoutMs: Int = Api.DEFAULT_TIMEOUT_MS, sleeper: Sleeper = RecordingSleeper()) =
    Api(transport, sleeper, timeoutMs)

fun newClient(transport: HttpTransport, clock: Clock = Clock.systemUTC()): I18nKeylessClient =
    I18nKeylessClient(api = fakeApi(transport), clock = clock)

fun configFrom(
    raw: Map<String, Any?>,
    storage: Storage? = null,
    server: Boolean = false,
    initWithDefault: Lang? = null,
    handleTranslate: ((String) -> HandleTranslateResult)? = null,
    getAllTranslations: (() -> TranslationsResponse)? = null,
    sendTranslationsUsage: ((Map<String, String>) -> UsageResponse)? = null,
    logger: ((String) -> Unit)? = null,
): I18nKeylessConfig {
    val languages = raw["languages"].asMap()
    return I18nKeylessConfig(
        apiKey = raw["API_KEY"] as String,
        apiUrl = raw["API_URL"] as String?,
        defaultNamespace = raw["defaultNamespace"] as String?,
        languages = LanguagesConfig(
            primary = langOf(languages["primary"]),
            supported = languages["supported"].asList().map { langOf(it) },
            initWithDefault = initWithDefault,
        ),
        storage = storage,
        server = server,
        handleTranslate = handleTranslate,
        getAllTranslations = getAllTranslations,
        sendTranslationsUsage = sendTranslationsUsage,
        logger = logger ?: quietLogger(),
    )
}

fun frEnConfig(
    apiKey: String,
    storage: Storage? = null,
    server: Boolean = false,
    apiUrl: String? = null,
    supported: List<Lang> = listOf(Lang.FR, Lang.EN),
    logger: ((String) -> Unit)? = null,
    debug: Boolean = false,
) = I18nKeylessConfig(
    apiKey = apiKey,
    apiUrl = apiUrl,
    languages = LanguagesConfig(primary = Lang.FR, supported = supported),
    storage = storage,
    server = server,
    debug = debug,
    logger = logger ?: quietLogger(),
)

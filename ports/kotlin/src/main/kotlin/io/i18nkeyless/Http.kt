package io.i18nkeyless

import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

/** One HTTP request as the library builds it: the exact header set, nothing more. */
class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: String?,
    /** The connect and read timeout of this one attempt. */
    val timeoutMs: Int,
)

/** One HTTP answer. [headers] keys are lower-cased. */
class HttpResponse(
    val status: Int,
    val statusText: String,
    headers: Map<String, String>,
    val body: String,
) {
    val headers: Map<String, String> = headers.mapKeys { it.key.lowercase() }
}

/**
 * The HTTP layer. The default is [HttpUrlConnectionTransport]; a test injects a fake that
 * records requests and scripts answers. A network failure is an [IOException]; a
 * [SocketTimeoutException] is reported as the literal error `timeout`.
 */
fun interface HttpTransport {
    fun send(request: HttpRequest): HttpResponse
}

/** Waits between two attempts. Injectable so tests replay the backoff without waiting. */
fun interface Sleeper {
    fun sleep(ms: Long)
}

/**
 * `java.net.HttpURLConnection`, the one HTTP client every JVM and every Android API level
 * has. The library adds no header of its own; the JDK still adds its transport headers
 * (`Host`, `User-Agent`, `Accept`), which the API ignores.
 */
class HttpUrlConnectionTransport : HttpTransport {
    override fun send(request: HttpRequest): HttpResponse {
        val connection = URL(request.url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = request.method
            connection.connectTimeout = request.timeoutMs
            connection.readTimeout = request.timeoutMs
            connection.useCaches = false
            // A redirect is a failure for the protocol (only 200 and 304 mean anything):
            // following it silently would hide a misconfigured API_URL.
            connection.instanceFollowRedirects = false
            for ((name, value) in request.headers) connection.setRequestProperty(name, value)
            val body = request.body
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            val headers = LinkedHashMap<String, String>()
            for ((name, values) in connection.headerFields) {
                if (name != null) headers[name] = values.joinToString(", ")
            }
            return HttpResponse(status, connection.responseMessage ?: "", headers, text)
        } finally {
            connection.disconnect()
        }
    }
}

/** One HTTP answer, already reduced to what the client needs. Never throws. */
class ApiResult(
    /** `ok` of the JSON body on a `200`, `true` on a `304`, `false` otherwise. */
    val ok: Boolean,
    val status: Int? = null,
    val json: Map<String, Any?>? = null,
    /** The `ETag` header of a `200`. */
    val etag: String? = null,
    val error: String = "",
    /** The API answered `304 Not Modified`: the caller's copy is current. */
    val notModified: Boolean = false,
) {
    val message: String get() = json?.get("message")?.toString() ?: ""
}

/**
 * One shared request path for every API call, with the resilience a bare request lacks:
 *
 * - a timeout of 10 s per attempt (an app must never hang on a slow translation API),
 * - 3 attempts with a 500 ms then 1500 ms wait on network errors, timeouts, 429 and 5xx,
 * - no retry on other 4xx (a wrong key stays wrong; retrying only burns quota).
 *
 * Errors never throw out of here: the caller always receives an [ApiResult] and falls
 * back to its stored translations.
 */
class Api(
    private val transport: HttpTransport = HttpUrlConnectionTransport(),
    private val sleeper: Sleeper = Sleeper { Thread.sleep(it) },
    val timeoutMs: Int = DEFAULT_TIMEOUT_MS,
    val retryDelaysMs: List<Long> = DEFAULT_RETRY_DELAYS_MS,
) {
    companion object {
        const val DEFAULT_TIMEOUT_MS = 10_000
        val DEFAULT_RETRY_DELAYS_MS: List<Long> = listOf(500L, 1500L)
        val MAX_ATTEMPTS: Int get() = DEFAULT_RETRY_DELAYS_MS.size + 1
    }

    private val attemptCount = AtomicInteger()

    /** Total attempts made through this instance, for tests. */
    val attempts: Int get() = attemptCount.get()

    fun get(url: String, headers: Map<String, String>): ApiResult = requestWithRetry("GET", url, headers, null)

    fun post(url: String, headers: Map<String, String>, body: Map<String, Any?>): ApiResult =
        requestWithRetry("POST", url, headers, Json.stringify(body))

    private fun requestWithRetry(method: String, url: String, headers: Map<String, String>, body: String?): ApiResult {
        var lastError = ""
        var lastStatus = 0
        for (attempt in 0..retryDelaysMs.size) {
            attemptCount.incrementAndGet()
            try {
                val response = transport.send(HttpRequest(method, url, headers, body, timeoutMs))
                lastStatus = response.status
                // 304: the caller's copy is current. No body to parse, nothing to merge.
                if (response.status == 304) return ApiResult(ok = true, status = 304, notModified = true)
                if (response.status == 200) {
                    val decoded = Json.parseOrNull(response.body)
                    if (decoded is Map<*, *>) {
                        @Suppress("UNCHECKED_CAST")
                        val json = decoded as Map<String, Any?>
                        return ApiResult(
                            ok = json["ok"] == true,
                            status = 200,
                            json = json,
                            etag = response.headers["etag"],
                            error = json["error"]?.toString() ?: "",
                        )
                    }
                    // A 200 whose body is not JSON is a failed attempt: retried like a 5xx.
                    lastError = "invalid JSON"
                } else {
                    lastError = httpErrorMessage(response.status, response.statusText)
                    // 4xx (except 429) is not transient: answer now, do not hammer the API.
                    if (!isRetryableStatus(response.status)) {
                        return ApiResult(ok = false, status = response.status, error = lastError)
                    }
                }
            } catch (_: SocketTimeoutException) {
                lastError = "timeout"
            } catch (error: IOException) {
                lastError = error.message ?: error.javaClass.simpleName
            } catch (error: RuntimeException) {
                lastError = error.message ?: error.toString()
            }
            if (attempt < retryDelaysMs.size) sleeper.sleep(retryDelaysMs[attempt])
        }
        return ApiResult(ok = false, status = if (lastStatus == 0) null else lastStatus, error = lastError)
    }
}

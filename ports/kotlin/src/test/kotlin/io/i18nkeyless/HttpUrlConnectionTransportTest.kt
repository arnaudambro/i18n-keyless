package io.i18nkeyless

import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList

/** The default transport against a real socket: headers, body, 304, 4xx bodies, timeout. */
class HttpUrlConnectionTransportTest {
    companion object {
        private lateinit var server: HttpServer
        private val received = CopyOnWriteArrayList<Map<String, String>>()
        private val bodies = CopyOnWriteArrayList<String>()
        private val base: String get() = "http://127.0.0.1:${server.address.port}"

        @JvmStatic
        @BeforeAll
        fun start() {
            server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
            server.createContext("/") { exchange ->
                received.add(exchange.requestHeaders.entries.associate { it.key.lowercase() to it.value.joinToString(", ") })
                bodies.add(exchange.requestBody.readBytes().toString(Charsets.UTF_8))
                val path = exchange.requestURI.path
                when {
                    path == "/slow" -> {
                        Thread.sleep(600)
                        exchange.sendResponseHeaders(200, -1)
                    }
                    path == "/redirect" -> {
                        exchange.responseHeaders.add("Location", "$base/")
                        exchange.sendResponseHeaders(301, -1)
                    }
                    path == "/unauthorized" -> {
                        val body = """{"ok":false,"code":"SERVER_ERROR"}""".toByteArray()
                        exchange.sendResponseHeaders(401, body.size.toLong())
                        exchange.responseBody.use { it.write(body) }
                    }
                    exchange.requestHeaders.getFirst("If-None-Match") == "W/\"v1\"" -> {
                        exchange.responseHeaders.add("ETag", "W/\"v1\"")
                        exchange.sendResponseHeaders(304, -1)
                    }
                    else -> {
                        exchange.responseHeaders.add("ETag", "W/\"v1\"")
                        exchange.responseHeaders.add("Content-Type", "application/json")
                        val body = """{"ok":true,"data":{"translations":{"Bonjour":"Hello"}},"error":"","message":""}""".toByteArray()
                        exchange.sendResponseHeaders(200, body.size.toLong())
                        exchange.responseBody.use { it.write(body) }
                    }
                }
                exchange.close()
            }
            server.start()
        }

        @JvmStatic
        @AfterAll
        fun stop() = server.stop(0)
    }

    private val headers = mapOf(
        "Content-Type" to "application/json",
        "Authorization" to "Bearer k-real",
        "Version" to VERSION,
        "sdk" to SDK_RUNTIME_CLIENT,
        "unique_id" to "deviceIdABCDEF12",
    )

    @Test
    fun `sends the headers and the body, reads the answer and the ETag`() {
        val api = Api(HttpUrlConnectionTransport(), RecordingSleeper(), timeoutMs = 2000)
        val result = api.post("$base/translate", headers, mapOf("key" to "Bonjour", "languages" to listOf("fr", "en")))
        assertTrue(result.ok)
        assertEquals("W/\"v1\"", result.etag)
        assertEquals(mapOf("Bonjour" to "Hello"), (result.json!!["data"] as Map<*, *>)["translations"])
        val sent = received.last()
        for ((name, value) in headers) assertEquals(value, sent[name.lowercase()], name)
        assertEquals(mapOf("key" to "Bonjour", "languages" to listOf("fr", "en")), Json.parse(bodies.last()))
    }

    @Test
    fun `a matching If-None-Match answers 304 without a body`() {
        val api = Api(HttpUrlConnectionTransport(), RecordingSleeper(), timeoutMs = 2000)
        val result = api.get("$base/translate/en", headers + ("If-None-Match" to "W/\"v1\""))
        assertTrue(result.ok)
        assertTrue(result.notModified)
        assertEquals(1, api.attempts)
    }

    @Test
    fun `a 4xx answers at once with the status text and is not retried`() {
        val sleeper = RecordingSleeper()
        val api = Api(HttpUrlConnectionTransport(), sleeper, timeoutMs = 2000)
        val result = api.get("$base/unauthorized", headers)
        assertFalse(result.ok)
        assertEquals(401, result.status)
        assertEquals("Unauthorized", result.error)
        assertEquals(1, api.attempts)
        assertTrue(sleeper.sleeps.isEmpty())
    }

    @Test
    fun `a redirect is a failure, not followed`() {
        val api = Api(HttpUrlConnectionTransport(), RecordingSleeper(), timeoutMs = 2000)
        val result = api.get("$base/redirect", headers)
        assertFalse(result.ok)
        assertEquals(301, result.status)
    }

    @Test
    fun `a slow answer is a timeout, retried three times`() {
        val sleeper = RecordingSleeper()
        val api = Api(HttpUrlConnectionTransport(), sleeper, timeoutMs = 100)
        val result = api.get("$base/slow", headers)
        assertFalse(result.ok)
        assertEquals("timeout", result.error)
        assertEquals(3, api.attempts)
        assertEquals(listOf(500L, 1500L), sleeper.sleeps)
    }

    @Test
    fun `a closed port is a network error, retried three times`() {
        val sleeper = RecordingSleeper()
        val api = Api(HttpUrlConnectionTransport(), sleeper, timeoutMs = 500)
        val result = api.get("http://127.0.0.1:1/translate/en", headers)
        assertFalse(result.ok)
        assertEquals(3, api.attempts)
        assertTrue(result.error.isNotEmpty())
    }
}

package example

import com.sun.net.httpserver.HttpServer
import io.i18nkeyless.Lang
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.URL
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The site against an in-process copy of the mock backend (`examples/_mock-server`): the
 * same fixtures, so the test needs no Node and no network.
 */
class AppTest {
    companion object {
        private val fixtures = mapOf(
            "en" to mapOf(
                "Accueil" to "Home",
                "À propos" to "About",
                "À propos de cette démo" to "About this demo",
                "Changer de langue" to "Switch language",
                "Langue : {{current_lang}}" to "Language: {{current_lang}}",
                "8 heures__heure" to "8 AM",
                "8 heures__durée" to "8 hours",
            ),
            "es" to mapOf(
                "Accueil" to "Inicio",
                "À propos de cette démo" to "Acerca de esta demo",
                "Changer de langue" to "Cambiar de idioma",
                "8 heures__heure" to "las 8 de la mañana",
            ),
        )
        private lateinit var backend: HttpServer
        private lateinit var app: HttpServer
        private lateinit var site: Site
        private val backendRequests = CopyOnWriteArrayList<String>()

        private fun json(entries: Map<String, String>) =
            entries.entries.joinToString(",", "{", "}") { "\"${it.key.replace("\"", "\\\"")}\":\"${it.value.replace("\"", "\\\"")}\"" }

        @JvmStatic
        @BeforeAll
        fun start() {
            backend = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
            backend.createContext("/") { exchange ->
                val path = exchange.requestURI.path
                val requestBody = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
                backendRequests.add("${exchange.requestMethod} $path sdk=${exchange.requestHeaders.getFirst("sdk")} uid=${exchange.requestHeaders.getFirst("unique_id")} body=$requestBody")
                val body = when {
                    exchange.requestMethod == "GET" && path.startsWith("/translate/") -> {
                        val lang = path.removePrefix("/translate/")
                        """{"ok":true,"data":{"translations":${json(fixtures[lang] ?: emptyMap())},"uniqueId":null,"lastRefresh":"1"},"error":"","message":""}"""
                    }
                    else -> """{"ok":true,"data":{"translation":{}},"error":"","message":""}"""
                }.toByteArray()
                exchange.responseHeaders.add("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, body.size.toLong())
                exchange.responseBody.use { it.write(body) }
            }
            backend.start()
            site = Site("demo", "http://127.0.0.1:${backend.address.port}", Files.createTempDirectory("i18n-keyless-example").toFile())
            site.waitForIdle()
            app = site.start(0)
        }

        @JvmStatic
        @AfterAll
        fun stop() {
            app.stop(0)
            backend.stop(0)
        }

        private fun get(path: String): String {
            val connection = URL("http://127.0.0.1:${app.address.port}$path").openConnection() as HttpURLConnection
            return connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        }
    }

    @Test
    fun `the home page renders in English with context and replace`() {
        val html = get("/?lang=en")
        assertTrue("<html lang=\"en\">" in html)
        assertTrue("<h1>Home</h1>" in html, html)
        assertTrue("8 AM / 8 hours" in html, html)
        assertTrue("Language: en" in html, html)
        assertTrue("Switch language" in html, html)
    }

    @Test
    fun `the about page renders in Spanish`() {
        val html = get("/about?lang=es")
        assertTrue("<h1>Acerca de esta demo</h1>" in html, html)
        assertTrue("Cambiar de idioma" in html, html)
    }

    @Test
    fun `the primary language and an unknown tag render the source text`() {
        assertTrue("<h1>Accueil</h1>" in get("/?lang=fr"))
        assertTrue("<h1>Accueil</h1>" in get("/?lang=xx"))
        assertTrue("<h1>Home</h1>" in get("/?lang=en-US"), "a BCP-47 tag resolves to a shipped language")
    }

    @Test
    fun `a string the mock does not know is requested once and rendered as its source`() {
        val html = get("/about?lang=en")
        assertTrue("Ce texte est rendu avec la fonction getTranslation()" in html, html)
        site.waitForIdle()
        val posts = backendRequests.filter { it.startsWith("POST /translate ") }
        assertTrue(posts.isNotEmpty(), backendRequests.toString())
        // The two non-primary clients (en, es) each request a missing string once; the
        // French client never does (the source text is the translation).
        val perKey = posts.groupBy { it.substringAfter("body=") }.values.map { it.size }
        assertTrue(perKey.all { it <= 2 }, "one request per missing string per language: $posts")
    }

    @Test
    fun `every client is a server, kotlin-server and no device id`() {
        for (line in backendRequests) {
            assertTrue("sdk=kotlin-server" in line, line)
            assertTrue("uid=null" in line, line)
        }
        assertFalse(backendRequests.any { "/last-used-translations" in it }, "a server sends no usage analytics")
    }

    @Test
    fun `render is per language, from the client of that language`() {
        assertTrue("<h1>Inicio</h1>" in site.render("/", Lang.ES))
        assertTrue("<h1>Home</h1>" in site.render("/", Lang.EN))
        assertTrue("<h1>Accueil</h1>" in site.render("/", Lang.FR))
        assertEquals(3, site.clients.size)
    }
}

// A two-page web app showing i18n-keyless-kotlin on a server: one client per language,
// `t()` in a handler, `context`, `replace` and a `?lang=` switcher. Primary language is
// French.
//
// It runs offline against the mock backend of the repository:
//
//     node ../_mock-server/server.mjs      # http://localhost:8787
//     ./gradlew run                        # http://localhost:8080
//
// To use the real service, set I18N_KEYLESS_API_URL=https://api.i18n-keyless.com and
// I18N_KEYLESS_API_KEY to yours.
package example

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import io.i18nkeyless.FileStorage
import io.i18nkeyless.I18nKeylessClient
import io.i18nkeyless.I18nKeylessConfig
import io.i18nkeyless.Lang
import io.i18nkeyless.LanguagesConfig
import io.i18nkeyless.resolveLang
import java.io.File
import java.net.InetSocketAddress

val supportedLanguages = listOf(Lang.FR, Lang.EN, Lang.ES)

/**
 * A server answers users in several languages, and a client holds one current language,
 * like a device. So: one client per language, each in server mode (no device id, no usage
 * analytics), each switched once. They share nothing but the API key.
 */
class Site(apiKey: String, apiUrl: String, storageDir: File) {
    val clients: Map<Lang, I18nKeylessClient> = supportedLanguages.associateWith { lang ->
        I18nKeylessClient().also { client ->
            client.initBlocking(
                I18nKeylessConfig(
                    apiKey = apiKey,
                    apiUrl = apiUrl,
                    languages = LanguagesConfig(primary = Lang.FR, supported = supportedLanguages),
                    storage = FileStorage(storageDir.resolve(lang.code)),
                    server = true,
                ),
            )
            client.setLanguage(lang)
        }
    }

    /** Blocks until every client has its dictionary: for a warm start, and for the test. */
    fun waitForIdle() = clients.values.forEach { it.waitForIdle() }

    fun render(page: String, lang: Lang): String {
        val i18n = clients.getValue(lang)
        val nav = supportedLanguages.joinToString(" · ") { "<a href=\"?lang=${it.code}\">${it.code}</a>" }
        val body = when (page) {
            "/about" -> """
                <h1>${i18n.t("À propos de cette démo")}</h1>
                <p>${i18n.t("Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>.")}</p>
                <p>${i18n.t("Cette page utilise des chaînes différentes de la page d'accueil — en SSR, chaque page ne sérialise que ses propres clés.")}</p>
            """
            else -> """
                <h1>${i18n.t("Accueil")}</h1>
                <p>${i18n.t("Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.")}</p>
                <p>${i18n.t("8 heures", context = "heure")} / ${i18n.t("8 heures", context = "durée")}</p>
            """
        }
        return """<!doctype html>
<html lang="${lang.code}"><head><meta charset="utf-8"><title>i18n-keyless · Kotlin</title></head>
<body>
<nav>
  <a href="/?lang=${lang.code}">${i18n.t("Accueil")}</a> · <a href="/about?lang=${lang.code}">${i18n.t("À propos")}</a>
  <p>${i18n.t("Langue : {{current_lang}}", replace = mapOf("{{current_lang}}" to lang.code))} — ${i18n.t("Changer de langue")} : $nav</p>
</nav>
$body
</body></html>
"""
    }

    fun start(port: Int): HttpServer {
        val server = HttpServer.create(InetSocketAddress(port), 0)
        server.createContext("/") { exchange -> handle(exchange) }
        server.start()
        return server
    }

    private fun handle(exchange: HttpExchange) {
        val query = exchange.requestURI.rawQuery ?: ""
        val requested = query.split('&').firstOrNull { it.startsWith("lang=") }?.substringAfter('=')
        // `resolveLang` accepts any BCP-47 tag: ?lang=en-US or ?lang=pt_BR resolve to a shipped language.
        val lang = resolveLang(requested, supported = supportedLanguages, fallback = Lang.FR)!!
        val html = render(exchange.requestURI.path, lang).toByteArray(Charsets.UTF_8)
        exchange.responseHeaders.add("Content-Type", "text/html; charset=utf-8")
        exchange.sendResponseHeaders(200, html.size.toLong())
        exchange.responseBody.use { it.write(html) }
    }
}

fun main() {
    val site = Site(
        apiKey = System.getenv("I18N_KEYLESS_API_KEY") ?: "demo",
        apiUrl = System.getenv("I18N_KEYLESS_API_URL") ?: "http://localhost:8787",
        storageDir = File(".i18n-keyless"),
    )
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    site.start(port)
    println("i18n-keyless Kotlin example on http://localhost:$port (?lang=fr|en|es)")
    Thread.currentThread().join()
}

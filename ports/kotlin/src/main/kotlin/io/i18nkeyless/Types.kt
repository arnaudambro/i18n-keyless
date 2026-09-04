package io.i18nkeyless

/** What a custom `handleTranslate` handler returns. */
class HandleTranslateResult(
    val ok: Boolean,
    val message: String = "",
    /** The translation of the key per language code, when the handler has it. */
    val translation: Map<String, String> = emptyMap(),
)

/** The answer of `POST /translate/last-used-translations`. */
class UsageResponse(val ok: Boolean, val message: String = "")

/**
 * The answer of `GET /translate/:lang`: `{ ok, data: { translations, uniqueId, lastRefresh },
 * error, message }`, plus the `ETag` header when the API sent one.
 */
class TranslationsResponse(
    val ok: Boolean,
    val translations: Map<String, String> = emptyMap(),
    val uniqueId: String? = null,
    val lastRefresh: String? = null,
    val error: String = "",
    val message: String = "",
    /** ETag of this payload, replayed as `If-None-Match` on the next fetch. */
    val etag: String? = null,
    /** True when the API answered `304 Not Modified`. */
    val notModified: Boolean = false,
) {
    companion object {
        /** The `304 Not Modified` answer: nothing changed, keep the stored dictionary. */
        val NOT_MODIFIED = TranslationsResponse(ok = true, notModified = true)

        /** Parses the JSON body of a `200`. */
        fun fromJson(json: Map<String, Any?>, etag: String? = null): TranslationsResponse {
            val data = json["data"] as? Map<*, *>
            val translations = LinkedHashMap<String, String>()
            (data?.get("translations") as? Map<*, *>)?.forEach { (key, value) ->
                if (value is String) translations[key.toString()] = value
            }
            return TranslationsResponse(
                ok = json["ok"] == true,
                translations = translations,
                uniqueId = data?.get("uniqueId")?.toString(),
                lastRefresh = data?.get("lastRefresh")?.toString(),
                error = json["error"]?.toString() ?: "",
                message = json["message"]?.toString() ?: "",
                etag = etag,
            )
        }
    }
}

/** The languages of the project. */
class LanguagesConfig(
    /** The language the source strings are written in. */
    val primary: Lang,
    /** The languages the user can switch to. [primary] and [initWithDefault] are added when missing. */
    val supported: List<Lang>,
    /** Used when [I18nKeylessClient.setLanguage] receives an unsupported language. Defaults to [primary]. */
    val fallback: Lang? = null,
    /** The language of the first launch, before any stored choice. Defaults to [primary]. */
    val initWithDefault: Lang? = null,
    /**
     * When true, the stored language is ignored at boot and [initWithDefault] is used. Useful
     * when the language comes from somewhere else (a deep link, an account).
     */
    val skipCurrentLanguageHydration: Boolean = false,
)

/** The options of one translation call. Every field is also a named parameter of `t()` and `text()`. */
class TranslationOptions(
    /** Disambiguates meaning: "8 heures" as a clock time vs a duration. Stored as `"key__context"`. */
    val context: String? = null,
    /** A fetch/storage partition, not a semantic key. Defaults to the config `defaultNamespace`, then `default`. */
    val namespace: String? = null,
    /** When true, this namespace lives in memory only: never persisted, never reloaded, never reported. */
    val unpersistedNamespace: Boolean = false,
    /** Placeholders to replace in the translated text. The keys include the delimiters: `mapOf("{name}" to user.name)`. */
    val replace: Map<String, String>? = null,
    /** Your own translation per language, when the AI one is not satisfactory. */
    val forceTemporary: Map<Lang, String>? = null,
    /** For user generated content: the language this text is written in when it is not the primary one. */
    val originLanguage: Lang? = null,
    /** Logs the resolution of this one string. */
    val debug: Boolean = false,
) {
    companion object {
        val NONE = TranslationOptions()
    }
}

/** Everything [I18nKeylessClient.init] needs. */
class I18nKeylessConfig(
    /**
     * The API key from https://i18n-keyless.com. Always required, even with custom handlers
     * or a self-hosted [apiUrl] (protocol section 2.1).
     */
    val apiKey: String,
    val languages: LanguagesConfig,
    /** A self-hosted backend. Defaults to `https://api.i18n-keyless.com`. */
    val apiUrl: String? = null,
    /** The namespace applied to every call that has none. Defaults to `default`. */
    val defaultNamespace: String? = null,
    /** Where the cache lives. Defaults to [MemoryStorage]; use [FileStorage] or a `SharedPreferences` adapter on a device. */
    val storage: Storage? = null,
    /**
     * `true` on a server (Ktor, Spring, a build step): the `sdk` header becomes
     * `kotlin-server`, no device id is generated or sent, and usage analytics are neither
     * recorded nor sent (the `ssr: true` of the JavaScript SDKs). Translate-on-miss still works.
     */
    val server: Boolean = false,
    /** Logs every step. */
    val debug: Boolean = false,
    /** Custom handlers. When set, they replace the HTTP calls. They run on a worker thread. */
    val handleTranslate: ((key: String) -> HandleTranslateResult)? = null,
    val getAllTranslations: (() -> TranslationsResponse)? = null,
    /** Receives the default-namespace usage bucket, like the JavaScript SDKs hand their handler. */
    val sendTranslationsUsage: ((usage: Map<String, String>) -> UsageResponse)? = null,
    /** Called once hydration is done, with the language the app starts in. */
    val onInit: ((Lang) -> Unit)? = null,
    /** Called on every [I18nKeylessClient.setLanguage]. */
    val onSetLanguage: ((Lang) -> Unit)? = null,
    /** Where logs go. Defaults to `println`. */
    val logger: ((String) -> Unit)? = null,
) {
    /** The `sdk` header this configuration reports. */
    val runtime: String get() = if (server) SDK_RUNTIME_SERVER else SDK_RUNTIME_CLIENT
}

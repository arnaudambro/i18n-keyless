package io.i18nkeyless

// The pure rules of the protocol (docs/PROTOCOL.md), as top-level functions so the
// conformance suite can call each one on its own.

/**
 * The storage key of a translation: `"key__context"` when a context is given, the key
 * itself otherwise (an empty context counts as none, like the JavaScript SDKs).
 */
fun storageKeyFor(key: String, context: String?): String =
    if (!context.isNullOrEmpty()) "${key}__$context" else key

/**
 * Replaces every placeholder of [replace] in [text] in one left-to-right pass. Placeholders
 * are literal (regex-special characters are escaped), so `{name}`, `$price` or `(x)` all
 * work. At a given position the first placeholder in map order wins. An empty replacement
 * keeps the placeholder, and replacements are inserted verbatim, never re-scanned.
 */
fun applyReplace(text: String, replace: Map<String, String>?): String {
    if (replace.isNullOrEmpty()) return text
    val pattern = replace.keys.joinToString("|") { Regex.escape(it) }
    return Regex(pattern).replace(text) { match ->
        val replacement = replace[match.value]
        if (replacement.isNullOrEmpty()) match.value else replacement
    }
}

/**
 * The effective namespace of a call: the per-call [namespace], else the config
 * `defaultNamespace`, else the literal `default`. Empty strings fall through.
 */
fun resolveNamespace(namespace: String?, configDefault: String?): String = when {
    !namespace.isNullOrEmpty() -> namespace
    !configDefault.isNullOrEmpty() -> configDefault
    else -> DEFAULT_NAMESPACE
}

/**
 * The origin language of a UGC key: the per-call [origin] when it exists and differs from
 * [primary], `null` otherwise (the regular flow).
 */
fun resolveOriginLanguage(origin: Lang?, primary: Lang): Lang? =
    if (origin == null || origin == primary) null else origin

/**
 * The id of a translate task in the queue: `namespace:key`. The context and the origin
 * language are not part of it (protocol section 15, item 1).
 */
fun queueIdFor(namespace: String, key: String): String = "$namespace:$key"

/** The in-memory ETag map key of one dictionary: `apiKey|lang|namespace`. */
fun etagCacheKey(apiKey: String, lang: String, namespace: String? = null): String =
    "$apiKey|$lang|${if (namespace.isNullOrEmpty()) DEFAULT_NAMESPACE else namespace}"

/**
 * `encodeURIComponent` of JavaScript: every byte percent-encoded except the unreserved
 * `A-Z a-z 0-9 - _ . ! ~ * ' ( )`. `URLEncoder` would write a space as `+`, which the
 * reference URL does not.
 */
fun encodeUriComponent(value: String): String {
    val out = StringBuilder()
    for (byte in value.toByteArray(Charsets.UTF_8)) {
        val char = byte.toInt() and 0xFF
        val keep = char in 0x30..0x39 || char in 0x41..0x5A || char in 0x61..0x7A ||
            char == '-'.code || char == '_'.code || char == '.'.code || char == '!'.code ||
            char == '~'.code || char == '*'.code || char == '\''.code || char == '('.code || char == ')'.code
        if (keep) out.append(char.toChar()) else out.append('%').append(char.toString(16).uppercase().padStart(2, '0'))
    }
    return out.toString()
}

/**
 * The URL of `GET /translate/:lang` (protocol section 4.2). Without an ETag the delta cursor
 * travels as `last_refresh=` (a null cursor is written literally as `null`, an empty one as
 * empty); with an ETag the cursor leaves the URL. The default namespace never appears;
 * another namespace is URL-encoded.
 */
fun buildDictionaryUrl(
    apiUrl: String,
    lang: String,
    lastRefresh: String? = null,
    namespace: String? = null,
    etag: String? = null,
): String {
    val namespaceQuery =
        if (!namespace.isNullOrEmpty() && namespace != DEFAULT_NAMESPACE) "&namespace=${encodeUriComponent(namespace)}" else ""
    val query = if (etag != null) {
        if (namespaceQuery.isEmpty()) "" else "?${namespaceQuery.substring(1)}"
    } else {
        "?last_refresh=${lastRefresh ?: "null"}$namespaceQuery"
    }
    return "$apiUrl/translate/$lang$query"
}

/**
 * Whether a runtime label is a server for the API: `node`, `laravel`, `rails`, `python`,
 * `go` and every label ending in `-server`. A server sends no `unique_id` and is counted
 * by its connection. Everything else, an absent header included, is a device.
 */
fun isServerRuntime(runtime: String): Boolean =
    runtime == "node" || runtime == "laravel" || runtime == "rails" || runtime == "python" ||
        runtime == "go" || runtime.endsWith("-server")

/**
 * Whether usage analytics are active for a runtime: a server render may be a crawler hit
 * and a serverless init would POST per request, so `*-server` is read-only. Unlike the node
 * SDK, this port has no debounced server usage: its server mode is the react `ssr: true`.
 */
fun isUsageReportingEnabled(runtime: String): Boolean = !runtime.endsWith("-server")

/** A status that a failed attempt retries: 429 and every 5xx. Other 4xx stay wrong. */
fun isRetryableStatus(status: Int): Boolean = status == 429 || status >= 500

/** The error string of a failed HTTP answer: the status text, else `HTTP <code>`. */
fun httpErrorMessage(status: Int, statusText: String?): String =
    if (!statusText.isNullOrEmpty()) statusText else "HTTP $status"

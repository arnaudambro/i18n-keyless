package io.i18nkeyless

/*
 * The precompiled bundle (docs/PROTOCOL.md, sections 4.5 and 7.4): dictionaries exported at
 * build time (`GET /translate/bundle`, or the MCP `export_bundle` tool) and shipped with the
 * app, one file per (namespace, language) plus `manifest.json`. At boot and on a language
 * switch a covered dictionary is seeded from the file instead of fetched, with the bundle's
 * cursor, so the only network traffic left is a miss.
 *
 * The pure functions (`bundleCovers`, `mergeBundleWithStorage`) are replayed by
 * `conformance/vectors/bundle-seed.json`.
 */

/** One namespace of the manifest: its cursor and the languages that have a file. */
class BundleNamespace(
    /** The export time, epoch ms as a string: the delta cursor seeded with the file. */
    val lastRefresh: String,
    /** The language codes that have a `<namespace>/<lang>.json` file. */
    val languages: List<String>,
) {
    companion object {
        fun fromJson(json: Map<*, *>): BundleNamespace = BundleNamespace(
            lastRefresh = json["lastRefresh"]?.toString() ?: "",
            languages = (json["languages"] as? List<*>)?.map { it.toString() } ?: emptyList(),
        )
    }
}

/**
 * `manifest.json`: the bundle without its dictionaries.
 *
 * ```json
 * { "primaryLanguage": "fr", "languages": ["en", "fr"], "exportedAt": "1757000000000",
 *   "namespaces": { "default": { "lastRefresh": "1757000000000", "languages": ["en", "fr"] } } }
 * ```
 */
class BundleManifest(
    val primaryLanguage: String,
    val languages: List<String>,
    val exportedAt: String,
    /** Per namespace, in manifest order. */
    val namespaces: Map<String, BundleNamespace>,
) {
    companion object {
        /** Parses the object of `manifest.json`. Values that do not fit are dropped. */
        fun fromJson(json: Map<*, *>): BundleManifest {
            val namespaces = LinkedHashMap<String, BundleNamespace>()
            (json["namespaces"] as? Map<*, *>)?.forEach { (name, value) ->
                if (value is Map<*, *>) namespaces[name.toString()] = BundleNamespace.fromJson(value)
            }
            return BundleManifest(
                primaryLanguage = json["primaryLanguage"]?.toString() ?: "",
                languages = (json["languages"] as? List<*>)?.map { it.toString() } ?: emptyList(),
                exportedAt = json["exportedAt"]?.toString() ?: "",
                namespaces = namespaces,
            )
        }

        /** Parses the text of `manifest.json`. Throws [JsonException] when it is not a JSON object. */
        fun parse(text: String): BundleManifest {
            val json = Json.parse(text) as? Map<*, *> ?: throw JsonException("manifest.json is not a JSON object")
            return fromJson(json)
        }
    }
}

/**
 * The bundle handed to [I18nKeylessConfig.bundle]: the parsed manifest and a loader.
 *
 * The files are app assets, so the SDK takes a loader, not a path. [load] reads the
 * dictionary of `<namespace>/<lang>.json`, or returns `null` when the app has no such file;
 * it is called only for a pair the manifest covers, on a worker thread, never on the caller's.
 * A thrown error is logged and the pair is fetched instead.
 *
 * [from] builds one over any `path -> text` reader, on Android the assets:
 *
 * ```kotlin
 * val bundle = I18nKeylessBundle.from { path ->
 *     context.assets.open("i18n-keyless/$path").bufferedReader().readText()
 * }
 * I18nKeylessConfig(..., bundle = bundle)
 * ```
 */
class I18nKeylessBundle(
    val manifest: BundleManifest,
    val load: (namespace: String, lang: Lang) -> Map<String, String>?,
) {
    companion object {
        /**
         * A bundle over the files a reader answers: `manifest.json` (read now) and one
         * `<namespace>/<lang>.json` per dictionary (read when seeded). [read] returns the text
         * of the file at that relative path, or `null` when there is none. Throws when the
         * manifest is missing or malformed.
         */
        fun from(read: (path: String) -> String?): I18nKeylessBundle {
            val manifest = BundleManifest.parse(read("manifest.json") ?: throw JsonException("manifest.json not found"))
            return I18nKeylessBundle(manifest) { namespace, lang ->
                val text = read("$namespace/${lang.code}.json") ?: return@I18nKeylessBundle null
                val raw = Json.parse(text) as? Map<*, *> ?: throw JsonException("$namespace/${lang.code}.json is not a JSON object")
                val dictionary = LinkedHashMap<String, String>()
                for ((key, value) in raw) if (value is String) dictionary[key.toString()] = value
                dictionary
            }
        }
    }
}

/** The seed of one namespace: a dictionary and the cursor that goes with it. */
class BundleSeed(val translations: Map<String, String>, val lastRefresh: String?)

/** What storage holds for one namespace: its slice, its cursor, and the language it is in. */
class StoredSeed(val translations: Map<String, String>, val lastRefresh: String?, val lang: String)

/** True when the manifest lists [lang] under [namespace]. */
fun bundleCovers(manifest: BundleManifest?, namespace: String, lang: String): Boolean =
    manifest?.namespaces?.get(namespace)?.languages?.contains(lang) == true

/** The namespaces the manifest lists, in manifest order. */
fun bundleNamespaces(manifest: BundleManifest?): List<String> = manifest?.namespaces?.keys?.toList() ?: emptyList()

/**
 * The precedence between the bundle and what storage holds for the same namespace.
 *
 * The bundle is the base. Storage wins only when it is strictly newer (its cursor is a
 * larger number than the bundle's) AND it is in the language being seeded: a device that
 * fetched after a human review keeps the reviewed text, and a slice left by another language
 * is never mixed in. A storage cursor that is empty or not a number is never newer.
 */
fun mergeBundleWithStorage(bundle: BundleSeed, stored: StoredSeed?, lang: String): BundleSeed {
    if (stored == null || stored.lang != lang) return bundle
    val storedRaw = stored.lastRefresh
    if (storedRaw.isNullOrEmpty()) return bundle
    val storedCursor = storedRaw.toDoubleOrNull()?.takeIf { it.isFinite() } ?: return bundle
    val bundleCursor = bundle.lastRefresh?.toDoubleOrNull() ?: return bundle
    if (!(storedCursor > bundleCursor)) return bundle
    val merged = LinkedHashMap(bundle.translations)
    merged.putAll(stored.translations)
    return BundleSeed(merged, storedRaw)
}

/**
 * Loads one covered dictionary from the bundle. `null` when the manifest does not cover the
 * pair, when the loader yields nothing, or when it throws (a missing file at runtime is a
 * miss like any other: the caller falls back to the fetch).
 */
internal fun loadBundleSeed(bundle: I18nKeylessBundle?, namespace: String, lang: Lang, log: (String) -> Unit): BundleSeed? {
    if (bundle == null || !bundleCovers(bundle.manifest, namespace, lang.code)) return null
    return try {
        val translations = bundle.load(namespace, lang) ?: return null
        BundleSeed(translations, bundle.manifest.namespaces[namespace]?.lastRefresh)
    } catch (error: Throwable) {
        log("bundle.load failed for $namespace ${lang.code}: $error")
        null
    }
}

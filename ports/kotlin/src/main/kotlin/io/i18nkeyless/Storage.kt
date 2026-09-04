package io.i18nkeyless

import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap

/**
 * The storage i18n-keyless persists its cache in: translations per namespace, delta
 * cursors, the current language, usage analytics and the device id.
 *
 * Three synchronous methods, string values, so any backend fits: `SharedPreferences`, a
 * file, a database. Return `null` for a missing key. [MemoryStorage] is the default when
 * none is given (nothing survives a restart); [FileStorage] persists on any JVM.
 */
interface Storage {
    fun getItem(key: String): String?
    fun setItem(key: String, value: String)
    fun removeItem(key: String)
}

/** An in-memory [Storage] backed by a map. The default storage. */
open class MemoryStorage : Storage {
    private val map = ConcurrentHashMap<String, String>()

    /** A read-only snapshot, for tests and debugging. */
    val entries: Map<String, String> get() = map.toMap()

    override fun getItem(key: String): String? = map[key]
    override fun setItem(key: String, value: String) {
        map[key] = value
    }

    override fun removeItem(key: String) {
        map.remove(key)
    }

    fun clear() = map.clear()
}

/**
 * A [Storage] with one file per key under [directory]. Writes go to a temporary file first
 * and are moved into place atomically, so a crash mid-write never leaves a truncated
 * dictionary. On Android, `FileStorage(context.filesDir.resolve("i18n-keyless"))`.
 */
class FileStorage(private val directory: File) : Storage {
    init {
        directory.mkdirs()
    }

    // Storage keys hold characters a file system may refuse ("__check out/1"), so the
    // file name is the key percent-encoded, which is reversible and stays readable.
    private fun fileFor(key: String): File = File(directory, encodeUriComponent(key))

    override fun getItem(key: String): String? {
        val file = fileFor(key)
        return if (file.isFile) file.readText(StandardCharsets.UTF_8) else null
    }

    override fun setItem(key: String, value: String) {
        val target = fileFor(key)
        val temp = File(directory, "${target.name}.tmp")
        temp.writeText(value, StandardCharsets.UTF_8)
        Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }

    override fun removeItem(key: String) {
        fileFor(key).delete()
    }
}

/** The storage keys, identical to `i18n-keyless-react`. */
object StorageKeys {
    const val UNIQUE_ID = "i18n-keyless-user-id"
    const val LAST_REFRESH = "i18n-keyless-last-refresh"
    const val TRANSLATIONS = "i18n-keyless-translations"
    const val CURRENT_LANGUAGE = "i18n-keyless-current-language"

    /** Usage keyed by namespace: `{ "<namespace>": { "key__context": "YYYY-MM-DD" } }`. */
    const val TRANSLATIONS_USAGE = "i18n-keyless-translations-usage"

    /** JSON array of the namespaces persisted, so hydration knows what to load. */
    const val NAMESPACES = "i18n-keyless-namespaces"

    /** JSON array of the namespaces that hold origin-language (UGC) keys. */
    const val ORIGIN_NAMESPACES = "i18n-keyless-origin-namespaces"

    val ALL: List<String> = listOf(
        UNIQUE_ID, LAST_REFRESH, TRANSLATIONS, CURRENT_LANGUAGE, TRANSLATIONS_USAGE, NAMESPACES, ORIGIN_NAMESPACES,
    )

    /**
     * The key holding the translations of one namespace. The default namespace reuses the
     * legacy key; other namespaces get a `__<namespace>` suffix, not encoded.
     */
    fun translationsKeyFor(namespace: String): String =
        if (namespace == DEFAULT_NAMESPACE) TRANSLATIONS else "${TRANSLATIONS}__$namespace"

    /** The key holding the delta cursor of one namespace. */
    fun lastRefreshKeyFor(namespace: String): String =
        if (namespace == DEFAULT_NAMESPACE) LAST_REFRESH else "${LAST_REFRESH}__$namespace"
}

package io.i18nkeyless

import java.time.Clock
import java.time.LocalDate
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * The translation engine: a Kotlin port of `i18n-keyless-core` plus the store of
 * `i18n-keyless-react`, with no Android import.
 *
 * ```
 * val i18n = I18nKeylessClient()
 * i18n.initBlocking(I18nKeylessConfig(
 *     apiKey = "YOUR_API_KEY",
 *     languages = LanguagesConfig(primary = Lang.FR, supported = listOf(Lang.FR, Lang.EN)),
 *     storage = FileStorage(context.filesDir.resolve("i18n-keyless")),
 * ))
 * i18n.t("Bonjour") // "Bonjour" now, "Hello" once it lands
 * ```
 *
 * Lookups are synchronous. A miss is queued for translation (30 concurrent requests, one
 * per key), and when the queue drains the dictionary of the current language is fetched in
 * bulk and merged into the cache. Every change is announced to [addListener] listeners.
 * Nothing here ever throws on a network error, and a stored translation is never cleared
 * by a failed request.
 *
 * Thread safety: every public method may be called from any thread. State lives under one
 * lock; the network runs on daemon worker threads, never under that lock. Listeners are
 * called on the thread that made the change (a worker after a fetch, the caller after a
 * language switch): post to the main thread yourself when a view needs it.
 */
class I18nKeylessClient(
    private val api: Api = Api(),
    private val clock: Clock = Clock.systemUTC(),
    private val executor: Executor = daemonExecutor("i18n-keyless"),
    private val queue: PQueue = PQueue(concurrency = 30, executor = executor),
) {
    private val lock = ReentrantLock()

    @Volatile
    private var config: I18nKeylessConfig? = null
    private var storage: Storage = MemoryStorage()

    private lateinit var primary: Lang
    private lateinit var supported: List<Lang>
    private lateinit var fallback: Lang
    private lateinit var initWithDefault: Lang

    @Volatile
    private var current: Lang = Lang.EN

    @Volatile
    private var uniqueId: String? = null
    private var lastRefreshCursor: String? = null
    private val translations = HashMap<String, String>()
    private val translationsByNamespace = HashMap<String, MutableMap<String, String>>()
    private val namespaces = ArrayList<String>()
    private val unpersistedNamespaces = HashSet<String>()
    private val lastRefreshByNamespace = HashMap<String, String>()
    private val usageByNamespace = HashMap<String, MutableMap<String, String>>()
    private val originNamespaces = ArrayList<String>()

    /** Namespaces that had a miss since the last bulk fetch, mapped to `unpersisted`. */
    private val namespacesToFetch = LinkedHashMap<String, Boolean>()

    /** Queue ids in flight on `POST /translate`. */
    private val translating: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /**
     * Misses already queued for the current language, cleared when their namespace's bulk
     * fetch lands: a recomposition of the same text does not re-request the same key.
     */
    private val requestedMisses = HashSet<String>()

    /** ETags of the dictionaries fetched this session, keyed by `apiKey|lang|namespace`. */
    private val etags = ConcurrentHashMap<String, String>()

    /** Texts the component path already warned about (surrounding whitespace). */
    private val warnedWhitespace: MutableSet<String> = ConcurrentHashMap.newKeySet()

    @Volatile
    private var readyGate: CountDownLatch? = null
    private val inFlight: MutableSet<CompletableFuture<*>> = ConcurrentHashMap.newKeySet()
    private val listeners = CopyOnWriteArrayList<() -> Unit>()

    @Volatile
    private var usageWriteScheduled = false

    @Volatile
    private var disposed = false

    private val onQueueEmptyListener: () -> Unit = { onQueueEmpty() }

    init {
        queue.onEmpty(onQueueEmptyListener)
    }

    // ---------------------------------------------------------------------------
    // Public state

    val isInitialized: Boolean get() = config != null

    /** The configuration given to [init]. Throws before [init]. */
    val configuration: I18nKeylessConfig
        get() = config ?: throw IllegalStateException("i18n-keyless: config is not initialized. Call init().")

    val currentLanguage: Lang get() = current

    val primaryLanguage: Lang get() = lock.withLock { primary }

    val supportedLanguages: List<Lang> get() = lock.withLock { supported.toList() }

    /** The `sdk` header this client sends. */
    val runtime: String get() = config?.runtime ?: SDK_RUNTIME_CLIENT

    /** The flat translation map of the current language, merged across namespaces. */
    val translationsSnapshot: Map<String, String> get() = lock.withLock { HashMap(translations) }

    /** The device id, once hydrated. `null` on a server. */
    val deviceId: String? get() = uniqueId

    /** The delta cursor of the default namespace, as last returned by the API. */
    val lastRefresh: String? get() = lock.withLock { lastRefreshCursor }

    /** The ETags remembered this session, keyed by [etagCacheKey]. In memory only. */
    val dictionaryEtags: Map<String, String> get() = HashMap(etags)

    /**
     * Seeds the ETag of one dictionary, so the next fetch revalidates with `If-None-Match`
     * instead of downloading. For tests and custom transports.
     */
    fun seedEtag(etag: String, lang: Lang, namespace: String? = null) {
        etags[etagCacheKey(configuration.apiKey, lang.code, namespace)] = etag
    }

    /**
     * The namespaces that had a miss since the last bulk fetch, mapped to their
     * `unpersisted` flag. Diagnostic: the queue's empty handler drains it.
     */
    val namespacesAwaitingFetch: Map<String, Boolean> get() = lock.withLock { LinkedHashMap(namespacesToFetch) }

    /** Fires after every change of the language or of the translations. */
    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    // ---------------------------------------------------------------------------
    // Init

    /**
     * Validates [config] (throws [IllegalArgumentException] at once), then on a worker
     * thread hydrates the cache from storage, and starts the bulk fetch of the current
     * language and the usage POST in the background. The future completes once the cache is
     * hydrated: the app can render at once with the stored translations. Use [waitForIdle]
     * to also wait for the network.
     */
    fun init(config: I18nKeylessConfig): CompletableFuture<Unit> {
        require(config.languages.supported.isNotEmpty()) { "i18n-keyless: languages.supported must not be empty" }
        require(config.apiKey.isNotEmpty()) { "i18n-keyless: apiKey is required. Get a key at https://i18n-keyless.com" }
        val gate = CountDownLatch(1)
        lock.withLock {
            this.config = config
            storage = config.storage ?: MemoryStorage()
            val languages = config.languages
            primary = languages.primary
            initWithDefault = languages.initWithDefault ?: primary
            fallback = languages.fallback ?: primary
            val list = ArrayList(languages.supported)
            if (initWithDefault !in list) list.add(initWithDefault)
            if (primary !in list) list.add(primary)
            supported = list
            current = initWithDefault
            // Close the boot race: hold every request until the device id is known, so no
            // request goes out unidentified (the API bills each of those as a new user).
            readyGate = gate
        }
        val hydrated = CompletableFuture<Unit>()
        track(hydrated)
        executor.execute {
            try {
                lock.withLock { hydrate(config) }
            } catch (error: Throwable) {
                log("hydration error: $error")
            } finally {
                // Released whatever happened, so a failed hydration can never deadlock the queue.
                gate.countDown()
                readyGate = null
            }
            try {
                config.onInit?.invoke(current)
            } catch (error: Throwable) {
                log("onInit error: $error")
            }
            track(switchLanguage(current))
            if (isUsageReportingEnabled(config.runtime)) track(CompletableFuture.runAsync({ sendUsage() }, executor))
            hydrated.complete(Unit)
        }
        return hydrated
    }

    /** [init], waiting for the hydration. */
    fun initBlocking(config: I18nKeylessConfig) {
        init(config).get()
    }

    private fun read(key: String): String? = try {
        storage.getItem(key)?.takeIf { it.isNotEmpty() }
    } catch (error: Throwable) {
        log("Error getting item $key: $error")
        null
    }

    private fun readJson(key: String): Any? {
        val raw = read(key) ?: return null
        return try {
            Json.parse(raw)
        } catch (error: JsonException) {
            log("Error parsing item $key: $error")
            null
        }
    }

    private fun write(key: String, value: String) {
        try {
            storage.setItem(key, value)
        } catch (error: Throwable) {
            log("Error setting item $key: $error")
        }
    }

    private fun remove(key: String) {
        try {
            storage.removeItem(key)
        } catch (error: Throwable) {
            log("Error removing item $key: $error")
        }
    }

    /** Under the lock. The read order is the storage contract (protocol section 11.3). */
    private fun hydrate(config: I18nKeylessConfig) {
        val debug = config.debug
        if (isServerRuntime(config.runtime)) {
            uniqueId = null
        } else {
            // The device id, FIRST, before any other storage read.
            val stored = read(StorageKeys.UNIQUE_ID)
            val id = if (isUniqueId(stored)) stored!! else generateUniqueId()
            uniqueId = id
            if (id != stored) write(StorageKeys.UNIQUE_ID, id)
            if (debug) log("hydrate: uniqueId $id")
        }

        // The namespaces index. With no index, the legacy default key is still read.
        val storedNamespaces = readJson(StorageKeys.NAMESPACES)
        val namespacesToLoad =
            if (storedNamespaces is List<*> && storedNamespaces.isNotEmpty()) storedNamespaces.map { it.toString() }
            else listOf(DEFAULT_NAMESPACE)
        val cursors = HashMap<String, String>()
        for (namespace in namespacesToLoad) {
            val slice = readJson(StorageKeys.translationsKeyFor(namespace))
            if (slice is Map<*, *>) {
                val loaded = LinkedHashMap<String, String>()
                for ((key, value) in slice) if (value is String) loaded[key.toString()] = value
                translationsByNamespace[namespace] = loaded
                translations.putAll(loaded)
                if (namespace !in namespaces) namespaces.add(namespace)
            }
            read(StorageKeys.lastRefreshKeyFor(namespace))?.let { cursors[namespace] = it }
        }
        // Cursors count only when at least one slice was found (reference behaviour).
        if (namespaces.isNotEmpty()) lastRefreshByNamespace.putAll(cursors)
        if (debug) log("hydrate: ${translations.size} translations")

        val storedOrigin = readJson(StorageKeys.ORIGIN_NAMESPACES)
        if (storedOrigin is List<*>) originNamespaces.addAll(storedOrigin.map { it.toString() })

        // Usage is keyed by namespace (values are maps). A legacy flat map is discarded.
        val storedUsage = readJson(StorageKeys.TRANSLATIONS_USAGE)
        if (storedUsage is Map<*, *>) {
            val namespaced = storedUsage.values.isEmpty() || storedUsage.values.first() is Map<*, *>
            if (namespaced) {
                for ((namespace, bucket) in storedUsage) {
                    if (bucket is Map<*, *>) {
                        usageByNamespace[namespace.toString()] =
                            bucket.entries.associateTo(HashMap()) { it.key.toString() to it.value.toString() }
                    }
                }
            } else if (debug) {
                log("hydrate: discarding legacy flat usage")
            }
        }

        current = if (config.languages.skipCurrentLanguageHydration) {
            initWithDefault
        } else {
            Lang.fromCode(read(StorageKeys.CURRENT_LANGUAGE)) ?: initWithDefault
        }
        if (debug) log("hydrate: currentLanguage $current")
        lastRefreshCursor = read(StorageKeys.LAST_REFRESH)
    }

    // ---------------------------------------------------------------------------
    // Lookup

    /**
     * The translation of [text] in the current language, or [text] itself when it is not
     * there yet (the miss is queued; a listener announces the update). Never throws, never
     * blocks on the network. Before [init], returns [text] with [replace] applied. The
     * function path: [text] is not trimmed.
     */
    fun t(
        text: String,
        context: String? = null,
        namespace: String? = null,
        replace: Map<String, String>? = null,
        forceTemporary: Map<Lang, String>? = null,
        originLanguage: Lang? = null,
        unpersistedNamespace: Boolean = false,
        debug: Boolean = false,
    ): String = translate(
        text,
        TranslationOptions(
            context = context,
            namespace = namespace,
            unpersistedNamespace = unpersistedNamespace,
            replace = replace,
            forceTemporary = forceTemporary,
            originLanguage = originLanguage,
            debug = debug,
        ),
    )

    /**
     * The component path, for a Compose or XML binding: [t] with the source text trimmed
     * (surrounding whitespace would change the key). Warns once per text, with `debug`,
     * when it had to trim.
     */
    fun text(
        text: String,
        context: String? = null,
        namespace: String? = null,
        replace: Map<String, String>? = null,
        forceTemporary: Map<Lang, String>? = null,
        originLanguage: Lang? = null,
        unpersistedNamespace: Boolean = false,
        debug: Boolean = false,
    ): String {
        val trimmed = text.trim()
        if (trimmed != text && (config?.debug == true || debug) && warnedWhitespace.add(text)) {
            log("\"$text\" has leading or trailing whitespace; it was trimmed, but the key in your source should not have it")
        }
        return t(trimmed, context, namespace, replace, forceTemporary, originLanguage, unpersistedNamespace, debug)
    }

    /** [t] with a [TranslationOptions] object. */
    fun translate(text: String, options: TranslationOptions = TranslationOptions.NONE): String {
        val config = config ?: return applyReplace(text, options.replace)
        lock.withLock {
            val storageKey = storageKeyFor(text, options.context)
            val origin = resolveOriginLanguage(options.originLanguage, primary)
            if (isUsageReportingEnabled(config.runtime)) {
                recordUsage(storageKey, options)
                if (origin != null) registerOriginNamespace(resolveNamespace(options.namespace, config.defaultNamespace), options.unpersistedNamespace)
            }
            // The language the text is already written in: the primary language, except for
            // UGC (originLanguage). A UGC key needs a lookup even in the primary language.
            val sourceLanguage = origin ?: primary
            var translation: String? = text
            if (current != sourceLanguage) {
                if (options.forceTemporary?.get(current) != null) translateKey(text, options)
                translation = translations[storageKey]
                if (translation.isNullOrEmpty()) translateKey(text, options)
            }
            if (options.debug) log("translate \"$text\" ($current): ${translation ?: text}")
            val resolved = if (translation.isNullOrEmpty()) text else translation
            return applyReplace(resolved, options.replace)
        }
    }

    // ---------------------------------------------------------------------------
    // Translate on miss

    /** Under the lock. */
    private fun translateKey(key: String, options: TranslationOptions) {
        if (key.isEmpty()) return
        val config = config ?: return
        val namespace = resolveNamespace(options.namespace, config.defaultNamespace)
        val storageKey = storageKeyFor(key, options.context)
        val forced = options.forceTemporary?.get(current) != null
        val existing = translations[storageKey]
        if (!existing.isNullOrEmpty() && !forced) return

        val missId = "${current.code}|$namespace|$storageKey"
        if (!requestedMisses.add(missId)) return

        // Remember this namespace so the queue's empty handler bulk-fetches it, and only it.
        namespacesToFetch[namespace] = options.unpersistedNamespace
        // Dedupe per namespace so the same text can be queued under two namespaces.
        val queueId = queueIdFor(namespace, key)
        if (options.debug) log("translateKey \"$key\" (${options.context}) [$namespace]")
        val origin = resolveOriginLanguage(options.originLanguage, primary)
        val body = LinkedHashMap<String, Any?>()
        body["key"] = key
        options.context?.let { body["context"] = it }
        // Omit the default namespace so the wire format is unchanged for projects that do
        // not use namespaces.
        if (namespace != DEFAULT_NAMESPACE) body["namespace"] = namespace
        options.forceTemporary?.let { forceTemporary ->
            body["forceTemporary"] = forceTemporary.entries.associate { it.key.code to it.value }
        }
        body["languages"] = supported.map { it.code }
        body["primaryLanguage"] = primary.code
        origin?.let { body["originLanguage"] = it.code }

        track(queue.add(priority = 1, id = queueId) {
            // A task whose id is already in flight returns at once without a request.
            if (!translating.add(queueId)) return@add
            try {
                val handler = config.handleTranslate
                if (handler != null) {
                    val result = handler(key)
                    if (result.message.isNotEmpty()) log(result.message)
                    return@add
                }
                // Wait for the device id before the first request of a session can leave.
                whenReady()
                val result = api.post("${apiUrl()}/translate", headers(), body)
                if (options.debug) log("translate response: ${result.json}")
                if (!result.ok && result.error.isNotEmpty()) log("Error translating key \"$key\": ${result.error}")
                if (result.message.isNotEmpty()) log(result.message)
            } catch (error: Throwable) {
                log("Error translating key: $error")
            } finally {
                translating.remove(queueId)
            }
        })
    }

    private fun onQueueEmpty() {
        val batch: Map<String, Boolean>
        val lang: Lang
        val cursors: Map<String, String>
        lock.withLock {
            if (config == null || disposed) return
            batch = LinkedHashMap(namespacesToFetch)
            namespacesToFetch.clear()
            lang = current
            cursors = HashMap(lastRefreshByNamespace)
        }
        for ((namespace, unpersisted) in batch) {
            track(CompletableFuture.runAsync({
                val response = fetchLanguage(lang, namespace, cursors[namespace])
                val changed = lock.withLock {
                    requestedMisses.removeIf { it.startsWith("${lang.code}|$namespace|") }
                    setTranslations(response, namespace, unpersisted)
                }
                if (changed) notifyListeners()
            }, executor))
        }
    }

    // ---------------------------------------------------------------------------
    // Bulk fetch

    /** Outside the lock: this is the network. */
    private fun fetchLanguage(lang: Lang, namespace: String, lastRefresh: String?): TranslationsResponse? {
        val config = config ?: return null
        config.getAllTranslations?.let { custom ->
            return try {
                custom()
            } catch (error: Throwable) {
                log("fetch all translations error: $error")
                null
            }
        }
        val etagKey = etagCacheKey(config.apiKey, lang.code, namespace)
        val etag = etags[etagKey]
        // With an ETag in hand, freshness travels in If-None-Match and last_refresh leaves
        // the URL, which becomes stable so shared HTTP caches can hold it.
        val url = buildDictionaryUrl(apiUrl(), lang.code, lastRefresh, namespace, etag)
        whenReady()
        val requestHeaders = LinkedHashMap(headers())
        if (etag != null) requestHeaders["If-None-Match"] = etag
        val result = api.get(url, requestHeaders)
        if (result.notModified) {
            if (config.debug) log("fetch $lang [$namespace]: not modified")
            return TranslationsResponse.NOT_MODIFIED
        }
        val json = result.json
        if (!result.ok || json == null) {
            log("fetch all translations error: ${result.error}")
            return null
        }
        // `result.ok` is the body's `ok`, so the parsed response is always ok here.
        val response = TranslationsResponse.fromJson(json, result.etag)
        response.etag?.let { etags[etagKey] = it }
        if (response.message.isNotEmpty()) log(response.message)
        return response
    }

    /** Under the lock. Returns whether a translation changed (the caller notifies). */
    private fun setTranslations(response: TranslationsResponse?, namespace: String, unpersisted: Boolean): Boolean {
        if (response == null || !response.ok || response.notModified) return false
        val incoming = response.translations
        var changed = false
        for ((key, value) in incoming) if (translations[key] != value) changed = true
        translations.putAll(incoming)
        val slice = translationsByNamespace.getOrPut(namespace) { LinkedHashMap() }
        slice.putAll(incoming)
        val isNewNamespace = namespace !in namespaces
        if (isNewNamespace) namespaces.add(namespace)
        if (unpersisted) unpersistedNamespaces.add(namespace)

        // Adopt the id the server echoed back only when this device has none: the header
        // we send is authoritative, and a new id is a new billed "user".
        val config = config
        if (config != null && !isServerRuntime(config.runtime) && uniqueId == null && isUniqueId(response.uniqueId)) {
            uniqueId = response.uniqueId
            write(StorageKeys.UNIQUE_ID, response.uniqueId!!)
        }

        // An empty cursor is not a cursor (JavaScript truthiness).
        val lastRefresh = response.lastRefresh?.takeIf { it.isNotEmpty() }
        if (unpersisted) {
            if (lastRefresh != null) {
                lastRefreshCursor = lastRefresh
                lastRefreshByNamespace[namespace] = lastRefresh
            }
            return changed
        }

        write(StorageKeys.translationsKeyFor(namespace), Json.stringify(slice))
        if (isNewNamespace) {
            write(StorageKeys.NAMESPACES, Json.stringify(namespaces.filter { it !in unpersistedNamespaces }))
        }
        if (lastRefresh != null) {
            lastRefreshCursor = lastRefresh
            lastRefreshByNamespace[namespace] = lastRefresh
            write(StorageKeys.lastRefreshKeyFor(namespace), lastRefresh)
        }
        return changed
    }

    // ---------------------------------------------------------------------------
    // Language

    /**
     * Switches the language. An unsupported language falls back to
     * [LanguagesConfig.fallback]. Listeners are notified at once (cached translations show
     * immediately), and the returned future completes when the dictionary of the new
     * language has been fetched and merged.
     */
    fun setLanguage(lang: Lang): CompletableFuture<Unit> {
        try {
            configuration.onSetLanguage?.invoke(lang)
        } catch (error: Throwable) {
            log("onSetLanguage error: $error")
        }
        return track(switchLanguage(lang))
    }

    private fun switchLanguage(lang: Lang): CompletableFuture<Unit> {
        val validated: Lang
        val toFetch: List<String>
        lock.withLock {
            val config = configuration
            validated = if (lang in supported) lang else fallback
            if (config.debug && validated != lang) log("language $lang is not supported, fallback to $validated")
            current = validated
            // Every delta cursor is stale after a language change: reset them all and
            // refetch the full set of each known namespace.
            val known = if (namespaces.isNotEmpty()) namespaces.toList() else listOf(DEFAULT_NAMESPACE)
            lastRefreshCursor = null
            lastRefreshByNamespace.clear()
            requestedMisses.clear()
            write(StorageKeys.CURRENT_LANGUAGE, validated.code)
            for (namespace in known) {
                if (namespace !in unpersistedNamespaces) write(StorageKeys.lastRefreshKeyFor(namespace), "")
            }
            toFetch = when {
                validated != primary -> known
                // The primary language still needs fetched data for the namespaces holding
                // UGC keys: their primary version is an AI translation, not the key itself.
                originNamespaces.isNotEmpty() -> originNamespaces.toList()
                else -> emptyList()
            }
        }
        notifyListeners()
        if (toFetch.isEmpty()) return CompletableFuture.completedFuture(Unit)
        val fetches = toFetch.map { namespace ->
            CompletableFuture.runAsync({
                val response = fetchLanguage(validated, namespace, null)
                val changed = lock.withLock { setTranslations(response, namespace, namespace in unpersistedNamespaces) }
                if (changed) notifyListeners()
            }, executor)
        }
        return CompletableFuture.allOf(*fetches.toTypedArray()).thenApply { }
    }

    // ---------------------------------------------------------------------------
    // Usage analytics

    /** Under the lock. */
    private fun recordUsage(storageKey: String, options: TranslationOptions) {
        // Transient namespaces do not report usage: they would flood the prune signal.
        if (options.unpersistedNamespace) return
        val namespace = resolveNamespace(options.namespace, config?.defaultNamespace)
        val today = LocalDate.now(clock).toString()
        val bucket = usageByNamespace.getOrPut(namespace) { HashMap() }
        if (bucket[storageKey] == today) return
        bucket[storageKey] = today
        scheduleUsageWrite()
    }

    /** Under the lock. One write per burst of renders, off the calling thread. */
    private fun scheduleUsageWrite() {
        if (usageWriteScheduled) return
        usageWriteScheduled = true
        val write = CompletableFuture.runAsync({
            lock.withLock {
                usageWriteScheduled = false
                if (!disposed) write(StorageKeys.TRANSLATIONS_USAGE, Json.stringify(usageByNamespace))
            }
        }, executor)
        track(write)
    }

    /** Under the lock. */
    private fun registerOriginNamespace(namespace: String, unpersisted: Boolean) {
        if (namespace in originNamespaces) return
        originNamespaces.add(namespace)
        if (!unpersisted) {
            write(StorageKeys.ORIGIN_NAMESPACES, Json.stringify(originNamespaces.filter { it !in unpersistedNamespaces }))
        }
    }

    /** Outside the lock. */
    private fun sendUsage() {
        val config = config ?: return
        val usage: Map<String, Map<String, String>> = lock.withLock {
            if (usageByNamespace.isEmpty()) return
            usageByNamespace.entries.associate { it.key to HashMap(it.value) }
        }
        val ok: Boolean
        val message: String
        try {
            val custom = config.sendTranslationsUsage
            if (custom != null) {
                val response = custom(usage[DEFAULT_NAMESPACE] ?: emptyMap())
                ok = response.ok
                message = response.message
            } else {
                whenReady()
                val result = api.post(
                    "${apiUrl()}/translate/last-used-translations",
                    headers(),
                    mapOf("primaryLanguage" to primary.code, "translationsUsageByNamespace" to usage),
                )
                ok = result.ok
                message = if (result.ok) result.message else result.error
            }
        } catch (error: Throwable) {
            log("send translations usage error: $error")
            return
        }
        if (message.isNotEmpty()) log(message)
        if (ok) {
            lock.withLock {
                usageByNamespace.clear()
                write(StorageKeys.TRANSLATIONS_USAGE, "")
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Housekeeping

    /**
     * Blocks until no request, storage write or fetch is pending. For tests, and for a
     * splash screen that wants the first dictionary before showing the app.
     */
    fun waitForIdle() {
        while (true) {
            queue.whenIdle().get()
            // `toArray` of the concurrent set, not an iteration: futures remove themselves meanwhile.
            for (future in ArrayList(inFlight)) {
                try {
                    future.join()
                } catch (_: Throwable) {
                    // Logged where it happened; idleness is all that matters here.
                }
            }
            if (queue.isIdle && inFlight.isEmpty() && !usageWriteScheduled) return
            Thread.sleep(1)
        }
    }

    /**
     * Removes every cached translation, cursor and usage record from storage and from
     * memory. The device id and the config are kept: the id identifies the install, and
     * wiping it would bill one more "user" at the next launch.
     */
    fun clearStorage() {
        lock.withLock {
            for (namespace in namespaces.toList()) {
                remove(StorageKeys.translationsKeyFor(namespace))
                remove(StorageKeys.lastRefreshKeyFor(namespace))
            }
            for (key in StorageKeys.ALL) if (key != StorageKeys.UNIQUE_ID) remove(key)
            translations.clear()
            translationsByNamespace.clear()
            namespaces.clear()
            unpersistedNamespaces.clear()
            lastRefreshByNamespace.clear()
            lastRefreshCursor = null
            usageByNamespace.clear()
            originNamespaces.clear()
            requestedMisses.clear()
            etags.clear()
        }
        notifyListeners()
        waitForIdle()
    }

    /** Stops listening to the queue and drops the listeners. The client is not reusable. */
    fun dispose() {
        disposed = true
        queue.offEmpty(onQueueEmptyListener)
        listeners.clear()
    }

    private fun whenReady() {
        readyGate?.await()
    }

    private fun apiUrl(): String {
        val url = config?.apiUrl
        if (url.isNullOrEmpty()) return DEFAULT_API_URL
        return url.removeSuffix("/")
    }

    /** The exact header set of every request (protocol section 3.2). */
    private fun headers(): Map<String, String> {
        val config = configuration
        val headers = LinkedHashMap<String, String>()
        headers["Content-Type"] = "application/json"
        headers["Authorization"] = "Bearer ${config.apiKey}"
        headers["Version"] = VERSION
        headers["sdk"] = config.runtime
        if (!isServerRuntime(config.runtime)) {
            // Never empty: an empty header means "one shared anonymous user" to the API.
            headers["unique_id"] = uniqueId ?: generateUniqueId().also { uniqueId = it }
        }
        return headers
    }

    private fun <T> track(future: CompletableFuture<T>): CompletableFuture<T> {
        inFlight.add(future)
        future.whenComplete { _, error ->
            inFlight.remove(future)
            if (error != null) log("$error")
        }
        return future
    }

    private fun notifyListeners() {
        if (disposed) return
        for (listener in listeners) {
            try {
                listener()
            } catch (error: Throwable) {
                log("listener error: $error")
            }
        }
    }

    private fun log(message: String) {
        val logger = config?.logger
        if (logger != null) logger("i18n-keyless: $message") else println("i18n-keyless: $message")
    }
}

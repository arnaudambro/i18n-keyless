import Foundation
#if canImport(Combine)
import Combine
#endif

/// The translation engine: a Swift port of `i18n-keyless-core` plus the store of
/// `i18n-keyless-react`. `I18nKeyless.shared` is the instance an app uses; a test or a
/// multi-project process creates its own.
///
/// ```swift
/// try I18nKeyless.configure(.init(
///     apiKey: "YOUR_API_KEY",
///     languages: .init(primary: .fr, supported: [.fr, .en])))
/// I18nKeyless.t("Bonjour")   // "Bonjour" now, "Hello" once it lands
/// ```
///
/// Lookups are synchronous. A miss is queued for translation (30 concurrent requests, one
/// per key), and when the queue drains the dictionary of the current language is fetched
/// in bulk and merged into the cache. Every change bumps `revision` and, on Apple
/// platforms, publishes `objectWillChange` on the main thread so SwiftUI re-renders.
/// Nothing here ever throws on a network error, and a stored translation is never cleared
/// by a failed request.
public final class I18nKeyless: @unchecked Sendable {
    public typealias Config = I18nKeylessConfig

    /// The instance behind the static API and `I18nKeylessText`.
    public static let shared = I18nKeyless()

    private let queue: PQueue
    private let injectedApi: ApiClient?
    private var api: ApiClient?
    private var config: Config?
    private var storage: I18nKeylessStorage = MemoryStorage()

    private var primary: Lang = .en
    private var supported: [Lang] = []
    private var fallback: Lang = .en
    private var initWithDefault: Lang = .en
    private var current: Lang = .en

    private var uniqueId: String?
    private var lastRefreshValue: String?
    private var translations: Translations = [:]
    private var translationsByNamespace: [String: Translations] = [:]
    private var namespaces: [String] = []
    private var unpersistedNamespaces: Set<String> = []
    private var lastRefreshByNamespace: [String: String] = [:]
    private var usageByNamespace: [String: TranslationsUsage] = [:]
    private var originNamespaces: [String] = []
    /// Namespaces that had a miss since the last bulk fetch, mapped to `unpersisted`.
    private var namespacesToFetch: [String: Bool] = [:]
    /// Keys in flight on `POST /translate`.
    private var translating: Set<String> = []
    /// Misses already queued for the current language, cleared when their namespace's bulk
    /// fetch lands: a re-render of the same view does not re-request the same key.
    private var requestedMisses: Set<String> = []
    /// ETags of the dictionaries fetched this session, keyed by `apiKey|lang|namespace`.
    private var etags: [String: String] = [:]
    private var usageWriteScheduled = false
    private var inFlight: [UUID: Task<Void, Never>] = [:]
    private var revisionValue = 0
    private var listeners: [(UUID, () -> Void)] = []

    /// One recursive lock guards every field above. `t()` is called from view bodies and
    /// the network tasks merge from any thread; the lock is the boot gate too: hydration
    /// runs under it, so no request can read the state before the device id is known.
    private let lock = NSRecursiveLock()

    /// - Parameters:
    ///   - queue: the translate-on-miss queue (one per instance; 30 in flight).
    ///   - api: an `ApiClient` with an injected sleeper or timeout, for tests.
    public init(queue: PQueue? = nil, api: ApiClient? = nil) {
        self.queue = queue ?? PQueue(concurrency: 30)
        self.injectedApi = api
        self.queue.onEmpty { [weak self] in self?.onQueueEmpty() }
    }

    // MARK: - Static facade over `shared`

    public static func configure(_ config: Config) throws { try shared.configure(config) }

    public static func t(
        _ key: String, context: String? = nil, namespace: String? = nil,
        replace: KeyValuePairs<String, String>? = nil, forceTemporary: [Lang: String]? = nil,
        originLanguage: Lang? = nil, unpersistedNamespace: Bool = false, debug: Bool = false
    ) -> String {
        shared.t(key, context: context, namespace: namespace, replace: replace,
                 forceTemporary: forceTemporary, originLanguage: originLanguage,
                 unpersistedNamespace: unpersistedNamespace, debug: debug)
    }

    public static func setLanguage(_ lang: Lang) async { await shared.setLanguage(lang) }

    public static var currentLanguage: Lang { shared.currentLanguage }

    // MARK: - Public state

    public var isConfigured: Bool { lock.lock(); defer { lock.unlock() }; return config != nil }

    /// The language the app renders in.
    public var currentLanguage: Lang { lock.lock(); defer { lock.unlock() }; return current }

    public var primaryLanguage: Lang { lock.lock(); defer { lock.unlock() }; return primary }

    public var supportedLanguages: [Lang] { lock.lock(); defer { lock.unlock() }; return supported }

    /// The `sdk` header of this instance.
    public var runtime: String {
        lock.lock(); defer { lock.unlock() }
        return config?.server == true ? I18nKeylessRuntime.server : I18nKeylessRuntime.client
    }

    /// Counts every change of the language or of the translations; a SwiftUI view that
    /// reads it re-renders on every change.
    public var revision: Int { lock.lock(); defer { lock.unlock() }; return revisionValue }

    /// The flat translation map of the current language, merged across namespaces.
    public var currentTranslations: Translations { lock.lock(); defer { lock.unlock() }; return translations }

    /// The device id, nil on a server runtime.
    public var deviceId: String? { lock.lock(); defer { lock.unlock() }; return uniqueId }

    /// The delta cursor of the default namespace, as last returned by the API.
    public var lastRefresh: String? { lock.lock(); defer { lock.unlock() }; return lastRefreshValue }

    /// The ETags remembered this session, keyed by `etagCacheKey`. In memory only.
    public var dictionaryEtags: [String: String] { lock.lock(); defer { lock.unlock() }; return etags }

    /// The namespaces that had a miss since the last bulk fetch, mapped to their
    /// `unpersisted` flag. Diagnostic: the queue's empty handler drains it.
    public var namespacesAwaitingFetch: [String: Bool] { lock.lock(); defer { lock.unlock() }; return namespacesToFetch }

    /// Seeds the ETag of one dictionary, so the next fetch revalidates with `If-None-Match`
    /// instead of downloading. For tests and custom transports.
    public func seedEtag(_ etag: String, lang: Lang, namespace: String? = nil) {
        lock.lock(); defer { lock.unlock() }
        guard let config = config else { return }
        etags[Self.etagCacheKey(apiKey: config.apiKey, lang: lang.code, namespace: namespace)] = etag
    }

    /// Fires after every change of the language or of the translations, on the thread of
    /// the change. Returns a token for `removeListener`.
    @discardableResult
    public func addListener(_ listener: @escaping () -> Void) -> UUID {
        let token = UUID()
        lock.lock(); listeners.append((token, listener)); lock.unlock()
        return token
    }

    public func removeListener(_ token: UUID) {
        lock.lock(); listeners.removeAll { $0.0 == token }; lock.unlock()
    }

    // MARK: - Configure

    /// Validates `config`, hydrates the cache from storage, then starts the bulk fetch of
    /// the current language and the usage POST in the background. Returns once the cache
    /// is hydrated: the app can render at once with the stored translations. Use
    /// `waitForIdle()` to also wait for the network.
    public func configure(_ config: Config) throws {
        if config.languages.supported.isEmpty { throw I18nKeylessError.supportedLanguagesEmpty }
        if config.apiKey.isEmpty { throw I18nKeylessError.apiKeyRequired }
        lock.lock()
        self.config = config
        storage = config.storage ?? (config.server ? MemoryStorage() : UserDefaultsStorage())
        api = injectedApi ?? ApiClient(configuration: config.urlSessionConfiguration)
        primary = config.languages.primary
        initWithDefault = config.languages.initWithDefault ?? primary
        fallback = config.languages.fallback ?? primary
        supported = config.languages.supported
        if !supported.contains(initWithDefault) { supported.append(initWithDefault) }
        if !supported.contains(primary) { supported.append(primary) }
        current = initWithDefault
        // Hydration runs under the lock: every outbound request reads the state under the
        // same lock, so none can leave before the device id is known (the boot gate).
        hydrate(config)
        let language = current
        lock.unlock()
        config.onInit?(language)
        track { [self] in await self.applyLanguage(language) }
        if !config.server { track { [self] in await self.sendUsage() } }
    }

    private func read(_ key: String) -> String? {
        do {
            let value = try storage.getItem(key)
            return (value?.isEmpty ?? true) ? nil : value
        } catch {
            log("Error getting item \(key): \(error)")
            return nil
        }
    }

    private func readJSON(_ key: String) -> Any? {
        guard let raw = read(key), let data = raw.data(using: .utf8) else { return nil }
        do {
            return try JSONSerialization.jsonObject(with: data)
        } catch {
            log("Error parsing item \(key): \(error)")
            return nil
        }
    }

    private func write(_ key: String, _ value: String) {
        do { try storage.setItem(key, value) } catch { log("Error setting item \(key): \(error)") }
    }

    private func writeJSON(_ key: String, _ value: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let text = String(data: data, encoding: .utf8) else { return }
        write(key, text)
    }

    private func remove(_ key: String) {
        do { try storage.removeItem(key) } catch { log("Error removing item \(key): \(error)") }
    }

    /// Storage read order is a protocol rule (section 11.3), starting with the device id.
    private func hydrate(_ config: Config) {
        if !config.server {
            let stored = read(StorageKeys.uniqueId)
            let id = UniqueId.isValid(stored) ? stored! : UniqueId.generate()
            uniqueId = id
            if id != stored { write(StorageKeys.uniqueId, id) }
            if config.debug { log("hydrate: uniqueId \(id)") }
        }

        // The namespaces index. With no index, the legacy default key is still read.
        let storedNamespaces = readJSON(StorageKeys.namespaces) as? [Any] ?? []
        let toLoad = storedNamespaces.isEmpty
            ? [i18nKeylessDefaultNamespace] : storedNamespaces.map { "\($0)" }
        var cursors: [String: String] = [:]
        for namespace in toLoad {
            if let slice = readJSON(StorageKeys.translationsKeyFor(namespace)) as? [String: Any] {
                var dictionary: Translations = [:]
                for (key, value) in slice { if let value = value as? String { dictionary[key] = value } }
                translationsByNamespace[namespace] = dictionary
                translations.merge(dictionary) { _, new in new }
                if !namespaces.contains(namespace) { namespaces.append(namespace) }
            }
            if let cursor = read(StorageKeys.lastRefreshKeyFor(namespace)) { cursors[namespace] = cursor }
        }
        // Cursors count only when at least one slice was found (reference behaviour).
        if !namespaces.isEmpty { lastRefreshByNamespace.merge(cursors) { _, new in new } }
        if config.debug { log("hydrate: \(translations.count) translations") }

        if let stored = readJSON(StorageKeys.originNamespaces) as? [Any] {
            originNamespaces = stored.map { "\($0)" }
        }

        // Usage is keyed by namespace (values are maps). A legacy flat map is discarded.
        if let stored = readJSON(StorageKeys.translationsUsage) as? [String: Any] {
            let namespaced = stored.values.first.map { $0 is [String: Any] } ?? true
            if namespaced {
                for (namespace, bucket) in stored {
                    if let bucket = bucket as? [String: Any] {
                        usageByNamespace[namespace] = bucket.mapValues { "\($0)" }
                    }
                }
            } else if config.debug {
                log("hydrate: discarding legacy flat usage")
            }
        }

        if config.languages.skipCurrentLanguageHydration {
            current = initWithDefault
        } else {
            current = Lang(code: read(StorageKeys.currentLanguage)) ?? initWithDefault
        }
        if config.debug { log("hydrate: currentLanguage \(current.code)") }
        lastRefreshValue = read(StorageKeys.lastRefresh)
    }

    // MARK: - Lookup

    /// The translation of `key` in the current language, or `key` itself when it is not
    /// there yet (the miss is queued; observe `revision` for the update). Never throws,
    /// never blocks. Before `configure`, returns `key` with `replace` applied. Does not
    /// trim: that is the job of `I18nKeylessText`.
    public func t(
        _ key: String, context: String? = nil, namespace: String? = nil,
        replace: KeyValuePairs<String, String>? = nil, forceTemporary: [Lang: String]? = nil,
        originLanguage: Lang? = nil, unpersistedNamespace: Bool = false, debug: Bool = false
    ) -> String {
        translate(key, TranslationOptions(
            context: context, namespace: namespace, unpersistedNamespace: unpersistedNamespace,
            debug: debug, forceTemporary: forceTemporary, replace: replace,
            originLanguage: originLanguage))
    }

    /// `t` with an options value.
    public func translate(_ key: String, _ options: TranslationOptions = TranslationOptions()) -> String {
        lock.lock(); defer { lock.unlock() }
        guard let config = config else { return Self.applyReplace(key, options.replace) }
        let storageKey = Self.storageKeyFor(key, context: options.context)
        let origin = Self.resolveOriginLanguage(options, primary: primary)
        if !config.server {
            recordUsage(storageKey, options)
            if origin != nil {
                registerOriginNamespace(namespaceOf(options), unpersisted: options.unpersistedNamespace)
            }
        }
        // The language the text is already written in: the primary language, except for
        // UGC (originLanguage). A UGC key needs a lookup even in the primary language.
        let sourceLanguage = origin ?? primary
        var translation: String? = key
        if current != sourceLanguage {
            if options.forceTemporary?[current] != nil { translateKey(key, options) }
            translation = translations[storageKey]
            if translation?.isEmpty ?? true { translateKey(key, options) }
        }
        if options.debug { log("translate \"\(key)\" (\(current.code)): \(translation ?? key)") }
        let resolved = (translation?.isEmpty ?? true) ? key : translation!
        return Self.applyReplace(resolved, options.replace)
    }

    private func namespaceOf(_ options: TranslationOptions) -> String {
        Self.resolveNamespace(options, defaultNamespace: config?.defaultNamespace)
    }

    // MARK: - Translate on miss

    private func translateKey(_ key: String, _ options: TranslationOptions) {
        guard !key.isEmpty, let config = config else { return }
        let namespace = namespaceOf(options)
        let storageKey = Self.storageKeyFor(key, context: options.context)
        let forced = options.forceTemporary?[current] != nil
        if let existing = translations[storageKey], !existing.isEmpty, !forced { return }

        let missId = "\(current.code)|\(namespace)|\(storageKey)"
        if requestedMisses.contains(missId) { return }
        requestedMisses.insert(missId)

        // Remember this namespace so the queue's empty handler bulk-fetches it, and only it.
        namespacesToFetch[namespace] = options.unpersistedNamespace
        // Dedupe per namespace so the same text can be queued under two namespaces.
        let queueId = Self.queueIdFor(namespace: namespace, key: key)
        if options.debug { log("translateKey \"\(key)\" (\(options.context ?? "")) [\(namespace)]") }
        let origin = Self.resolveOriginLanguage(options, primary: primary)
        let body: [String: Any] = {
            var body: [String: Any] = [
                "key": key,
                "languages": supported.map(\.code),
                "primaryLanguage": primary.code,
            ]
            if let context = options.context { body["context"] = context }
            // Omit the default namespace so the wire format is unchanged for projects that
            // do not use namespaces.
            if namespace != i18nKeylessDefaultNamespace { body["namespace"] = namespace }
            if let forced = options.forceTemporary {
                body["forceTemporary"] = Dictionary(uniqueKeysWithValues: forced.map { ($0.key.code, $0.value) })
            }
            if let origin = origin { body["originLanguage"] = origin.code }
            return body
        }()
        let debug = options.debug
        queue.add(id: queueId, priority: 1) { [weak self] in
            guard let self = self else { return }
            let claimed: Bool = self.lock.withLock {
                if self.translating.contains(queueId) { return false }
                self.translating.insert(queueId)
                return true
            }
            if !claimed { return }
            defer { self.lock.withLock { _ = self.translating.remove(queueId) } }
            if let handler = config.handleTranslate {
                let result = await handler(key)
                if !result.message.isEmpty { self.log(result.message) }
                return
            }
            let request: (ApiClient, URL, [String: String])? = self.lock.withLock {
                guard let api = self.api, let url = URL(string: "\(self.apiUrl())/translate") else { return nil }
                return (api, url, self.headers())
            }
            guard let (api, url, headers) = request else { return }
            let result = await api.post(url, headers: headers, body: body)
            if debug { self.log("translate response: \(result.json ?? [:])") }
            if !result.ok && !result.error.isEmpty { self.log("Error translating key \"\(key)\": \(result.error)") }
            if !result.message.isEmpty { self.log(result.message) }
        }
    }

    private func onQueueEmpty() {
        lock.lock()
        guard config != nil else { lock.unlock(); return }
        let batch = namespacesToFetch
        namespacesToFetch.removeAll()
        let language = current
        lock.unlock()
        for (namespace, unpersisted) in batch {
            track { [self] in
                let cursor = self.lock.withLock { self.lastRefreshByNamespace[namespace] }
                let response = await self.fetchLanguage(language, namespace: namespace, lastRefresh: cursor)
                self.lock.withLock {
                    self.requestedMisses = self.requestedMisses.filter { !$0.hasPrefix("\(language.code)|\(namespace)|") }
                    self.setTranslations(response, namespace: namespace, unpersisted: unpersisted)
                }
            }
        }
    }

    // MARK: - Bulk fetch

    private struct FetchPlan {
        let api: ApiClient
        let debug: Bool
        let custom: GetAllTranslations?
        let etagKey: String
        let etag: String?
        let base: String
        var headers: [String: String]
    }

    private func fetchLanguage(_ lang: Lang, namespace: String, lastRefresh: String?) async -> TranslationsResponse? {
        let plan: FetchPlan? = lock.withLock {
            guard let config = self.config, let api = self.api else { return nil }
            let etagKey = Self.etagCacheKey(apiKey: config.apiKey, lang: lang.code, namespace: namespace)
            return FetchPlan(
                api: api, debug: config.debug, custom: config.getAllTranslations, etagKey: etagKey,
                etag: etags[etagKey], base: apiUrl(), headers: headers())
        }
        guard let plan = plan else { return nil }
        if let custom = plan.custom { return await custom() }
        let api = plan.api, debug = plan.debug, etagKey = plan.etagKey, etag = plan.etag, base = plan.base
        var requestHeaders = plan.headers
        // With an ETag in hand, freshness travels in If-None-Match and last_refresh leaves
        // the URL, which becomes stable so shared HTTP caches can hold it.
        guard let url = URL(string: Self.buildDictionaryUrl(
            apiUrl: base, lang: lang.code, lastRefresh: lastRefresh, namespace: namespace, etag: etag))
        else { return nil }
        if let etag = etag { requestHeaders["If-None-Match"] = etag }
        let result = await api.get(url, headers: requestHeaders)
        if result.notModified {
            if debug { log("fetch \(lang.code) [\(namespace)]: not modified") }
            return .notModified
        }
        guard result.ok, let json = result.json else {
            log("fetch all translations error: \(result.error)")
            return nil
        }
        let response = TranslationsResponse(json: json, etag: result.etag)
        if let etag = response.etag { lock.withLock { etags[etagKey] = etag } }
        if !response.message.isEmpty { log(response.message) }
        return response
    }

    /// Merges a dictionary answer (protocol section 7.3). Caller holds the lock.
    private func setTranslations(_ response: TranslationsResponse?, namespace: String, unpersisted: Bool) {
        guard let response = response, response.ok, !response.notModified else { return }
        let incoming = response.translations
        var changed = false
        for (key, value) in incoming where translations[key] != value { changed = true }
        translations.merge(incoming) { _, new in new }
        translationsByNamespace[namespace, default: [:]].merge(incoming) { _, new in new }
        let isNewNamespace = !namespaces.contains(namespace)
        if isNewNamespace { namespaces.append(namespace) }
        if unpersisted { unpersistedNamespaces.insert(namespace) }

        // Adopt the id the server echoed back only when this device has none: the header
        // we send is authoritative, and a new id is a new billed "user". A server never
        // adopts one.
        if uniqueId == nil, config?.server == false, UniqueId.isValid(response.uniqueId) {
            uniqueId = response.uniqueId
            write(StorageKeys.uniqueId, response.uniqueId!)
        }

        // An empty cursor is not a cursor (JavaScript truthiness).
        let cursor = (response.lastRefresh?.isEmpty ?? true) ? nil : response.lastRefresh
        if unpersisted {
            if let cursor = cursor {
                lastRefreshValue = cursor
                lastRefreshByNamespace[namespace] = cursor
            }
            if changed { notify() }
            return
        }
        writeJSON(StorageKeys.translationsKeyFor(namespace), translationsByNamespace[namespace] ?? [:])
        if isNewNamespace {
            writeJSON(StorageKeys.namespaces, namespaces.filter { !unpersistedNamespaces.contains($0) })
        }
        if let cursor = cursor {
            lastRefreshValue = cursor
            lastRefreshByNamespace[namespace] = cursor
            write(StorageKeys.lastRefreshKeyFor(namespace), cursor)
        }
        if changed { notify() }
    }

    // MARK: - Language

    /// Switches the language. An unsupported language falls back to `languages.fallback`.
    /// Listeners are notified at once (cached translations show immediately), and the call
    /// returns when the dictionary of the new language has been fetched.
    public func setLanguage(_ lang: Lang) async {
        let onSetLanguage = lock.withLock { config?.onSetLanguage }
        onSetLanguage?(lang)
        await applyLanguage(lang)
    }

    private func applyLanguage(_ lang: Lang) async {
        let plan: (validated: Lang, toFetch: [String], unpersisted: Set<String>)? = lock.withLock {
            guard let config = self.config else { return nil }
            let validated = supported.contains(lang) ? lang : fallback
            if config.debug && validated != lang { log("language \(lang.code) is not supported, fallback to \(validated.code)") }
            current = validated
            // Every delta cursor is stale after a language change: reset them all and refetch
            // the full set of each known namespace.
            let known = namespaces.isEmpty ? [i18nKeylessDefaultNamespace] : namespaces
            lastRefreshValue = nil
            lastRefreshByNamespace.removeAll()
            requestedMisses.removeAll()
            write(StorageKeys.currentLanguage, validated.code)
            for namespace in known where !unpersistedNamespaces.contains(namespace) {
                write(StorageKeys.lastRefreshKeyFor(namespace), "")
            }
            notify()
            if validated != primary { return (validated, known, unpersistedNamespaces) }
            // The primary language still needs fetched data for the namespaces holding UGC
            // keys: their primary version is an AI translation, not the key itself.
            if !originNamespaces.isEmpty { return (validated, originNamespaces, unpersistedNamespaces) }
            return nil
        }
        guard let (validated, toFetch, unpersisted) = plan else { return }
        await withTaskGroup(of: Void.self) { group in
            for namespace in toFetch {
                group.addTask { [self] in
                    let response = await self.fetchLanguage(validated, namespace: namespace, lastRefresh: nil)
                    self.lock.withLock {
                        self.setTranslations(response, namespace: namespace, unpersisted: unpersisted.contains(namespace))
                    }
                }
            }
        }
    }

    // MARK: - Usage analytics

    /// Caller holds the lock.
    private func recordUsage(_ storageKey: String, _ options: TranslationOptions) {
        // Transient namespaces do not report usage: they would flood the prune signal.
        if options.unpersistedNamespace { return }
        let namespace = namespaceOf(options)
        let today = Self.todayUTC()
        if usageByNamespace[namespace]?[storageKey] == today { return }
        usageByNamespace[namespace, default: [:]][storageKey] = today
        scheduleUsageWrite()
    }

    /// The storage write is deferred to the next hop, off the render path, and coalesced:
    /// a screen with a hundred strings writes once.
    private func scheduleUsageWrite() {
        if usageWriteScheduled { return }
        usageWriteScheduled = true
        track { [self] in
            self.lock.withLock {
                self.usageWriteScheduled = false
                self.writeJSON(StorageKeys.translationsUsage, self.usageByNamespace)
            }
        }
    }

    private func registerOriginNamespace(_ namespace: String, unpersisted: Bool) {
        if originNamespaces.contains(namespace) { return }
        originNamespaces.append(namespace)
        if !unpersisted {
            writeJSON(StorageKeys.originNamespaces, originNamespaces.filter { !unpersistedNamespaces.contains($0) })
        }
    }

    private func sendUsage() async {
        let plan: (config: Config, api: ApiClient, usage: [String: TranslationsUsage], base: String, headers: [String: String], primary: String)? = lock.withLock {
            guard let config = self.config, let api = self.api, !usageByNamespace.isEmpty else { return nil }
            return (config, api, usageByNamespace, apiUrl(), headers(), primary.code)
        }
        guard let (config, api, usage, base, requestHeaders, primaryCode) = plan else { return }
        let ok: Bool
        let message: String
        if let custom = config.sendTranslationsUsage {
            let response = await custom(usage[i18nKeylessDefaultNamespace] ?? [:])
            ok = response.ok
            message = response.message
        } else {
            guard let url = URL(string: "\(base)/translate/last-used-translations") else { return }
            let result = await api.post(url, headers: requestHeaders, body: [
                "primaryLanguage": primaryCode,
                "translationsUsageByNamespace": usage,
            ])
            ok = result.ok
            message = result.ok ? result.message : result.error
        }
        if !message.isEmpty { log(message) }
        if ok {
            lock.withLock {
                usageByNamespace.removeAll()
                write(StorageKeys.translationsUsage, "")
            }
        }
    }

    // MARK: - Housekeeping

    /// Resumes when no request, storage write or fetch is pending. For tests, and for a
    /// splash screen that wants the first dictionary before showing the app.
    public func waitForIdle() async {
        while true {
            await queue.whenIdle()
            let tasks = lock.withLock { Array(inFlight.values) }
            for task in tasks { await task.value }
            await Task.yield()
            let idle = queue.isIdle && lock.withLock { inFlight.isEmpty && !usageWriteScheduled }
            if idle { return }
        }
    }

    /// Removes every cached translation, cursor and usage record from storage and from
    /// memory. The device id and the config are kept: the id identifies the install, and
    /// wiping it would bill one more "user" at the next launch.
    public func clearStorage() async {
        lock.withLock { clearState() }
        await waitForIdle()
    }

    /// Caller holds the lock.
    private func clearState() {
        for namespace in namespaces {
            remove(StorageKeys.translationsKeyFor(namespace))
            remove(StorageKeys.lastRefreshKeyFor(namespace))
        }
        for key in StorageKeys.all where key != StorageKeys.uniqueId { remove(key) }
        translations.removeAll()
        translationsByNamespace.removeAll()
        namespaces.removeAll()
        unpersistedNamespaces.removeAll()
        lastRefreshByNamespace.removeAll()
        lastRefreshValue = nil
        usageByNamespace.removeAll()
        originNamespaces.removeAll()
        requestedMisses.removeAll()
        etags.removeAll()
        notify()
    }

    /// Caller holds the lock.
    private func apiUrl() -> String {
        guard let url = config?.apiURL, !url.isEmpty else { return i18nKeylessDefaultApiUrl }
        return url.hasSuffix("/") ? String(url.dropLast()) : url
    }

    /// The exact header set of the protocol (section 3.2). Caller holds the lock.
    private func headers() -> [String: String] {
        var headers = [
            "Content-Type": "application/json",
            "Authorization": "Bearer \(config?.apiKey ?? "")",
            "Version": I18nKeylessVersion.string,
            "sdk": config?.server == true ? I18nKeylessRuntime.server : I18nKeylessRuntime.client,
        ]
        if config?.server != true {
            // Never empty: an empty header means "one shared anonymous user" to the API.
            if uniqueId == nil { uniqueId = UniqueId.generate() }
            headers["unique_id"] = uniqueId
        }
        return headers
    }

    /// Runs `operation` in a task the instance keeps until it settles, so `waitForIdle`
    /// can await it.
    private func track(_ operation: @escaping @Sendable () async -> Void) {
        let id = UUID()
        lock.lock()
        inFlight[id] = Task { [weak self] in
            await operation()
            self?.lock.withLock { _ = self?.inFlight.removeValue(forKey: id) }
        }
        lock.unlock()
    }

    /// Caller holds the lock.
    private func notify() {
        revisionValue += 1
        let toCall = listeners.map(\.1)
        for listener in toCall { listener() }
        #if canImport(Combine)
        Task { @MainActor in self.objectWillChange.send() }
        #endif
    }

    private func log(_ message: String) {
        let logger = lock.withLock { config?.logger }
        if let logger = logger { logger("i18n-keyless: \(message)") } else { print("i18n-keyless: \(message)") }
    }
}

#if canImport(Combine)
extension I18nKeyless: ObservableObject {}
#endif

extension NSRecursiveLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock(); defer { unlock() }
        return try body()
    }
}

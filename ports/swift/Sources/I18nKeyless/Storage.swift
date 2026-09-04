import Foundation

/// Where i18n-keyless persists its cache: translations per namespace, delta cursors, the
/// current language, usage analytics and the device id. Values are always strings.
///
/// Methods are synchronous: `UserDefaults`, a file, Keychain, a database, anything fits.
/// A failing read is logged and yields nil; a failing write or delete is logged.
public protocol I18nKeylessStorage: AnyObject {
    func getItem(_ key: String) throws -> String?
    func setItem(_ key: String, _ value: String) throws
    func removeItem(_ key: String) throws
}

/// An in-memory storage backed by a dictionary. The default on a server (`server: true`),
/// and the storage of a test: nothing survives the process.
public final class MemoryStorage: I18nKeylessStorage, @unchecked Sendable {
    private var map: [String: String] = [:]
    private let lock = NSLock()

    public init() {}

    /// A snapshot, for tests and debugging.
    public var entries: [String: String] {
        lock.lock(); defer { lock.unlock() }
        return map
    }

    public func getItem(_ key: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return map[key]
    }

    public func setItem(_ key: String, _ value: String) {
        lock.lock(); defer { lock.unlock() }
        map[key] = value
    }

    public func removeItem(_ key: String) {
        lock.lock(); defer { lock.unlock() }
        map.removeValue(forKey: key)
    }

    public func clear() {
        lock.lock(); defer { lock.unlock() }
        map.removeAll()
    }
}

/// The default storage of an app: `UserDefaults.standard`, or the suite you pass (an App
/// Group suite shares the cache and the device id with an extension or a widget).
public final class UserDefaultsStorage: I18nKeylessStorage, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(_ defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func getItem(_ key: String) -> String? { defaults.string(forKey: key) }

    public func setItem(_ key: String, _ value: String) { defaults.set(value, forKey: key) }

    public func removeItem(_ key: String) { defaults.removeObject(forKey: key) }
}

/// The namespace used when none is provided. It reuses the legacy storage keys, so the key
/// names are identical to the JavaScript SDKs.
public let i18nKeylessDefaultNamespace = "default"

/// The storage keys, identical to `i18n-keyless-react` (docs/PROTOCOL.md, section 11).
public enum StorageKeys {
    public static let uniqueId = "i18n-keyless-user-id"
    public static let lastRefresh = "i18n-keyless-last-refresh"
    public static let translations = "i18n-keyless-translations"
    public static let currentLanguage = "i18n-keyless-current-language"
    /// Usage keyed by namespace: `{ "<namespace>": { "key__context": "YYYY-MM-DD" } }`.
    public static let translationsUsage = "i18n-keyless-translations-usage"
    /// JSON array of the namespaces persisted, so hydration knows what to load.
    public static let namespaces = "i18n-keyless-namespaces"
    /// JSON array of the namespaces that hold origin-language (UGC) keys.
    public static let originNamespaces = "i18n-keyless-origin-namespaces"

    public static let all: [String] = [
        uniqueId, lastRefresh, translations, currentLanguage, translationsUsage, namespaces,
        originNamespaces,
    ]

    /// The key holding the translations of one namespace. The default namespace reuses the
    /// legacy key; another namespace gets a `__<namespace>` suffix, not encoded.
    public static func translationsKeyFor(_ namespace: String) -> String {
        namespace == i18nKeylessDefaultNamespace ? translations : "\(translations)__\(namespace)"
    }

    /// The key holding the delta cursor of one namespace.
    public static func lastRefreshKeyFor(_ namespace: String) -> String {
        namespace == i18nKeylessDefaultNamespace ? lastRefresh : "\(lastRefresh)__\(namespace)"
    }
}

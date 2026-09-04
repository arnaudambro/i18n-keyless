import Foundation

/// The translations of a language: `["un texte": "a text"]`. A key with a context is
/// stored as `"key__context"`.
public typealias Translations = [String: String]

/// Usage per key: `["un texte": "2025-06-23"]` (date of last use, `YYYY-MM-DD`, UTC).
public typealias TranslationsUsage = [String: String]

/// A custom `POST /translate` replacement: called with the source text on a miss.
public typealias HandleTranslate = @Sendable (String) async -> HandleTranslateResult

/// A custom `GET /translate/:lang` replacement: returns the whole dictionary of the
/// current language. It receives no argument: the handler knows the language itself.
public typealias GetAllTranslations = @Sendable () async -> TranslationsResponse

/// A custom `POST /translate/last-used-translations` replacement. It receives the
/// default-namespace usage bucket, like the JavaScript SDKs hand their custom handler.
public typealias SendTranslationsUsage = @Sendable (TranslationsUsage) async -> UsageResponse

/// A log sink. Defaults to `print`.
public typealias I18nKeylessLogger = @Sendable (String) -> Void

/// What a `HandleTranslate` handler returns.
public struct HandleTranslateResult: Sendable {
    public var ok: Bool
    public var message: String
    /// The translation of the key per language code, when the handler has it.
    public var translation: [String: String]

    public init(ok: Bool, message: String = "", translation: [String: String] = [:]) {
        self.ok = ok
        self.message = message
        self.translation = translation
    }
}

/// The answer of `POST /translate/last-used-translations`.
public struct UsageResponse: Sendable {
    public var ok: Bool
    public var message: String

    public init(ok: Bool, message: String = "") {
        self.ok = ok
        self.message = message
    }
}

/// The answer of `GET /translate/:lang`: `{ ok, data: { translations, uniqueId,
/// lastRefresh }, error, message }`, plus the `ETag` header when the API sent one.
public struct TranslationsResponse: Sendable {
    public var ok: Bool
    public var translations: Translations
    public var uniqueId: String?
    public var lastRefresh: String?
    public var error: String
    public var message: String
    /// ETag of this payload, replayed as `If-None-Match` on the next fetch.
    public var etag: String?
    /// True when the API answered `304 Not Modified`: keep the stored dictionary.
    public var notModified: Bool

    public init(
        ok: Bool, translations: Translations = [:], uniqueId: String? = nil,
        lastRefresh: String? = nil, error: String = "", message: String = "",
        etag: String? = nil, notModified: Bool = false
    ) {
        self.ok = ok
        self.translations = translations
        self.uniqueId = uniqueId
        self.lastRefresh = lastRefresh
        self.error = error
        self.message = message
        self.etag = etag
        self.notModified = notModified
    }

    /// The `304 Not Modified` answer.
    public static let notModified = TranslationsResponse(ok: true, notModified: true)

    /// Parses the JSON body of a `200`. Values that are not strings are dropped.
    public init(json: [String: Any], etag: String? = nil) {
        let data = json["data"] as? [String: Any]
        var translations: Translations = [:]
        if let raw = data?["translations"] as? [String: Any] {
            for (key, value) in raw {
                if let value = value as? String { translations[key] = value }
            }
        }
        self.init(
            ok: json["ok"] as? Bool == true,
            translations: translations,
            uniqueId: data?["uniqueId"] as? String,
            lastRefresh: (data?["lastRefresh"]).flatMap(stringValue),
            error: json["error"] as? String ?? "",
            message: json["message"] as? String ?? "",
            etag: etag)
    }
}

/// `lastRefresh` is an opaque string on the wire, but a self-hosted backend may write a
/// number: keep its decimal text, like `toString()` would.
func stringValue(_ value: Any) -> String? {
    switch value {
    case let string as String: return string
    case is NSNull: return nil
    case let number as NSNumber: return number.stringValue
    default: return nil
    }
}

/// The languages of the project.
public struct LanguagesConfig: Sendable {
    /// The language the source strings are written in.
    public var primary: Lang
    /// The languages the user can switch to. `primary` and `initWithDefault` are added
    /// when missing.
    public var supported: [Lang]
    /// Used when `setLanguage` receives an unsupported language. Defaults to `primary`.
    public var fallback: Lang?
    /// The language of the first launch, before any stored choice. Defaults to `primary`.
    public var initWithDefault: Lang?
    /// When true, the stored language is ignored at boot and `initWithDefault` is used.
    /// Useful when the language comes from somewhere else (a deep link, an account).
    public var skipCurrentLanguageHydration: Bool

    public init(
        primary: Lang, supported: [Lang], fallback: Lang? = nil, initWithDefault: Lang? = nil,
        skipCurrentLanguageHydration: Bool = false
    ) {
        self.primary = primary
        self.supported = supported
        self.fallback = fallback
        self.initWithDefault = initWithDefault
        self.skipCurrentLanguageHydration = skipCurrentLanguageHydration
    }
}

/// The options of one translation call. Every field is also a parameter of `t(...)` and
/// of `I18nKeylessText`.
public struct TranslationOptions: Sendable {
    /// Disambiguates meaning: "8 heures" as a clock time vs a duration. Stored as
    /// `"key__context"`.
    public var context: String?
    /// A fetch/storage partition, not a semantic key. Defaults to the config's
    /// `defaultNamespace`, then `"default"`.
    public var namespace: String?
    /// When true, this namespace lives in memory only: never persisted, never reloaded.
    public var unpersistedNamespace: Bool
    /// Logs the resolution of this one string.
    public var debug: Bool
    /// Your own translation per language, when the AI one is not satisfactory.
    public var forceTemporary: [Lang: String]?
    /// Placeholders to replace in the translated text. The keys include the delimiters:
    /// `["{name}": user.name]`. Regex-special characters in keys are literal. The order of
    /// the pairs is the order placeholders compete in at one position (first wins).
    public var replace: KeyValuePairs<String, String>?
    /// For user generated content: the language this text is written in when it is not
    /// the primary one.
    public var originLanguage: Lang?

    public init(
        context: String? = nil, namespace: String? = nil, unpersistedNamespace: Bool = false,
        debug: Bool = false, forceTemporary: [Lang: String]? = nil,
        replace: KeyValuePairs<String, String>? = nil, originLanguage: Lang? = nil
    ) {
        self.context = context
        self.namespace = namespace
        self.unpersistedNamespace = unpersistedNamespace
        self.debug = debug
        self.forceTemporary = forceTemporary
        self.replace = replace
        self.originLanguage = originLanguage
    }
}

/// Everything `configure` needs.
public struct I18nKeylessConfig {
    /// The API key from https://i18n-keyless.com. Always required, even with custom
    /// handlers or a self-hosted `apiURL` (protocol section 2.1).
    public var apiKey: String
    /// A self-hosted backend. Defaults to `https://api.i18n-keyless.com`. No trailing slash.
    public var apiURL: String?
    public var languages: LanguagesConfig
    /// The namespace applied to every call that has none. Defaults to `"default"`.
    public var defaultNamespace: String?
    /// Where the cache lives. Defaults to `UserDefaultsStorage()` in an app and to
    /// `MemoryStorage()` on a server.
    public var storage: I18nKeylessStorage?
    /// A server-side Swift process (Vapor, a CLI): the runtime becomes `swift-server`,
    /// no device id is generated or sent, and usage analytics are neither recorded nor
    /// sent (the `ssr: true` of the JavaScript SDKs). Translate-on-miss still works.
    public var server: Bool
    /// Logs every step.
    public var debug: Bool
    /// Custom handlers. When set, they replace the HTTP calls.
    public var handleTranslate: HandleTranslate?
    public var getAllTranslations: GetAllTranslations?
    public var sendTranslationsUsage: SendTranslationsUsage?
    /// Called once hydration is done, with the language the app starts in.
    public var onInit: (@Sendable (Lang) -> Void)?
    /// Called on every `setLanguage`, before the switch.
    public var onSetLanguage: (@Sendable (Lang) -> Void)?
    /// The session configuration of the HTTP transport. Register a `URLProtocol` stub in
    /// tests. Ignored when the client was created with an injected `ApiClient`.
    public var urlSessionConfiguration: URLSessionConfiguration?
    /// Where logs go. Defaults to `print`.
    public var logger: I18nKeylessLogger?

    public init(
        apiKey: String, languages: LanguagesConfig, apiURL: String? = nil,
        defaultNamespace: String? = nil, storage: I18nKeylessStorage? = nil,
        server: Bool = false, debug: Bool = false, handleTranslate: HandleTranslate? = nil,
        getAllTranslations: GetAllTranslations? = nil,
        sendTranslationsUsage: SendTranslationsUsage? = nil,
        onInit: (@Sendable (Lang) -> Void)? = nil, onSetLanguage: (@Sendable (Lang) -> Void)? = nil,
        urlSessionConfiguration: URLSessionConfiguration? = nil, logger: I18nKeylessLogger? = nil
    ) {
        self.apiKey = apiKey
        self.languages = languages
        self.apiURL = apiURL
        self.defaultNamespace = defaultNamespace
        self.storage = storage
        self.server = server
        self.debug = debug
        self.handleTranslate = handleTranslate
        self.getAllTranslations = getAllTranslations
        self.sendTranslationsUsage = sendTranslationsUsage
        self.onInit = onInit
        self.onSetLanguage = onSetLanguage
        self.urlSessionConfiguration = urlSessionConfiguration
        self.logger = logger
    }
}

/// What `configure` refuses.
public enum I18nKeylessError: Error, Equatable, CustomStringConvertible {
    case apiKeyRequired
    case supportedLanguagesEmpty

    public var description: String {
        switch self {
        case .apiKeyRequired:
            return "i18n-keyless: apiKey is required. Get a key at https://i18n-keyless.com"
        case .supportedLanguagesEmpty:
            return "i18n-keyless: languages.supported must not be empty"
        }
    }
}

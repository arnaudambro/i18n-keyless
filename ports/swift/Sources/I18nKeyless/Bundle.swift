import Foundation

/// The precompiled bundle (docs/PROTOCOL.md, sections 4.5 and 7.4): dictionaries exported
/// at build time (`GET /translate/bundle`, or the MCP `export_bundle` tool) and shipped
/// with the app, one file per (namespace, language) plus `manifest.json`. At boot and on a
/// language switch a covered dictionary is seeded from the file instead of fetched, with
/// the bundle's cursor, so the only network traffic left is a miss.
///
/// The pure functions (`bundleCovers`, `mergeBundleWithStorage`) are replayed by
/// `conformance/vectors/bundle-seed.json`.

/// One namespace of the manifest: its cursor and the languages that have a file.
public struct BundleNamespace: Sendable, Equatable {
    /// The export time, epoch ms as a string: the delta cursor seeded with the file.
    public var lastRefresh: String
    /// The language codes that have a `<namespace>/<lang>.json` file.
    public var languages: [String]

    public init(lastRefresh: String, languages: [String]) {
        self.lastRefresh = lastRefresh
        self.languages = languages
    }

    public init(json: [String: Any]) {
        self.init(
            lastRefresh: json["lastRefresh"].flatMap(stringValue) ?? "",
            languages: (json["languages"] as? [Any])?.map { "\($0)" } ?? [])
    }
}

/// `manifest.json`: the bundle without its dictionaries.
///
/// ```json
/// { "primaryLanguage": "fr", "languages": ["en", "fr"], "exportedAt": "1757000000000",
///   "namespaces": { "default": { "lastRefresh": "1757000000000", "languages": ["en", "fr"] } } }
/// ```
public struct BundleManifest: Sendable, Equatable {
    public var primaryLanguage: String
    public var languages: [String]
    public var exportedAt: String
    /// Per namespace. `namespaceOrder` keeps the manifest order, which a dictionary loses.
    public var namespaces: [String: BundleNamespace]
    public var namespaceOrder: [String]

    public init(primaryLanguage: String, languages: [String], exportedAt: String, namespaces: [String: BundleNamespace], namespaceOrder: [String]? = nil) {
        self.primaryLanguage = primaryLanguage
        self.languages = languages
        self.exportedAt = exportedAt
        self.namespaces = namespaces
        self.namespaceOrder = namespaceOrder ?? namespaces.keys.sorted()
    }

    /// Parses the object of `manifest.json`. Values that do not fit are dropped.
    public init(json: [String: Any]) {
        var namespaces: [String: BundleNamespace] = [:]
        if let raw = json["namespaces"] as? [String: Any] {
            for (name, value) in raw {
                if let entry = value as? [String: Any] { namespaces[name] = BundleNamespace(json: entry) }
            }
        }
        self.init(
            primaryLanguage: json["primaryLanguage"] as? String ?? "",
            languages: (json["languages"] as? [Any])?.map { "\($0)" } ?? [],
            exportedAt: json["exportedAt"].flatMap(stringValue) ?? "",
            namespaces: namespaces,
            // `default` first, the rest in alphabetical order: the export's own order.
            namespaceOrder: namespaces.keys.sorted { a, b in
                if a == i18nKeylessDefaultNamespace { return true }
                if b == i18nKeylessDefaultNamespace { return false }
                return a < b
            })
    }

    /// Parses the bytes of `manifest.json`.
    public init(data: Data) throws {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw I18nKeylessBundleError.invalidManifest
        }
        self.init(json: json)
    }
}

public enum I18nKeylessBundleError: Error, Equatable {
    case invalidManifest
    case invalidDictionary(namespace: String, lang: String)
}

/// Reads one file of the bundle: the dictionary of `<namespace>/<lang>.json`, or nil when
/// the app has no such file. Called only for a pair the manifest covers, off the caller's
/// thread. A thrown error is logged and the pair is fetched instead.
public typealias BundleLoad = @Sendable (_ namespace: String, _ lang: Lang) async throws -> Translations?

/// The bundle handed to `I18nKeylessConfig.bundle`: the parsed manifest and a loader.
///
/// The files are app resources, so the SDK takes a loader, not a path. `files(in:)` builds
/// one over a directory of the main bundle:
///
/// ```swift
/// let directory = Bundle.main.resourceURL!.appendingPathComponent("i18n-keyless")
/// let bundle = try I18nKeylessBundle.files(in: directory)
/// try I18nKeyless.configure(.init(apiKey: "...", languages: ..., bundle: bundle))
/// ```
public struct I18nKeylessBundle: Sendable {
    public var manifest: BundleManifest
    public var load: BundleLoad

    public init(manifest: BundleManifest, load: @escaping BundleLoad) {
        self.manifest = manifest
        self.load = load
    }

    /// A bundle over the files of `directory`: `manifest.json` (read now) and one
    /// `<namespace>/<lang>.json` per dictionary (read when seeded). Throws when the manifest
    /// is missing or malformed.
    public static func files(in directory: URL) throws -> I18nKeylessBundle {
        let manifest = try BundleManifest(data: Data(contentsOf: directory.appendingPathComponent("manifest.json")))
        return I18nKeylessBundle(manifest: manifest) { namespace, lang in
            let url = directory.appendingPathComponent(namespace).appendingPathComponent("\(lang.code).json")
            let data = try Data(contentsOf: url)
            guard let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw I18nKeylessBundleError.invalidDictionary(namespace: namespace, lang: lang.code)
            }
            var dictionary: Translations = [:]
            for (key, value) in raw { if let value = value as? String { dictionary[key] = value } }
            return dictionary
        }
    }
}

/// The seed of one namespace: a dictionary and the cursor that goes with it.
public struct BundleSeed: Sendable, Equatable {
    public var translations: Translations
    public var lastRefresh: String?

    public init(translations: Translations, lastRefresh: String?) {
        self.translations = translations
        self.lastRefresh = lastRefresh
    }
}

/// What storage holds for one namespace: its slice, its cursor, and the language it is in.
public struct StoredSeed: Sendable, Equatable {
    public var translations: Translations
    public var lastRefresh: String?
    public var lang: String

    public init(translations: Translations, lastRefresh: String?, lang: String) {
        self.translations = translations
        self.lastRefresh = lastRefresh
        self.lang = lang
    }
}

extension I18nKeyless {
    /// True when the manifest lists `lang` under `namespace`.
    public static func bundleCovers(_ manifest: BundleManifest?, namespace: String, lang: String) -> Bool {
        guard let entry = manifest?.namespaces[namespace] else { return false }
        return entry.languages.contains(lang)
    }

    /// The namespaces the manifest lists, in manifest order.
    public static func bundleNamespaces(_ manifest: BundleManifest?) -> [String] {
        manifest?.namespaceOrder ?? []
    }

    /// The precedence between the bundle and what storage holds for the same namespace.
    ///
    /// The bundle is the base. Storage wins only when it is strictly newer (its cursor is a
    /// larger number than the bundle's) AND it is in the language being seeded: a device
    /// that fetched after a human review keeps the reviewed text, and a slice left by
    /// another language is never mixed in. A storage cursor that is empty or not a number
    /// is never newer.
    public static func mergeBundleWithStorage(_ bundle: BundleSeed, stored: StoredSeed?, lang: String) -> BundleSeed {
        guard let stored = stored, stored.lang == lang else { return bundle }
        guard let storedRaw = stored.lastRefresh, !storedRaw.isEmpty,
              let storedCursor = Double(storedRaw), storedCursor.isFinite,
              let bundleCursor = Double(bundle.lastRefresh ?? ""), storedCursor > bundleCursor
        else { return bundle }
        return BundleSeed(
            translations: bundle.translations.merging(stored.translations) { _, new in new },
            lastRefresh: storedRaw)
    }

    /// Loads one covered dictionary from the bundle. Nil when the manifest does not cover
    /// the pair, when the loader yields nothing, or when it throws (a missing file at
    /// runtime is a miss like any other: the caller falls back to the fetch).
    static func loadBundleSeed(_ bundle: I18nKeylessBundle?, namespace: String, lang: Lang, log: (String) -> Void) async -> BundleSeed? {
        guard let bundle = bundle, bundleCovers(bundle.manifest, namespace: namespace, lang: lang.code) else { return nil }
        do {
            guard let translations = try await bundle.load(namespace, lang) else { return nil }
            return BundleSeed(translations: translations, lastRefresh: bundle.manifest.namespaces[namespace]?.lastRefresh)
        } catch {
            log("bundle.load failed for \(namespace) \(lang.code): \(error)")
            return nil
        }
    }
}

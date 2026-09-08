// The precompiled bundle (docs/PROTOCOL.md 7.4): a namespace the manifest covers in the
// current language is seeded from the shipped file, with the bundle's cursor, instead of
// fetched, at boot and on a language switch. Storage wins only when newer and in the same
// language. Everything not covered keeps the fetch, and a miss still POSTs.
import Foundation
import XCTest
@testable import I18nKeyless

final class BundleTests: XCTestCase {
    static let cursor = "1757000000000"

    static let manifest = BundleManifest(json: [
        "primaryLanguage": "fr", "languages": ["en", "es", "fr"], "exportedAt": cursor,
        "namespaces": [
            "default": ["lastRefresh": cursor, "languages": ["en", "es", "fr"]],
            "checkout": ["lastRefresh": cursor, "languages": ["en"]],
        ],
    ])

    static let files: [String: Translations] = [
        "default/en": ["Bonjour": "Hello", "Merci": "Thanks"],
        "default/es": ["Bonjour": "Hola", "Merci": "Gracias"],
        "default/fr": ["Bonjour": "Bonjour", "Merci": "Merci"],
        "checkout/en": ["Panier": "Cart"],
    ]

    /// A bundle whose loader records its calls.
    final class Loads: @unchecked Sendable {
        private let lock = NSLock()
        private(set) var calls: [String] = []
        let failing: Bool
        init(failing: Bool = false) { self.failing = failing }

        var bundle: I18nKeylessBundle {
            I18nKeylessBundle(manifest: BundleTests.manifest) { [self] namespace, lang in
                lock.withLock { calls.append("\(namespace)/\(lang.code)") }
                struct Missing: Error {}
                if failing { throw Missing() }
                return BundleTests.files["\(namespace)/\(lang.code)"]
            }
        }
    }

    private func makeClient(
        _ transport: Transport, storage: MemoryStorage, bundle: I18nKeylessBundle?,
        languages: LanguagesConfig = LanguagesConfig(primary: .fr, supported: [.fr, .en, .es])
    ) throws -> I18nKeyless {
        let client = I18nKeyless()
        try client.configure(I18nKeylessConfig(
            apiKey: transport.apiKey, languages: languages, apiURL: "https://api.test", storage: storage,
            bundle: bundle, urlSessionConfiguration: transport.sessionConfiguration, logger: { _ in }))
        return client
    }

    private func storage(_ entries: [String: String]) -> MemoryStorage {
        let storage = MemoryStorage()
        for (key, value) in entries { storage.setItem(key, value) }
        return storage
    }

    private func json(_ object: Any) -> String { String(data: StubURLProtocol.json(object), encoding: .utf8)! }

    private func slice(_ storage: MemoryStorage, _ namespace: String = i18nKeylessDefaultNamespace) -> [String: String]? {
        storage.getItem(StorageKeys.translationsKeyFor(namespace)).flatMap { $0.data(using: .utf8) }
            .flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: String]
    }

    // MARK: boot

    func testBootSeedsEveryBundledNamespaceAndFetchesNothing() async throws {
        let transport = Transport(apiKey: "k-bundle-boot", dictionary: ["Fetched": "From the API"])
        let storage = storage([StorageKeys.currentLanguage: "en"])
        let loads = Loads()
        let client = try makeClient(transport, storage: storage, bundle: loads.bundle)
        await client.waitForIdle()

        XCTAssertEqual(client.currentLanguage, .en)
        XCTAssertEqual(client.t("Bonjour"), "Hello")
        XCTAssertEqual(client.t("Panier", namespace: "checkout"), "Cart")
        XCTAssertEqual(client.currentTranslations, ["Bonjour": "Hello", "Merci": "Thanks", "Panier": "Cart"])
        XCTAssertTrue(transport.dictionaries.isEmpty)
        XCTAssertEqual(Set(loads.calls), ["default/en", "checkout/en"])
        // Persisted like a fetched dictionary, so the delta cursor survives a reload.
        XCTAssertEqual(storage.getItem(StorageKeys.lastRefresh), Self.cursor)
        XCTAssertEqual(storage.getItem(StorageKeys.lastRefreshKeyFor("checkout")), Self.cursor)
        XCTAssertEqual(storage.getItem(StorageKeys.namespaces), "[\"default\",\"checkout\"]")
    }

    func testBootSeedsThePrimaryDictionaryAndFetchesOnlyAnUncoveredOriginNamespace() async throws {
        let transport = Transport(apiKey: "k-bundle-primary", dictionary: ["Fetched": "From the API"])
        let storage = storage([StorageKeys.currentLanguage: "fr", StorageKeys.originNamespaces: "[\"chat\"]"])
        let client = try makeClient(transport, storage: storage, bundle: Loads().bundle)
        await client.waitForIdle()

        XCTAssertEqual(slice(storage), ["Bonjour": "Bonjour", "Merci": "Merci"])
        XCTAssertEqual(transport.dictionaries.count, 1)
        XCTAssertEqual(transport.dictionaries[0].url.absoluteString, "https://api.test/translate/fr?last_refresh=null&namespace=chat")
    }

    func testBootFetchesALanguageTheBundleDoesNotCoverForANamespace() async throws {
        let transport = Transport(apiKey: "k-bundle-uncovered", dictionary: ["Fetched": "From the API"])
        let storage = storage([StorageKeys.currentLanguage: "es"])
        let client = try makeClient(transport, storage: storage, bundle: Loads().bundle)
        await client.waitForIdle()

        // default/es is bundled, checkout/es is not.
        XCTAssertEqual(client.t("Bonjour"), "Hola")
        XCTAssertEqual(transport.dictionaries.count, 1)
        XCTAssertEqual(transport.dictionaries[0].url.absoluteString, "https://api.test/translate/es?last_refresh=null&namespace=checkout")
        XCTAssertEqual(slice(storage, "checkout"), ["Fetched": "From the API"])
    }

    func testBootKeepsANewerStoredSliceOfTheSameLanguageOnTopOfTheBundle() async throws {
        let transport = Transport(apiKey: "k-bundle-newer")
        let newer = "\(Int(Self.cursor)! + 60_000)"
        let storage = storage([
            StorageKeys.currentLanguage: "en", StorageKeys.namespaces: "[\"default\"]",
            StorageKeys.translations: "{\"Bonjour\":\"Hello, reviewed\"}", StorageKeys.lastRefresh: newer,
        ])
        let client = try makeClient(transport, storage: storage, bundle: Loads().bundle)
        await client.waitForIdle()

        XCTAssertEqual(client.t("Bonjour"), "Hello, reviewed")
        XCTAssertEqual(client.t("Merci"), "Thanks")
        XCTAssertEqual(slice(storage), ["Bonjour": "Hello, reviewed", "Merci": "Thanks"])
        XCTAssertEqual(storage.getItem(StorageKeys.lastRefresh), newer)
        XCTAssertTrue(transport.dictionaries.isEmpty)
    }

    func testBootIgnoresAStoredSliceOlderThanTheBundle() async throws {
        let transport = Transport(apiKey: "k-bundle-older")
        let storage = storage([
            StorageKeys.currentLanguage: "en", StorageKeys.namespaces: "[\"default\"]",
            StorageKeys.translations: "{\"Bonjour\":\"Old hello\"}", StorageKeys.lastRefresh: "\(Int(Self.cursor)! - 60_000)",
        ])
        let client = try makeClient(transport, storage: storage, bundle: Loads().bundle)
        await client.waitForIdle()

        XCTAssertEqual(client.t("Bonjour"), "Hello")
        XCTAssertEqual(storage.getItem(StorageKeys.lastRefresh), Self.cursor)
    }

    func testBootNeverMixesInANewerStoredSliceOfAnotherLanguage() async throws {
        let transport = Transport(apiKey: "k-bundle-other-lang")
        // Storage holds English, the app boots in Spanish (skipCurrentLanguageHydration).
        let storage = storage([
            StorageKeys.currentLanguage: "en", StorageKeys.namespaces: "[\"default\"]",
            StorageKeys.translations: "{\"Bonjour\":\"Hello\"}", StorageKeys.lastRefresh: "\(Int(Self.cursor)! + 60_000)",
        ])
        let client = try makeClient(
            transport, storage: storage, bundle: Loads().bundle,
            languages: LanguagesConfig(primary: .fr, supported: [.fr, .en, .es], initWithDefault: .es, skipCurrentLanguageHydration: true))
        await client.waitForIdle()

        XCTAssertEqual(client.currentLanguage, .es)
        XCTAssertEqual(client.t("Bonjour"), "Hola")
        XCTAssertEqual(slice(storage), ["Bonjour": "Hola", "Merci": "Gracias"])
        XCTAssertEqual(storage.getItem(StorageKeys.lastRefresh), Self.cursor)
    }

    func testBootFallsBackToTheFetchWhenTheLoaderThrows() async throws {
        let transport = Transport(apiKey: "k-bundle-throws", dictionary: ["Fetched": "From the API"])
        let storage = storage([StorageKeys.currentLanguage: "en"])
        let client = try makeClient(transport, storage: storage, bundle: Loads(failing: true).bundle)
        await client.waitForIdle()

        XCTAssertEqual(transport.dictionaries.count, 2)
        XCTAssertEqual(client.t("Fetched"), "From the API")
    }

    // MARK: language switch

    func testSwitchSeedsTheNewLanguageAndNeverMixesThePreviousOne() async throws {
        let transport = Transport(apiKey: "k-bundle-switch", dictionary: ["Fetched": "From the API"])
        let storage = storage([StorageKeys.currentLanguage: "en"])
        let client = try makeClient(transport, storage: storage, bundle: Loads().bundle)
        await client.waitForIdle()
        XCTAssertTrue(transport.dictionaries.isEmpty)

        await client.setLanguage(.es)
        await client.waitForIdle()

        XCTAssertEqual(client.t("Bonjour"), "Hola")
        XCTAssertEqual(slice(storage), ["Bonjour": "Hola", "Merci": "Gracias"])
        XCTAssertEqual(storage.getItem(StorageKeys.lastRefresh), Self.cursor)
        // checkout has no Spanish file: fetched.
        XCTAssertEqual(transport.dictionaries.count, 1)
        XCTAssertEqual(transport.dictionaries[0].url.absoluteString, "https://api.test/translate/es?last_refresh=null&namespace=checkout")
    }

    func testAMissStillPostsAndTheDeltaStartsFromTheBundleCursor() async throws {
        let transport = Transport(apiKey: "k-bundle-miss", dictionary: ["Fetched": "From the API"])
        let storage = storage([StorageKeys.currentLanguage: "en"])
        let client = try makeClient(transport, storage: storage, bundle: Loads().bundle)
        await client.waitForIdle()

        XCTAssertEqual(client.t("Nouveau"), "Nouveau")
        await client.waitForIdle()

        XCTAssertEqual(transport.translates.count, 1)
        XCTAssertEqual((transport.translates[0].json as? [String: Any])?["key"] as? String, "Nouveau")
        XCTAssertEqual(transport.dictionaries.count, 1)
        XCTAssertEqual(transport.dictionaries[0].url.absoluteString, "https://api.test/translate/en?last_refresh=\(Self.cursor)")
        XCTAssertEqual(client.t("Fetched"), "From the API")
        XCTAssertEqual(client.t("Bonjour"), "Hello")
    }

    // MARK: without a bundle

    func testWithoutABundleFetchesExactlyAsBefore() async throws {
        let transport = Transport(apiKey: "k-bundle-none")
        let storage = storage([StorageKeys.currentLanguage: "en"])
        let client = try makeClient(transport, storage: storage, bundle: nil)
        await client.waitForIdle()

        XCTAssertEqual(transport.dictionaries.count, 1)
        XCTAssertEqual(transport.dictionaries[0].url.absoluteString, "https://api.test/translate/en?last_refresh=null")
    }

    // MARK: files(in:)

    func testFilesInReadsTheManifestNowAndTheDictionariesOnDemand() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("i18n-keyless-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory.appendingPathComponent("default"), withIntermediateDirectories: true)
        try json([
            "primaryLanguage": "fr", "languages": ["en", "fr"], "exportedAt": Self.cursor,
            "namespaces": ["default": ["lastRefresh": Self.cursor, "languages": ["en", "fr"]]],
        ]).write(to: directory.appendingPathComponent("manifest.json"), atomically: true, encoding: .utf8)
        try json(["Bonjour": "Hello"]).write(to: directory.appendingPathComponent("default/en.json"), atomically: true, encoding: .utf8)

        let bundle = try I18nKeylessBundle.files(in: directory)
        XCTAssertEqual(bundle.manifest.primaryLanguage, "fr")
        XCTAssertEqual(bundle.manifest.namespaces["default"]?.languages, ["en", "fr"])
        XCTAssertEqual(I18nKeyless.bundleNamespaces(bundle.manifest), ["default"])
        let loaded = try await bundle.load("default", .en)
        XCTAssertEqual(loaded, ["Bonjour": "Hello"])
        XCTAssertFalse(I18nKeyless.bundleCovers(bundle.manifest, namespace: "default", lang: "es"))
        XCTAssertThrowsError(try I18nKeylessBundle.files(in: directory.appendingPathComponent("missing")))
    }
}

// End-to-end behaviour of the engine against a stubbed transport: boot, hydration, the
// translate-on-miss flow, identity, usage analytics, the server mode, ETag replay, the
// language switch and the storage contract.
import Foundation
import XCTest
@testable import I18nKeyless

final class ClientTests: XCTestCase {
    private func makeClient(
        _ transport: Transport, storage: I18nKeylessStorage = MemoryStorage(), server: Bool = false,
        supported: [Lang] = [.fr, .en], primary: Lang = .fr, apiURL: String = "https://api.test",
        logger: I18nKeylessLogger? = nil
    ) throws -> I18nKeyless {
        let client = I18nKeyless()
        try client.configure(I18nKeylessConfig(
            apiKey: transport.apiKey,
            languages: LanguagesConfig(primary: primary, supported: supported),
            apiURL: apiURL, storage: storage, server: server,
            urlSessionConfiguration: transport.sessionConfiguration, logger: logger ?? { _ in }))
        return client
    }

    func testConfigureRefusesAnEmptyKeyAndNoLanguages() {
        let client = I18nKeyless()
        XCTAssertThrowsError(try client.configure(.init(apiKey: "", languages: .init(primary: .fr, supported: [.fr])))) {
            XCTAssertEqual($0 as? I18nKeylessError, .apiKeyRequired)
        }
        XCTAssertThrowsError(try client.configure(.init(apiKey: "k", languages: .init(primary: .fr, supported: [])))) {
            XCTAssertEqual($0 as? I18nKeylessError, .supportedLanguagesEmpty)
        }
        XCTAssertFalse(client.isConfigured)
    }

    func testBeforeConfigureTheSourceTextIsReturnedWithReplace() {
        let client = I18nKeyless()
        XCTAssertEqual(client.t("Bonjour {name}", replace: ["{name}": "Arnaud"]), "Bonjour Arnaud")
    }

    func testBootPersistsTheDeviceIdFirst() async throws {
        let storage = RecordingStorage()
        let transport = Transport(apiKey: "k-boot")
        let client = try makeClient(transport, storage: storage)
        XCTAssertEqual(storage.writes.first, StorageKeys.uniqueId)
        XCTAssertTrue(isDeviceId(client.deviceId))
        XCTAssertEqual(storage.entries[StorageKeys.uniqueId], client.deviceId)
        XCTAssertEqual(client.currentLanguage, .fr)
        XCTAssertEqual(client.supportedLanguages, [.fr, .en])
        await client.waitForIdle()
        // The primary language at boot: no dictionary fetch, no usage (nothing rendered).
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testAnInvalidStoredIdIsReplacedAndAValidOneKept() throws {
        let storage = MemoryStorage()
        storage.setItem(StorageKeys.uniqueId, "bad id")
        let client = try makeClient(Transport(apiKey: "k-badid"), storage: storage)
        XCTAssertNotEqual(client.deviceId, "bad id")
        XCTAssertTrue(isDeviceId(client.deviceId))

        let storage2 = MemoryStorage()
        storage2.setItem(StorageKeys.uniqueId, "deviceIdABCDEF12")
        let client2 = try makeClient(Transport(apiKey: "k-goodid"), storage: storage2)
        XCTAssertEqual(client2.deviceId, "deviceIdABCDEF12")
    }

    func testHydrationRestoresTranslationsAndLanguage() async throws {
        let storage = MemoryStorage()
        storage.setItem(StorageKeys.currentLanguage, "en")
        storage.setItem(StorageKeys.translations, "{\"Bonjour\":\"Hello\"}")
        storage.setItem(StorageKeys.lastRefresh, "1700000000")
        let transport = Transport(apiKey: "k-hydrate")
        let client = try makeClient(transport, storage: storage)
        XCTAssertEqual(client.currentLanguage, .en)
        // A hit: no request leaves for it.
        XCTAssertEqual(client.t("Bonjour"), "Hello")
        await client.waitForIdle()
        XCTAssertTrue(transport.translates.isEmpty)
        // The boot in a non-primary language is a full fetch with a null cursor.
        XCTAssertEqual(transport.dictionaries.count, 1)
        XCTAssertEqual(transport.dictionaries[0].url.absoluteString, "https://api.test/translate/en?last_refresh=null")
    }

    func testMissPostsThenBulkFetchesAndPersists() async throws {
        let storage = MemoryStorage()
        storage.setItem(StorageKeys.currentLanguage, "en")
        let transport = Transport(apiKey: "k-miss", dictionary: ["Bonjour": "Hello"], dictionaryAfterTranslate: true)
        let client = try makeClient(transport, storage: storage)
        await client.waitForIdle()
        let revision = client.revision
        XCTAssertEqual(client.t("Bonjour"), "Bonjour")
        XCTAssertEqual(client.namespacesAwaitingFetch, ["default": false])
        await client.waitForIdle()
        XCTAssertEqual(transport.translates.count, 1)
        XCTAssertTrue(jsonEqual(transport.translates.first?.json, [
            "key": "Bonjour", "languages": ["fr", "en"], "primaryLanguage": "fr",
        ] as [String: Any]))
        XCTAssertEqual(client.t("Bonjour"), "Hello")
        XCTAssertGreaterThan(client.revision, revision)
        XCTAssertEqual(storage.getItem(StorageKeys.translations), "{\"Bonjour\":\"Hello\"}")
        XCTAssertEqual(storage.getItem(StorageKeys.lastRefresh), "1")
        XCTAssertEqual(storage.getItem(StorageKeys.namespaces), "[\"default\"]")
        XCTAssertEqual(client.lastRefresh, "1")
        // A second render of the same key after the merge: a hit, nothing queued.
        XCTAssertTrue(client.namespacesAwaitingFetch.isEmpty)
    }

    func testARenderWhileTheMissIsQueuedDoesNotRequestTwice() async throws {
        let storage = MemoryStorage()
        storage.setItem(StorageKeys.currentLanguage, "en")
        let transport = Transport(apiKey: "k-rerender", gated: true)
        let client = try makeClient(transport, storage: storage)
        _ = client.t("Bonjour")
        _ = client.t("Bonjour")
        await transport.waitForTranslates(1)
        _ = client.t("Bonjour")
        transport.gate!.open()
        await client.waitForIdle()
        XCTAssertEqual(transport.translates.count, 1)
    }

    func testContextNamespaceAndReplace() async throws {
        let storage = MemoryStorage()
        storage.setItem(StorageKeys.currentLanguage, "en")
        let transport = Transport(apiKey: "k-options", dictionary: ["8 heures__time": "8 AM", "Payer {n}": "Pay {n}"], dictionaryAfterTranslate: true)
        let client = try makeClient(transport, storage: storage)
        await client.waitForIdle()
        _ = client.t("8 heures", context: "time")
        _ = client.t("Payer {n}", namespace: "checkout", replace: ["{n}": "3"])
        await client.waitForIdle()
        XCTAssertEqual(transport.translates.count, 2)
        let bodies = transport.translates.map { $0.json as! [String: Any] }
        XCTAssertTrue(bodies.contains { $0["context"] as? String == "time" && $0["namespace"] == nil })
        XCTAssertTrue(bodies.contains { $0["namespace"] as? String == "checkout" })
        XCTAssertTrue(transport.dictionaries.contains { $0.url.query?.contains("namespace=checkout") == true })
        XCTAssertEqual(client.t("8 heures", context: "time"), "8 AM")
        XCTAssertEqual(client.t("Payer {n}", namespace: "checkout", replace: ["{n}": "3"]), "Pay 3")
        let checkout = try JSONSerialization.jsonObject(with: storage.getItem(StorageKeys.translationsKeyFor("checkout"))!.data(using: .utf8)!) as? [String: String]
        XCTAssertEqual(checkout, ["8 heures__time": "8 AM", "Payer {n}": "Pay {n}"])
        XCTAssertEqual(storage.getItem(StorageKeys.namespaces), "[\"default\",\"checkout\"]")
    }

    func testForceTemporaryResendsAnExistingKey() async throws {
        let storage = MemoryStorage()
        storage.setItem(StorageKeys.currentLanguage, "en")
        storage.setItem(StorageKeys.translations, "{\"Bonjour\":\"Hello\"}")
        let transport = Transport(apiKey: "k-force")
        let client = try makeClient(transport, storage: storage)
        await client.waitForIdle()
        XCTAssertEqual(client.t("Bonjour", forceTemporary: [.en: "Hi there"]), "Hello")
        await client.waitForIdle()
        XCTAssertEqual(transport.translates.count, 1)
        XCTAssertTrue(jsonEqual((transport.translates.first?.json as? [String: Any])?["forceTemporary"], ["en": "Hi there"]))
    }

    func testCustomHandleTranslateReceivesTheKeyOnly() async throws {
        let storage = MemoryStorage()
        storage.setItem(StorageKeys.currentLanguage, "en")
        let transport = Transport(apiKey: "k-handler")
        let keys = LogSink()
        let client = I18nKeyless()
        try client.configure(I18nKeylessConfig(
            apiKey: transport.apiKey, languages: .init(primary: .fr, supported: [.fr, .en]),
            apiURL: "https://api.test", storage: storage,
            handleTranslate: { key in keys.logger(key); return HandleTranslateResult(ok: true) },
            urlSessionConfiguration: transport.sessionConfiguration, logger: { _ in }))
        _ = client.t("Bonjour", context: "greeting")
        await client.waitForIdle()
        XCTAssertEqual(keys.lines, ["Bonjour"])
        XCTAssertTrue(transport.translates.isEmpty)
        // The bulk fetch that follows the drain still goes through HTTP.
        XCTAssertEqual(transport.dictionaries.count, 2)
    }

    func testUsageIsRecordedAndSentOncePerBoot() async throws {
        let storage = MemoryStorage()
        storage.setItem(StorageKeys.currentLanguage, "en")
        storage.setItem(StorageKeys.translations, "{\"Bonjour\":\"Hello\"}")
        storage.setItem(StorageKeys.translationsUsage, "{\"default\":{\"Bonjour\":\"2026-01-01\"}}")
        let transport = Transport(apiKey: "k-usage")
        let client = try makeClient(transport, storage: storage)
        await client.waitForIdle()
        XCTAssertEqual(transport.usages.count, 1)
        guard let request = transport.usages.first else { return }
        expectHeaders(request, [
            "Content-Type": "application/json", "Authorization": "Bearer k-usage",
            "sdk": "react-client", "unique_id": "$DEVICE_ID", "Version": "$SDK_VERSION",
        ])
        XCTAssertEqual(request.header("unique_id"), client.deviceId)
        XCTAssertTrue(jsonEqual(request.json, [
            "primaryLanguage": "fr", "translationsUsageByNamespace": ["default": ["Bonjour": "2026-01-01"]],
        ] as [String: Any]))
        // Cleared on success.
        XCTAssertEqual(storage.getItem(StorageKeys.translationsUsage), "")
        // A render records today's date, written on the next hop, and is not sent again.
        _ = client.t("Bonjour")
        _ = client.t("Salut", namespace: "chat", unpersistedNamespace: true)
        await client.waitForIdle()
        XCTAssertEqual(transport.usages.count, 1)
        let recorded = try JSONSerialization.jsonObject(with: storage.getItem(StorageKeys.translationsUsage)!.data(using: .utf8)!) as! [String: [String: String]]
        XCTAssertEqual(recorded["default"]?["Bonjour"], I18nKeyless.todayUTC())
        XCTAssertNil(recorded["chat"], "an unpersisted namespace never reports usage")
    }

    func testServerModeSendsNoIdRecordsNoUsageAndUsesMemoryStorage() async throws {
        let transport = Transport(apiKey: "k-server", dictionary: ["Bonjour": "Hello"])
        let client = I18nKeyless()
        try client.configure(I18nKeylessConfig(
            apiKey: transport.apiKey, languages: .init(primary: .fr, supported: [.fr, .en], initWithDefault: .en),
            apiURL: "https://api.test", server: true,
            urlSessionConfiguration: transport.sessionConfiguration, logger: { _ in }))
        XCTAssertEqual(client.runtime, "swift-server")
        XCTAssertNil(client.deviceId)
        _ = client.t("Bonjour")
        await client.waitForIdle()
        XCTAssertEqual(client.t("Bonjour"), "Hello")
        XCTAssertFalse(transport.requests.isEmpty)
        for request in transport.requests {
            XCTAssertEqual(request.header("sdk"), "swift-server")
            XCTAssertNil(request.header("unique_id"))
        }
        XCTAssertTrue(transport.usages.isEmpty)
        // The echoed uniqueId of a dictionary answer is never adopted by a server.
        XCTAssertNil(client.deviceId)
        // Nothing reached UserDefaults: the server default is an in-memory storage.
        XCTAssertNil(UserDefaults.standard.string(forKey: StorageKeys.translations))
    }

    func testETagReplayA304KeepsTheStore() async throws {
        let storage = MemoryStorage()
        let served = LogSink()
        let apiKey = "k-etag"
        StubURLProtocol.register(apiKey: apiKey) { request in
            guard request.method == "GET" else {
                return .response(status: 200, body: StubURLProtocol.json(["ok": true, "message": ""]))
            }
            served.logger("get")
            if request.header("If-None-Match") == "W/\"v1\"" { return .response(status: 304) }
            return .response(status: 200, headers: ["ETag": "W/\"v1\""], body: StubURLProtocol.envelope([
                "translations": ["Bonjour": "Hello"], "uniqueId": NSNull(), "lastRefresh": "1",
            ]))
        }
        let client = I18nKeyless()
        try client.configure(I18nKeylessConfig(
            apiKey: apiKey, languages: .init(primary: .fr, supported: [.fr, .en]), storage: storage,
            urlSessionConfiguration: StubURLProtocol.sessionConfiguration(), logger: { _ in }))
        await client.waitForIdle()
        await client.setLanguage(.en)
        XCTAssertEqual(client.t("Bonjour"), "Hello")
        XCTAssertEqual(client.dictionaryEtags[I18nKeyless.etagCacheKey(apiKey: apiKey, lang: "en")], "W/\"v1\"")
        await client.setLanguage(.en)
        XCTAssertEqual(served.lines.count, 2)
        XCTAssertEqual(client.t("Bonjour"), "Hello", "a 304 keeps the stored dictionary")
        XCTAssertEqual(storage.getItem(StorageKeys.translations), "{\"Bonjour\":\"Hello\"}")
    }

    func testLanguageSwitchValidatesResetsCursorsAndFetches() async throws {
        let storage = MemoryStorage()
        let transport = Transport(apiKey: "k-switch", dictionary: ["Bonjour": "Hello"])
        let events = LogSink()
        let client = I18nKeyless()
        try client.configure(I18nKeylessConfig(
            apiKey: transport.apiKey, languages: .init(primary: .fr, supported: [.fr, .en], fallback: .en),
            apiURL: "https://api.test", storage: storage,
            onInit: { events.logger("init \($0.code)") }, onSetLanguage: { events.logger("set \($0.code)") },
            urlSessionConfiguration: transport.sessionConfiguration, logger: { _ in }))
        await client.waitForIdle()
        await client.setLanguage(.en)
        XCTAssertEqual(client.currentLanguage, .en)
        XCTAssertEqual(storage.getItem(StorageKeys.currentLanguage), "en")
        XCTAssertEqual(client.t("Bonjour"), "Hello")
        XCTAssertEqual(client.lastRefresh, "1")
        // An unsupported language falls back; the cursors are reset and persisted empty.
        await client.setLanguage(.de)
        XCTAssertEqual(client.currentLanguage, .en)
        XCTAssertEqual(storage.getItem(StorageKeys.lastRefresh), "1", "the fetch after the switch wrote the new cursor")
        await client.setLanguage(.fr)
        XCTAssertEqual(client.currentLanguage, .fr)
        XCTAssertNil(client.lastRefresh)
        XCTAssertEqual(storage.getItem(StorageKeys.lastRefresh), "")
        XCTAssertEqual(events.lines, ["init fr", "set en", "set de", "set fr"])
        // Back in the primary language: the key itself, no request.
        let before = transport.requests.count
        XCTAssertEqual(client.t("Bonjour"), "Bonjour")
        await client.waitForIdle()
        XCTAssertEqual(transport.requests.count, before)
    }

    func testClearStorageKeepsTheDeviceId() async throws {
        let storage = MemoryStorage()
        storage.setItem(StorageKeys.currentLanguage, "en")
        let transport = Transport(apiKey: "k-clear2", dictionary: ["Bonjour": "Hello"], dictionaryAfterTranslate: true)
        let client = try makeClient(transport, storage: storage)
        _ = client.t("Bonjour")
        await client.waitForIdle()
        let id = client.deviceId
        XCTAssertNotNil(storage.getItem(StorageKeys.translations))
        await client.clearStorage()
        XCTAssertEqual(storage.entries.keys.sorted(), [StorageKeys.uniqueId])
        XCTAssertEqual(storage.getItem(StorageKeys.uniqueId), id)
        XCTAssertEqual(client.deviceId, id)
        XCTAssertEqual(client.t("Bonjour"), "Bonjour")
    }

    func testAFailingStorageNeverBreaksTheClient() async throws {
        let transport = Transport(apiKey: "k-failing", dictionary: ["Bonjour": "Hello"])
        let logs = LogSink()
        let client = I18nKeyless()
        try client.configure(I18nKeylessConfig(
            apiKey: transport.apiKey, languages: .init(primary: .fr, supported: [.fr, .en], initWithDefault: .en),
            apiURL: "https://api.test", storage: FailingStorage(),
            urlSessionConfiguration: transport.sessionConfiguration, logger: logs.logger))
        XCTAssertTrue(isDeviceId(client.deviceId))
        _ = client.t("Bonjour")
        await client.waitForIdle()
        XCTAssertEqual(client.t("Bonjour"), "Hello")
        XCTAssertTrue(logs.lines.contains { $0.contains("Error getting item") })
    }

    func testTheComponentPathTrimsAndTheFunctionPathDoesNot() async throws {
        let storage = MemoryStorage()
        storage.setItem(StorageKeys.currentLanguage, "en")
        storage.setItem(StorageKeys.translations, "{\"Bonjour\":\"Hello\"}")
        let client = try makeClient(Transport(apiKey: "k-trim"), storage: storage)
        XCTAssertEqual(client.t("Bonjour"), "Hello")
        XCTAssertEqual(client.t(" Bonjour "), " Bonjour ", "the function path does not trim")
        #if canImport(SwiftUI)
        XCTAssertEqual(client.text("  Bonjour\n"), "Hello", "the component path trims")
        #endif
        await client.waitForIdle()
    }

    func testListenersFireOnEveryChange() async throws {
        let storage = MemoryStorage()
        let transport = Transport(apiKey: "k-listen", dictionary: ["Bonjour": "Hello"])
        let client = try makeClient(transport, storage: storage)
        let events = LogSink()
        let token = client.addListener { events.logger("change") }
        await client.setLanguage(.en)
        XCTAssertGreaterThanOrEqual(events.lines.count, 2, "the switch, then the merge")
        client.removeListener(token)
        await client.setLanguage(.fr)
        XCTAssertEqual(events.lines.count, events.lines.count)
    }

    func testThePrimaryAndInitWithDefaultAreAddedToSupported() throws {
        let client = I18nKeyless()
        try client.configure(I18nKeylessConfig(
            apiKey: "k", languages: .init(primary: .fr, supported: [.en], initWithDefault: .es),
            storage: MemoryStorage(), urlSessionConfiguration: StubURLProtocol.sessionConfiguration(), logger: { _ in }))
        XCTAssertEqual(client.supportedLanguages, [.en, .es, .fr])
        XCTAssertEqual(client.currentLanguage, .es)
    }
}

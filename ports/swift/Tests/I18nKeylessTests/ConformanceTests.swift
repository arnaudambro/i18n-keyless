// Replays the language-neutral vectors of `conformance/vectors/*.json` (see
// `conformance/README.md` and `docs/PROTOCOL.md` at the repository root).
//
// The vectors are read from the repository at test time. When the directory is not there
// (a copy of the package outside the monorepo), the whole suite is skipped.
//
// The vectors are the react package's: `react-client` cases run in the device mode of
// this port (`swift-client`), `react-server` / `node` cases in its server mode
// (`swift-server`). The `node` usage cases do not apply: a server here never reports
// usage (the `react-server` rule), see the README.
import Foundation
import XCTest
@testable import I18nKeyless

final class ConformanceTests: XCTestCase {
    override func setUpWithError() throws {
        try XCTSkipUnless(Vectors.available, "conformance/vectors not found at \(Vectors.directory.path)")
    }

    private func client(
        _ raw: [String: Any], transport: URLSessionConfiguration, storage: I18nKeylessStorage? = nil,
        server: Bool = false, handleTranslate: HandleTranslate? = nil,
        getAllTranslations: GetAllTranslations? = nil, sendTranslationsUsage: SendTranslationsUsage? = nil,
        api: ApiClient? = nil, logger: I18nKeylessLogger? = nil
    ) throws -> I18nKeyless {
        let client = I18nKeyless(api: api)
        try client.configure(configFrom(
            raw, transportConfiguration: transport, storage: storage, server: server,
            handleTranslate: handleTranslate, getAllTranslations: getAllTranslations,
            sendTranslationsUsage: sendTranslationsUsage, logger: logger))
        return client
    }

    func testStorageKey() throws {
        for c in Vectors.cases(try Vectors.load("storage-key")) {
            let input = c["input"] as! [String: Any]
            XCTAssertEqual(
                I18nKeyless.storageKeyFor(input["key"] as! String, context: input["context"] as? String),
                c["expected"] as? String, Vectors.name(c))
        }
    }

    func testReplace() throws {
        for c in Vectors.cases(try Vectors.load("replace")) {
            let input = c["input"] as! [String: Any]
            let replace = orderedReplace(input["replace"] as? [String: Any], in: caseText("replace", c))
            XCTAssertEqual(I18nKeyless.applyReplace(input["text"] as! String, replace), c["expected"] as? String, Vectors.name(c))
        }
    }

    func testNamespace() throws {
        let vector = try Vectors.load("namespace")
        XCTAssertEqual(i18nKeylessDefaultNamespace, vector["defaultNamespace"] as? String)
        for c in Vectors.cases(vector) {
            let input = c["input"] as! [String: Any]
            let options = input["options"] is NSNull || input["options"] == nil ? nil : optionsOf(input["options"])
            if c["fn"] as? String == "resolveNamespace" {
                let config = input["config"] as! [String: Any]
                XCTAssertEqual(
                    I18nKeyless.resolveNamespace(options, defaultNamespace: config["defaultNamespace"] as? String),
                    c["expected"] as? String, Vectors.name(c))
            } else {
                XCTAssertEqual(
                    I18nKeyless.resolveOriginLanguage(options, primary: lang(input["primary"]))?.code,
                    c["expected"] as? String, Vectors.name(c))
            }
        }
    }

    func testResolveLang() throws {
        for c in Vectors.cases(try Vectors.load("resolve-lang")) {
            let input = c["input"] as! [String: Any]
            let resolved = resolveLang(
                input["tag"] as? String,
                supported: (input["supported"] as? [String])?.map { lang($0) },
                fallback: (input["fallback"] as? String).map { lang($0) })
            XCTAssertEqual(resolved?.code, c["expected"] as? String, Vectors.name(c))
        }
    }

    func testLanguages() throws {
        for c in Vectors.cases(try Vectors.load("languages")) {
            switch c["check"] as? String {
            case "availableLangs":
                XCTAssertEqual(Lang.availableCodes, c["expected"] as? [String], Vectors.name(c))
            case "rename":
                XCTAssertNil(Lang(code: c["input"] as? String), Vectors.name(c))
                XCTAssertTrue(Lang.availableCodes.contains(c["expected"] as! String), Vectors.name(c))
            case "stillAvailable":
                for code in c["input"] as! [String] { XCTAssertTrue(Lang.availableCodes.contains(code), code) }
            case "absent":
                XCTAssertFalse(Lang.availableCodes.contains(c["input"] as! String), Vectors.name(c))
            case "regionalized":
                XCTAssertEqual(Set(Lang.availableCodes.filter { $0.contains("-") }), Set(c["expected"] as! [String]))
            default:
                XCTFail("unknown check \(c["check"] ?? "")")
            }
        }
    }

    func testAppStoreLocales() throws {
        let vector = try Vectors.load("app-store-locales")
        XCTAssertEqual(Set(Lang.allCases.map(toAppStoreLocale)).count, vector["distinctSlots"] as? Int)
        for c in Vectors.cases(vector) {
            XCTAssertEqual(toAppStoreLocale(lang(c["input"])), c["expected"] as? String, Vectors.name(c))
        }
    }

    func testUniqueId() throws {
        let vector = try Vectors.load("unique-id")
        let pattern = try NSRegularExpression(pattern: vector["idPattern"] as! String)
        XCTAssertEqual(String(UniqueId.alphabet), vector["alphabet"] as? String)
        XCTAssertEqual(UniqueId.alphabet.count, vector["alphabetLength"] as? Int)
        XCTAssertEqual(UniqueId.length, vector["idLength"] as? Int)
        XCTAssertEqual(UniqueId.largestUsableByte, vector["largestUsableByteExclusive"] as? Int)
        XCTAssertEqual(StorageKeys.uniqueId, vector["storageKey"] as? String)
        for _ in 0..<200 {
            let id = I18nKeyless.generateUniqueId()
            XCTAssertEqual(id.count, UniqueId.length)
            XCTAssertNotNil(pattern.firstMatch(in: id, range: NSRange(location: 0, length: id.utf16.count)))
            XCTAssertTrue(I18nKeyless.isUniqueId(id))
        }
        for c in Vectors.cases(vector) {
            // A non-string input (a number, an object, null) is never a valid id.
            XCTAssertEqual(I18nKeyless.isUniqueId(c["input"] as? String), c["expected"] as? Bool, Vectors.name(c))
        }
    }

    func testBackoff() async throws {
        let vector = try Vectors.load("backoff")
        XCTAssertEqual(ApiClient.defaultTimeoutMs, vector["timeoutMs"] as? Int)
        XCTAssertEqual(ApiClient.defaultRetryDelaysMs, vector["delaysMs"] as? [Int])
        XCTAssertEqual(ApiClient.defaultRetryDelaysMs.count + 1, vector["maxAttempts"] as? Int)
        for c in Vectors.cases(vector) {
            let failed = (c["input"] as! [String: Any])["failedAttempt"] as! Int
            let expected = c["expected"] as! [String: Any]
            if failed <= ApiClient.defaultRetryDelaysMs.count {
                XCTAssertEqual(ApiClient.defaultRetryDelaysMs[failed - 1], expected["waitMs"] as? Int, Vectors.name(c))
                XCTAssertEqual(failed + 1, expected["nextAttempt"] as? Int, Vectors.name(c))
            } else {
                XCTAssertTrue(expected["waitMs"] is NSNull, Vectors.name(c))
                XCTAssertTrue(expected["nextAttempt"] is NSNull, Vectors.name(c))
            }
        }
        for (index, s) in Vectors.cases(vector, "scenarios").enumerated() {
            let name = Vectors.name(s)
            let transport = ScriptedTransport(apiKey: "k-backoff-\(index)", outcomes: s["responses"] as! [[String: Any]])
            let sleeps = LogSink()
            let api = ApiClient(
                configuration: transport.sessionConfiguration,
                sleep: { ms in sleeps.logger("\(ms)") }, timeoutMs: 20)
            let result = await api.get(
                URL(string: "https://api.test/translate/en")!,
                headers: ["Authorization": "Bearer \(transport.apiKey)"])
            let expected = s["expected"] as! [String: Any]
            XCTAssertEqual(api.attempts, expected["attempts"] as? Int, name)
            XCTAssertEqual(sleeps.lines.map { Int($0)! }, expected["sleepsMs"] as? [Int], name)
            let expectedResult = expected["result"] as! [String: Any]
            XCTAssertEqual(result.ok, expectedResult["ok"] as? Bool, name)
            if let error = expectedResult["error"] as? String {
                let last = (s["responses"] as! [[String: Any]]).last!
                let expectedError = last["status"] == nil ? error
                    : portError(status: last["status"] as! Int, statusText: last["statusText"] as? String ?? "")
                XCTAssertEqual(result.error, expectedError, name)
            }
            if let notModified = expectedResult["notModified"] as? Bool { XCTAssertEqual(result.notModified, notModified, name) }
            if expectedResult["ok"] as? Bool == true && !result.notModified {
                XCTAssertTrue(jsonEqual(result.json, expectedResult), name)
            }
        }
    }

    func testRetryDecision() async throws {
        for (index, c) in Vectors.cases(try Vectors.load("retry-decision")).enumerated() {
            let name = Vectors.name(c)
            var outcome = c["input"] as! [String: Any]
            let expected = c["expected"] as! [String: Any]
            if outcome["status"] as? Int == 200 {
                outcome["body"] = ["ok": true]
                outcome["headers"] = ["etag": "\"e1\""]
            }
            let transport = ScriptedTransport(apiKey: "k-retry-\(index)", outcomes: [outcome])
            let expectedError = portError(status: outcome["status"] as! Int, statusText: outcome["statusText"] as? String ?? "")
            let sleeps = LogSink()
            let api = ApiClient(configuration: transport.sessionConfiguration, sleep: { _ in sleeps.logger("1") })
            let result = await api.get(
                URL(string: "https://api.test/translate/en")!,
                headers: ["Authorization": "Bearer \(transport.apiKey)"])
            XCTAssertTrue(ApiClient.isRetryableStatus(outcome["status"] as! Int) == (expected["action"] as? String == "retry"), name)
            switch expected["action"] as? String {
            case "parse-body":
                XCTAssertEqual(api.attempts, 1, name)
                XCTAssertTrue(result.ok, name)
                XCTAssertTrue(jsonEqual(result.json, ["ok": true]), name)
                XCTAssertEqual(result.etag, "\"e1\"", name)
            case "not-modified":
                XCTAssertEqual(api.attempts, 1, name)
                XCTAssertTrue(result.ok && result.notModified, name)
            case "fail":
                XCTAssertEqual(api.attempts, 1, name)
                XCTAssertTrue(sleeps.lines.isEmpty, name)
                XCTAssertFalse(result.ok, name)
                XCTAssertEqual(result.error, expectedError, name)
            case "retry":
                XCTAssertEqual(api.attempts, 3, name)
                XCTAssertEqual(sleeps.lines.count, 2, name)
                XCTAssertFalse(result.ok, name)
                XCTAssertEqual(result.error, expectedError, name)
            default:
                XCTFail("unknown action \(expected["action"] ?? "")")
            }
        }
    }

    func testQueue() async throws {
        let vector = try Vectors.load("queue")
        XCTAssertEqual(PQueue().concurrency, vector["concurrency"] as? Int)
        XCTAssertEqual(vector["idRule"] as? String, "namespace + ':' + key")
        for c in Vectors.cases(vector) {
            let input = c["input"] as! [String: Any]
            XCTAssertEqual(
                I18nKeyless.queueIdFor(namespace: input["namespace"] as! String, key: input["key"] as! String),
                c["expected"] as? String, Vectors.name(c))
        }
        for (index, s) in Vectors.cases(vector, "scenarios").enumerated() {
            let name = Vectors.name(s)
            let transport = Transport(apiKey: "k-queue-\(index)", gated: true)
            let storage = MemoryStorage()
            storage.setItem(StorageKeys.currentLanguage, "en")
            if let seeded = s["translations"] {
                storage.setItem(StorageKeys.translations, String(data: StubURLProtocol.json(seeded), encoding: .utf8)!)
            }
            let client = try client(
                ["API_KEY": transport.apiKey, "API_URL": "https://api.test",
                 "languages": ["primary": "fr", "supported": ["fr", "en", "es", "pt"]]],
                transport: transport.sessionConfiguration, storage: storage)
            let calls: [[String: Any]] = s["calls"] is String
                ? (0..<31).map { ["key": "key-\($0)"] } : s["calls"] as! [[String: Any]]
            for call in calls { _ = client.translate(call["key"] as! String, optionsOf(call["options"])) }
            let expected = s["expected"] as! [String: Any]
            // Let the queue hand its tasks to the transport, then open the gate.
            await transport.waitForTranslates(min(expected["requests"] as! Int, PQueue().concurrency))
            transport.gate!.open()
            await client.waitForIdle()
            XCTAssertEqual(transport.translates.count, expected["requests"] as? Int, name)
            if let peak = expected["peakInFlight"] as? Int {
                XCTAssertEqual(transport.peakInFlightTranslates, peak, name)
            }
        }
    }

    func testTranslationLookup() async throws {
        for (index, c) in Vectors.cases(try Vectors.load("translation-lookup")).enumerated() {
            let name = Vectors.name(c)
            let input = c["input"] as! [String: Any]
            let store = input["store"] as! [String: Any]
            let storage = MemoryStorage()
            storage.setItem(StorageKeys.currentLanguage, store["currentLanguage"] as! String)
            let translations = store["translations"] as! [String: String]
            if !translations.isEmpty {
                storage.setItem(StorageKeys.translations, String(data: StubURLProtocol.json(translations), encoding: .utf8)!)
            }
            let transport = Transport(apiKey: "k-lookup-\(index)")
            var raw: [String: Any] = [
                "API_KEY": transport.apiKey, "API_URL": "https://api.test",
                "languages": ["primary": store["primary"]!, "supported": ["fr", "en", "es"]],
            ]
            if let ns = store["defaultNamespace"] { raw["defaultNamespace"] = ns }
            let client = try client(raw, transport: transport.sessionConfiguration, storage: storage)
            let text = client.translate(input["key"] as! String, optionsOf(input["options"], caseText: caseText("translation-lookup", c)))
            let queued = client.namespacesAwaitingFetch.map { ["namespace": $0.key, "unpersisted": $0.value] as [String: Any] }
            let expected = c["expected"] as! [String: Any]
            XCTAssertEqual(text, expected["text"] as? String, name)
            XCTAssertTrue(jsonEqual(queued, expected["queued"]), "\(name): queued \(queued)")
            await client.waitForIdle()
        }
    }

    func testTranslateRequest() async throws {
        for (index, c) in Vectors.cases(try Vectors.load("translate-request")).enumerated() {
            let name = Vectors.name(c)
            let input = c["input"] as! [String: Any]
            let config = input["config"] as! [String: Any]
            let expected = c["expected"] as! [String: Any]
            let server = input["runtime"] as? String != "react-client"
            let storage = MemoryStorage()
            storage.setItem(StorageKeys.currentLanguage, input["currentLanguage"] as! String)
            if let translations = input["translations"] {
                storage.setItem(StorageKeys.translations, String(data: StubURLProtocol.json(translations), encoding: .utf8)!)
            }
            let transport = Transport(apiKey: config["API_KEY"] as! String)
            let handlerArgs = LogSink()
            let client = try client(
                config, transport: transport.sessionConfiguration, storage: storage, server: server,
                handleTranslate: config["handleTranslate"] as? Bool == true
                    ? { @Sendable key in handlerArgs.logger(key); return HandleTranslateResult(ok: true) } : nil)
            _ = client.translate(input["key"] as! String, optionsOf(input["options"]))
            await client.waitForIdle()
            if expected["http"] as? Bool == false {
                XCTAssertTrue(transport.translates.isEmpty, name)
                XCTAssertEqual(handlerArgs.lines, expected["handlerArgs"] as? [String], name)
                continue
            }
            guard transport.translates.count == 1 else {
                XCTFail("\(name): expected one translate request, got \(transport.translates.count)"); continue
            }
            let request = transport.translates[0]
            XCTAssertEqual(request.url.absoluteString, expected["url"] as? String, name)
            XCTAssertEqual(request.method, expected["method"] as? String, name)
            expectHeaders(request, expected["headers"] as! [String: Any])
            XCTAssertTrue(jsonEqual(request.json, expected["body"]), "\(name): body \(request.json ?? "nil")")
            _ = index
        }
    }

    func testDictionaryRequest() async throws {
        for c in Vectors.cases(try Vectors.load("dictionary-request")) {
            let name = Vectors.name(c)
            let input = c["input"] as! [String: Any]
            let config = input["config"] as! [String: Any]
            let expected = c["expected"] as! [String: Any]
            let server = input["runtime"] as? String != "react-client"
            let target = input["targetLanguage"] as! String
            let namespace = input["namespace"] as? String
            let knownEtag = input["knownEtag"] as? String
            if expected["http"] as? Bool != false {
                XCTAssertEqual(
                    I18nKeyless.buildDictionaryUrl(
                        apiUrl: config["API_URL"] as? String ?? i18nKeylessDefaultApiUrl, lang: target,
                        lastRefresh: input["lastRefresh"] as? String, namespace: namespace, etag: knownEtag),
                    expected["url"] as? String, name)
                XCTAssertEqual(
                    I18nKeyless.etagCacheKey(apiKey: config["API_KEY"] as! String, lang: target, namespace: namespace),
                    expected["etagCacheKey"] as? String, name)
            }
            let transport = Transport(apiKey: config["API_KEY"] as! String)
            let handlerCalls = LogSink()
            let client = try client(
                config, transport: transport.sessionConfiguration, server: server,
                getAllTranslations: config["getAllTranslations"] as? Bool == true
                    ? { @Sendable in handlerCalls.logger("call"); return TranslationsResponse(ok: true) } : nil)
            if let knownEtag = knownEtag { client.seedEtag(knownEtag, lang: lang(target), namespace: namespace) }
            if let other = input["knownEtagFor"] as? [String: Any] {
                client.seedEtag(other["etag"] as! String, lang: lang(other["lang"]))
            }
            // Wait out the boot fetch so it never races the request under test.
            await client.waitForIdle()
            // A miss in the namespace, then the drain of the queue fetches it.
            await client.setLanguage(lang(target))
            _ = client.translate("Bonjour", TranslationOptions(namespace: namespace))
            await client.waitForIdle()
            if expected["http"] as? Bool == false {
                XCTAssertTrue(transport.dictionaries.isEmpty, name)
                XCTAssertFalse(handlerCalls.lines.isEmpty, name)
                continue
            }
            // Several fetches leave (the switch fetches every known namespace); assert on the
            // one for this case's namespace, not on whichever landed last. The cursor never
            // matches the vector's `lastRefresh` on the wire (the switch resets it), so the
            // namespace query component is the selector, like the reference Flutter test.
            let wantsNamespace = namespace != nil && namespace != i18nKeylessDefaultNamespace
            guard let request = transport.dictionaries.last(where: {
                wantsNamespace ? $0.url.query?.contains("namespace=\(I18nKeyless.encodeURIComponent(namespace!))") == true
                    : $0.url.query?.contains("namespace=") != true
            }) else {
                XCTFail("\(name): no dictionary request for namespace \(namespace ?? "default")"); continue
            }
            XCTAssertEqual(request.method, expected["method"] as? String, name)
            XCTAssertEqual(request.url.path, URL(string: expected["url"] as! String)!.path, name)
            expectHeaders(request, expected["headers"] as! [String: Any])
        }
    }

    func testDictionaryResponse() async throws {
        for c in Vectors.cases(try Vectors.load("dictionary-response")) {
            let name = Vectors.name(c)
            let input = c["input"] as! [String: Any]
            let apiKey = (input["config"] as! [String: Any])["API_KEY"] as! String
            let expected = c["expected"] as! [String: Any]
            let outcomes = c["responses"] as? [[String: Any]] ?? [c["response"] as! [String: Any]]
            let transport = ScriptedTransport(apiKey: apiKey, outcomes: outcomes)
            let api = ApiClient(configuration: transport.sessionConfiguration, sleep: { _ in }, timeoutMs: 20)
            let logs = LogSink()
            let storage = MemoryStorage()
            storage.setItem(StorageKeys.translations, "{\"Existing\":\"Kept\"}")
            let client = try client(
                ["API_KEY": apiKey, "languages": ["primary": "fr", "supported": ["fr", "en"]]],
                transport: transport.sessionConfiguration, storage: storage, api: api, logger: logs.logger)
            if let knownEtag = input["knownEtag"] as? String { client.seedEtag(knownEtag, lang: .en) }
            // The first request of this (API key, language): the language switch.
            await client.setLanguage(.en)
            if let attempts = expected["attempts"] as? Int { XCTAssertEqual(api.attempts, attempts, name) }
            XCTAssertEqual(client.currentTranslations["Existing"], "Kept", "\(name): the stored dictionary is kept")
            if let result = expected["result"] as? [String: Any] {
                let incoming = (result["data"] as! [String: Any])["translations"] as! [String: String]
                for (key, value) in incoming { XCTAssertEqual(client.currentTranslations[key], value, name) }
            } else {
                XCTAssertNil(client.currentTranslations["Bonjour"], name)
            }
            if let warning = expected["warning"] as? String {
                XCTAssertTrue(logs.lines.contains("i18n-keyless: \(warning)"), "\(name): \(logs.lines)")
            }
            let remembered = client.dictionaryEtags[I18nKeyless.etagCacheKey(apiKey: apiKey, lang: "en")]
            XCTAssertEqual(remembered, expected["etagRemembered"] as? String, name)
            let next = expected["nextRequest"] as! [String: Any]
            XCTAssertEqual(
                I18nKeyless.buildDictionaryUrl(apiUrl: i18nKeylessDefaultApiUrl, lang: "en", lastRefresh: "1700000000", etag: remembered),
                next["url"] as? String, name)
            XCTAssertEqual(remembered, next["ifNoneMatch"] as? String, name)
        }
    }

    func testUsageRequest() async throws {
        for c in Vectors.cases(try Vectors.load("usage-request")) {
            let name = Vectors.name(c)
            let input = c["input"] as! [String: Any]
            if input["runtime"] as? String != "react-client" {
                // A server runtime of this port never reports usage (the react-server rule).
                continue
            }
            let config = input["config"] as! [String: Any]
            let expected = c["expected"] as! [String: Any]
            let storage = MemoryStorage()
            let usage = input["usage"] as! [String: Any]
            if !usage.isEmpty {
                storage.setItem(StorageKeys.translationsUsage, String(data: StubURLProtocol.json(usage), encoding: .utf8)!)
            }
            let transport = Transport(apiKey: config["API_KEY"] as! String)
            let handlerArgs = LogSink()
            if (config["API_KEY"] as! String).isEmpty {
                // `configure` refuses an empty key, so nothing can be sent.
                XCTAssertThrowsError(try client(config, transport: transport.sessionConfiguration, storage: storage), name)
                XCTAssertTrue(transport.requests.isEmpty, name)
                continue
            }
            let client = try client(
                config, transport: transport.sessionConfiguration, storage: storage,
                sendTranslationsUsage: config["sendTranslationsUsage"] as? Bool == true
                    ? { @Sendable bucket in
                        handlerArgs.logger(String(data: StubURLProtocol.json(bucket), encoding: .utf8)!)
                        return UsageResponse(ok: true)
                    } : nil)
            await client.waitForIdle()
            if expected["http"] as? Bool == false {
                XCTAssertTrue(transport.usages.isEmpty, name)
                if let args = expected["handlerArgs"] as? [[String: String]] {
                    let got = handlerArgs.lines.map { try! JSONSerialization.jsonObject(with: $0.data(using: .utf8)!) as! [String: String] }
                    XCTAssertEqual(got, args, name)
                }
                continue
            }
            guard transport.usages.count == 1 else { XCTFail("\(name): \(transport.usages.count) usage requests"); continue }
            let request = transport.usages[0]
            XCTAssertEqual(request.url.absoluteString, expected["url"] as? String, name)
            XCTAssertEqual(request.method, expected["method"] as? String, name)
            expectHeaders(request, expected["headers"] as! [String: Any])
            XCTAssertTrue(jsonEqual(request.json, expected["body"]), "\(name): body \(request.json ?? "nil")")
        }
    }

    func testUsageReporting() async throws {
        let vector = try Vectors.load("usage-reporting")
        let labels = Vectors.cases(vector["serverLabels"] as! [String: Any])
        for c in labels {
            XCTAssertEqual(I18nKeyless.isServerRuntime(c["label"] as! String), c["expected"] as? Bool, c["label"] as! String)
        }
        XCTAssertTrue(labels.contains { $0["label"] as? String == I18nKeylessRuntime.client && $0["expected"] as? Bool == false })
        XCTAssertTrue(labels.contains { $0["label"] as? String == I18nKeylessRuntime.server && $0["expected"] as? Bool == true })
        for (index, c) in Vectors.cases(vector).enumerated() {
            let name = Vectors.name(c)
            let input = c["input"] as! [String: Any]
            let expected = c["expected"] as! [String: Any]
            let runtime = expected["runtime"] as! String
            // `node` reports usage from a server; this port's server mode does not.
            if runtime == "node" { continue }
            let server = runtime.hasSuffix("-server")
            let storage = MemoryStorage()
            storage.setItem(StorageKeys.translationsUsage, "{\"default\":{\"x\":\"2026-01-01\"}}")
            let transport = Transport(apiKey: "k-reporting-\(index)")
            let client = try client(
                ["API_KEY": transport.apiKey, "languages": ["primary": "fr", "supported": ["fr", "en"]]],
                transport: transport.sessionConfiguration, storage: storage, server: server)
            XCTAssertEqual(client.runtime, server ? I18nKeylessRuntime.server : I18nKeylessRuntime.client, name)
            XCTAssertEqual(I18nKeyless.isServerRuntime(client.runtime), server, name)
            // The boot POST first, so the record below is not swept by its success.
            await client.waitForIdle()
            _ = client.translate("Bonjour")
            await client.waitForIdle()
            XCTAssertEqual(!transport.usages.isEmpty, expected["sendsUsage"] as? Bool, name)
            let recorded = storage.getItem(StorageKeys.translationsUsage)
                .flatMap { $0.data(using: .utf8) }.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            let bucket = recorded?["default"] as? [String: Any]
            XCTAssertEqual(bucket?["Bonjour"] != nil, expected["recordsUsage"] as? Bool, name)
            let sendsId = transport.requests.first.map { $0.header("unique_id") != nil } ?? false
            if !transport.requests.isEmpty {
                XCTAssertEqual(sendsId, expected["sendsUniqueId"] as? Bool, name)
            }
            _ = input
        }
    }

    func testStorageKeys() async throws {
        let vector = try Vectors.load("storage-keys")
        let fixed = vector["fixedKeys"] as! [String: [String: Any]]
        XCTAssertEqual(fixed["uniqueId"]?["key"] as? String, StorageKeys.uniqueId)
        XCTAssertEqual(fixed["currentLanguage"]?["key"] as? String, StorageKeys.currentLanguage)
        XCTAssertEqual(fixed["lastRefresh"]?["key"] as? String, StorageKeys.lastRefresh)
        XCTAssertEqual(fixed["translations"]?["key"] as? String, StorageKeys.translations)
        XCTAssertEqual(fixed["translationsUsage"]?["key"] as? String, StorageKeys.translationsUsage)
        XCTAssertEqual(fixed["namespaces"]?["key"] as? String, StorageKeys.namespaces)
        XCTAssertEqual(fixed["originNamespaces"]?["key"] as? String, StorageKeys.originNamespaces)

        // Hydration order.
        let storage = RecordingStorage()
        let transport = Transport(apiKey: "k-order")
        _ = try client(
            ["API_KEY": transport.apiKey, "languages": ["primary": "fr", "supported": ["fr", "en"]]],
            transport: transport.sessionConfiguration, storage: storage)
        XCTAssertEqual(storage.reads, [
            StorageKeys.uniqueId, StorageKeys.namespaces, StorageKeys.translations, StorageKeys.lastRefresh,
            StorageKeys.originNamespaces, StorageKeys.translationsUsage, StorageKeys.currentLanguage,
            StorageKeys.lastRefresh,
        ])

        for c in Vectors.cases(vector) {
            let name = Vectors.name(c)
            switch c["fn"] as? String {
            case "translationsKeyFor":
                XCTAssertEqual(StorageKeys.translationsKeyFor(c["input"] as! String), c["expected"] as? String, name)
            case "lastRefreshKeyFor":
                XCTAssertEqual(StorageKeys.lastRefreshKeyFor(c["input"] as! String), c["expected"] as? String, name)
            case "clearI18nKeylessStorage":
                let index = (c["input"] as! [String: Any])["namespacesIndex"] as! [String]
                let expected = c["expected"] as! [String: [String]]
                let storage = MemoryStorage()
                storage.setItem(StorageKeys.namespaces, String(data: StubURLProtocol.json(index), encoding: .utf8)!)
                for key in expected["deleted"]! + expected["kept"]! where storage.getItem(key) == nil {
                    storage.setItem(key, key == StorageKeys.uniqueId ? "deviceIdABCDEF12"
                        : key.contains("translations") || key.contains("namespaces") ? "{}" : "x")
                }
                let transport = Transport(apiKey: "k-clear")
                let client = try client(
                    ["API_KEY": transport.apiKey, "languages": ["primary": "fr", "supported": ["fr", "en"]]],
                    transport: transport.sessionConfiguration, storage: storage)
                await client.waitForIdle()
                await client.clearStorage()
                for key in expected["deleted"]! { XCTAssertNil(storage.getItem(key), "\(name): \(key)") }
                for key in expected["kept"]! { XCTAssertEqual(storage.getItem(key), "deviceIdABCDEF12", "\(name): \(key)") }
            default:
                XCTFail("unknown fn \(c["fn"] ?? "")")
            }
        }
    }
}

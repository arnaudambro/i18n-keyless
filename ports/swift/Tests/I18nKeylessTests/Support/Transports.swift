import Foundation
import XCTest
@testable import I18nKeyless

/// A backend that answers every route `ok`, records requests, and can hold `POST
/// /translate` answers until `gate` opens (for the queue scenarios).
final class Transport: @unchecked Sendable {
    let apiKey: String
    let dictionary: [String: String]
    let gate: AsyncGate?
    private let lock = NSLock()
    private(set) var requests: [StubURLProtocol.Request] = []
    private var inFlightTranslates = 0
    private(set) var peakInFlightTranslates = 0

    /// When true, the dictionary is served only once a `POST /translate` was received, like
    /// the real API: a boot fetch finds nothing, the miss is translated, the drain fetches it.
    let dictionaryAfterTranslate: Bool

    init(apiKey: String, dictionary: [String: String] = [:], gated: Bool = false, dictionaryAfterTranslate: Bool = false) {
        self.apiKey = apiKey
        self.dictionary = dictionary
        self.gate = gated ? AsyncGate() : nil
        self.dictionaryAfterTranslate = dictionaryAfterTranslate
        StubURLProtocol.register(apiKey: apiKey) { [self] request in
            lock.withLock { requests.append(request) }
            if request.method == "POST" && request.path == "/translate" {
                lock.withLock {
                    inFlightTranslates += 1
                    peakInFlightTranslates = max(peakInFlightTranslates, inFlightTranslates)
                }
                if let gate = gate { await gate.wait() }
                lock.withLock { inFlightTranslates -= 1 }
                return .response(status: 200, body: StubURLProtocol.envelope(["translation": [String: String]()]))
            }
            if request.method == "GET" {
                let translated = !dictionaryAfterTranslate || !translates.isEmpty
                return .response(status: 200, body: StubURLProtocol.envelope([
                    "translations": translated ? dictionary : [:], "uniqueId": NSNull(), "lastRefresh": "1",
                ]))
            }
            return .response(status: 200, body: StubURLProtocol.json(["ok": true, "message": ""]))
        }
    }

    var sessionConfiguration: URLSessionConfiguration { StubURLProtocol.sessionConfiguration() }

    var translates: [StubURLProtocol.Request] {
        lock.withLock { requests.filter { $0.method == "POST" && $0.path == "/translate" } }
    }
    var dictionaries: [StubURLProtocol.Request] {
        lock.withLock { requests.filter { $0.method == "GET" } }
    }
    var usages: [StubURLProtocol.Request] {
        lock.withLock { requests.filter { $0.path == "/translate/last-used-translations" } }
    }

    /// Waits until `count` translate requests reached the stub (or 2 s passed).
    func waitForTranslates(_ count: Int) async {
        for _ in 0..<400 where translates.count < count {
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }
}

/// A transport that plays scripted outcomes (`{status, statusText, headers, body,
/// invalidJson, networkError, timeout}`) in order, then repeats the last one.
final class ScriptedTransport: @unchecked Sendable {
    let apiKey: String
    private let lock = NSLock()
    private(set) var requests: [StubURLProtocol.Request] = []

    init(apiKey: String, outcomes: [[String: Any]]) {
        self.apiKey = apiKey
        StubURLProtocol.register(apiKey: apiKey) { [self] request in
            let index: Int = lock.withLock {
                requests.append(request)
                return requests.count - 1
            }
            let outcome = outcomes[min(index, outcomes.count - 1)]
            if outcome["timeout"] as? Bool == true { return .hang }
            if let message = outcome["networkError"] as? String { return .error(message) }
            let status = outcome["status"] as! Int
            let headers = outcome["headers"] as? [String: String] ?? [:]
            let body: Data?
            if outcome["invalidJson"] as? Bool == true {
                body = "{not json".data(using: .utf8)
            } else if let object = outcome["body"] {
                body = StubURLProtocol.json(object)
            } else {
                body = nil
            }
            return .response(status: status, headers: headers, body: body)
        }
    }

    var sessionConfiguration: URLSessionConfiguration { StubURLProtocol.sessionConfiguration() }
}

/// A `MemoryStorage` that records the order of its reads and writes.
final class RecordingStorage: I18nKeylessStorage, @unchecked Sendable {
    private let inner = MemoryStorage()
    private let lock = NSLock()
    private(set) var reads: [String] = []
    private(set) var writes: [String] = []

    var entries: [String: String] { inner.entries }

    func getItem(_ key: String) -> String? {
        lock.withLock { reads.append(key) }
        return inner.getItem(key)
    }

    func setItem(_ key: String, _ value: String) {
        lock.withLock { writes.append(key) }
        inner.setItem(key, value)
    }

    func removeItem(_ key: String) { inner.removeItem(key) }
}

/// A `MemoryStorage` whose reads and writes fail, to check the SDK survives a broken store.
final class FailingStorage: I18nKeylessStorage {
    struct Failure: Error {}
    func getItem(_ key: String) throws -> String? { throw Failure() }
    func setItem(_ key: String, _ value: String) throws { throw Failure() }
    func removeItem(_ key: String) throws { throw Failure() }
}

/// A thread-safe log sink.
final class LogSink: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var lines: [String] = []
    var logger: I18nKeylessLogger { { [self] line in lock.withLock { lines.append(line) } } }
}

enum Vectors {
    /// `ports/swift/Tests/I18nKeylessTests/Support/Transports.swift` -> `conformance/vectors`.
    static let directory: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("conformance/vectors")

    static var available: Bool { FileManager.default.fileExists(atPath: directory.path) }

    static func load(_ name: String) throws -> [String: Any] {
        let data = try Data(contentsOf: directory.appendingPathComponent("\(name).json"))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    static func rawText(_ name: String) throws -> String {
        try String(contentsOf: directory.appendingPathComponent("\(name).json"), encoding: .utf8)
    }

    static func cases(_ vector: [String: Any], _ field: String = "cases") -> [[String: Any]] {
        vector[field] as? [[String: Any]] ?? []
    }

    static func name(_ c: [String: Any]) -> String {
        c["name"] as? String ?? String(data: StubURLProtocol.json(c["input"] ?? NSNull()), encoding: .utf8)!
    }
}

func lang(_ code: Any?) -> Lang { Lang(code: code as? String)! }

let deviceIdPattern = try! NSRegularExpression(pattern: "^[0-9A-Z_a-z]{16}$")

func isDeviceId(_ value: String?) -> Bool {
    guard let value = value else { return false }
    return deviceIdPattern.firstMatch(in: value, range: NSRange(location: 0, length: (value as NSString).length)) != nil
}

/// The vectors' `replace` maps are JSON objects whose key order matters (first placeholder
/// wins at one position): recover it from the file text, which `JSONSerialization` loses.
func orderedReplace(_ map: [String: Any]?, in caseText: String) -> KeyValuePairs<String, String>? {
    guard let map = map else { return nil }
    let ordered = map.keys.sorted { a, b in
        let quoted = { (key: String) -> String in
            String(data: StubURLProtocol.json([key]), encoding: .utf8)!.dropFirst().dropLast() + ":"
        }
        let ia = caseText.range(of: quoted(a))?.lowerBound ?? caseText.endIndex
        let ib = caseText.range(of: quoted(b))?.lowerBound ?? caseText.endIndex
        return ia < ib
    }
    return KeyValuePairs(pairs: ordered.map { ($0, map[$0] as! String) })
}

extension KeyValuePairs where Key == String, Value == String {
    /// Builds the ordered pairs from an array (the literal form is the only public one).
    init(pairs: [(String, String)]) {
        // `KeyValuePairs` has no array initialiser; go through its literal conformance.
        self = Self.fromPairs(pairs)
    }

    private static func fromPairs(_ pairs: [(String, String)]) -> KeyValuePairs<String, String> {
        // A dictionary literal cannot be built at runtime; a `switch` on the count keeps
        // this tiny for the vector sizes we replay (at most two pairs, plus the empty map).
        switch pairs.count {
        case 0: return [:]
        case 1: return [pairs[0].0: pairs[0].1]
        case 2: return [pairs[0].0: pairs[0].1, pairs[1].0: pairs[1].1]
        case 3: return [pairs[0].0: pairs[0].1, pairs[1].0: pairs[1].1, pairs[2].0: pairs[2].1]
        default: fatalError("orderedReplace: extend fromPairs for \(pairs.count) pairs")
        }
    }
}

func optionsOf(_ raw: Any?, caseText: String = "") -> TranslationOptions {
    let o = raw as? [String: Any] ?? [:]
    var forced: [Lang: String]?
    if let map = o["forceTemporary"] as? [String: String] {
        forced = Dictionary(uniqueKeysWithValues: map.map { (lang($0.key), $0.value) })
    }
    return TranslationOptions(
        context: o["context"] as? String,
        namespace: o["namespace"] as? String,
        unpersistedNamespace: o["unpersistedNamespace"] as? Bool == true,
        forceTemporary: forced,
        replace: orderedReplace(o["replace"] as? [String: Any], in: caseText),
        originLanguage: (o["originLanguage"] as? String).map { lang($0) })
}

/// The text of one vector case, for the ordered-replace recovery.
func caseText(_ vectorName: String, _ c: [String: Any]) -> String {
    guard let name = c["name"] as? String, let text = try? Vectors.rawText(vectorName) else { return "" }
    let marker = "\"name\": " + String(data: StubURLProtocol.json([name]), encoding: .utf8)!.dropFirst().dropLast()
    guard let start = text.range(of: marker)?.upperBound else { return "" }
    let rest = text[start...]
    let end = rest.range(of: "\"name\": ")?.lowerBound ?? rest.endIndex
    return String(rest[..<end])
}

func configFrom(
    _ raw: [String: Any], transportConfiguration: URLSessionConfiguration, storage: I18nKeylessStorage? = nil,
    server: Bool = false, initWithDefault: Lang? = nil, handleTranslate: HandleTranslate? = nil,
    getAllTranslations: GetAllTranslations? = nil, sendTranslationsUsage: SendTranslationsUsage? = nil,
    logger: I18nKeylessLogger? = nil
) -> I18nKeylessConfig {
    let languages = raw["languages"] as! [String: Any]
    return I18nKeylessConfig(
        apiKey: raw["API_KEY"] as! String,
        languages: LanguagesConfig(
            primary: lang(languages["primary"]),
            supported: (languages["supported"] as! [String]).map { lang($0) },
            initWithDefault: initWithDefault),
        apiURL: raw["API_URL"] as? String,
        defaultNamespace: raw["defaultNamespace"] as? String,
        storage: storage ?? MemoryStorage(),
        server: server,
        handleTranslate: handleTranslate,
        getAllTranslations: getAllTranslations,
        sendTranslationsUsage: sendTranslationsUsage,
        urlSessionConfiguration: transportConfiguration,
        logger: logger ?? { _ in })
}

/// Exact header set: every expected header present with its value, and no other. The
/// vectors are the react package's: `react-client` is this port's device label and
/// `react-server` / `node` its server label. `Content-Length` is HTTP framing that
/// `URLSession` adds to every body, not a header the SDK sets: it is not counted.
func expectHeaders(_ request: StubURLProtocol.Request, _ expected: [String: Any], file: StaticString = #filePath, line: UInt = #line) {
    let actual = Dictionary(uniqueKeysWithValues: request.headers.map { ($0.key.lowercased(), $0.value) })
        .filter { $0.key != "content-length" }
    for (name, value) in expected {
        let got = actual[name.lowercased()]
        switch value as? String {
        case "$SDK_VERSION":
            XCTAssertEqual(got, I18nKeylessVersion.string, "header \(name)", file: file, line: line)
        case "react-client" where name.lowercased() == "sdk":
            XCTAssertEqual(got, I18nKeylessRuntime.client, "header \(name)", file: file, line: line)
        case "react-server" where name.lowercased() == "sdk", "node" where name.lowercased() == "sdk":
            XCTAssertEqual(got, I18nKeylessRuntime.server, "header \(name)", file: file, line: line)
        case "$DEVICE_ID":
            XCTAssertTrue(isDeviceId(got), "header \(name): \(got ?? "nil")", file: file, line: line)
        default:
            XCTAssertEqual(got, value as? String, "header \(name)", file: file, line: line)
        }
    }
    XCTAssertEqual(Set(actual.keys), Set(expected.keys.map { $0.lowercased() }), "exact header set (\(request.method) \(request.url))", file: file, line: line)
}

/// The error string this port produces for a failed status. `HTTPURLResponse` has no
/// reason phrase, so where the vector's `statusText` is empty the port answers the
/// standard phrase of the code when there is one (documented divergence, README).
func portError(status: Int, statusText: String) -> String {
    statusText.isEmpty ? ApiClient.httpErrorMessage(status) : statusText
}

func jsonEqual(_ a: Any?, _ b: Any?) -> Bool {
    guard let a = a, let b = b else { return a == nil && b == nil }
    return (a as? NSObject)?.isEqual(b) ?? false
}

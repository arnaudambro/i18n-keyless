import Foundation
import XCTest
import I18nKeyless
@testable import App

final class AppTests: XCTestCase {
    /// The example's store, offline, against a stub that returns canned English.
    func testConfigureResolvesAfterASwitch() async throws {
        let dictionary = ["Accueil": "Home", "À propos": "About"]
        StubTransport.register(apiKey: "demo", dictionary: dictionary)
        var config = Demo.makeConfig(storage: MemoryStorage())
        config.apiURL = "https://api.test"
        config.urlSessionConfiguration = StubTransport.sessionConfiguration()
        let client = I18nKeyless()
        try client.configure(config)
        XCTAssertEqual(client.currentLanguage, .fr)
        // In the primary language the source string is the value.
        XCTAssertEqual(client.t("Accueil"), "Accueil")
        await client.waitForIdle()
        await client.setLanguage(.en)
        XCTAssertEqual(client.currentLanguage, .en)
        XCTAssertEqual(client.t("Accueil"), "Home")
        XCTAssertEqual(client.t("À propos"), "About")
    }

    func testTheDemoConfigDefaultsToTheMockBackend() {
        let config = Demo.makeConfig()
        XCTAssertEqual(config.apiKey, "demo")
        XCTAssertEqual(config.apiURL, "http://localhost:8787")
        XCTAssertEqual(config.languages.primary, .fr)
        XCTAssertEqual(config.languages.supported, [.fr, .en, .es])
    }
}

/// A minimal `URLProtocol` stub for the example test: every GET returns the dictionary.
final class StubTransport: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var dictionaries: [String: [String: String]] = [:]

    static func register(apiKey: String, dictionary: [String: String]) {
        lock.lock(); dictionaries[apiKey] = dictionary; lock.unlock()
    }

    static func sessionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubTransport.self]
        return configuration
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let key = (request.value(forHTTPHeaderField: "Authorization") ?? "").replacingOccurrences(of: "Bearer ", with: "")
        let dictionary = Self.lock.withLock { Self.dictionaries[key] ?? [:] }
        let body: [String: Any]
        if request.httpMethod == "GET" {
            body = ["ok": true, "data": ["translations": dictionary, "uniqueId": NSNull(), "lastRefresh": "1"], "error": "", "message": ""]
        } else {
            body = ["ok": true, "data": ["translation": [String: String]()], "error": "", "message": ""]
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: body))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock(); defer { unlock() }
        return try body()
    }
}

import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A `URLProtocol` that answers from a handler registered per API key: every request of
/// the SDK carries `Authorization: Bearer <key>`, so tests can run in parallel, each with
/// its own transport, through one process-wide registry.
final class StubURLProtocol: URLProtocol {
    struct Request: @unchecked Sendable {
        let method: String
        let url: URL
        let headers: [String: String]
        let body: Data?

        var path: String { url.path }
        var json: Any? { body.flatMap { try? JSONSerialization.jsonObject(with: $0) } }
        func header(_ name: String) -> String? {
            headers.first { $0.key.lowercased() == name.lowercased() }?.value
        }
    }

    enum Outcome: @unchecked Sendable {
        case response(status: Int, headers: [String: String] = [:], body: Data? = nil)
        case error(String)
        /// Never answers: the client's timeout must fire.
        case hang
    }

    typealias Handler = @Sendable (Request) async -> Outcome

    private static let lock = NSLock()
    nonisolated(unsafe) private static var registry: [String: Handler] = [:]

    static func register(apiKey: String, _ handler: @escaping Handler) {
        lock.lock(); registry[apiKey] = handler; lock.unlock()
    }

    /// A session configuration that routes every request through this stub. The
    /// connection limit is raised so 31 concurrent requests are really concurrent.
    static func sessionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        configuration.httpMaximumConnectionsPerHost = 100
        return configuration
    }

    static func json(_ object: Any) -> Data {
        try! JSONSerialization.data(withJSONObject: object)
    }

    static func envelope(_ data: Any) -> Data {
        json(["ok": true, "data": data, "error": "", "message": ""])
    }

    private var loading: Task<Void, Never>?

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let request = self.request
        let body = request.httpBody ?? request.httpBodyStream.map(Self.readAll)
        let stub = Request(
            method: request.httpMethod ?? "GET", url: request.url!,
            headers: request.allHTTPHeaderFields ?? [:], body: body)
        let key = stub.header("Authorization").map { String($0.dropFirst("Bearer ".count)) } ?? ""
        let handler: Handler? = Self.lock.withLock { Self.registry[key] }
        guard let handler = handler else {
            client?.urlProtocol(self, didFailWithError: NSError(
                domain: "StubURLProtocol", code: 404,
                userInfo: [NSLocalizedDescriptionKey: "no stub registered for key \(key)"]))
            return
        }
        loading = Task { [weak self] in
            let outcome = await handler(stub)
            guard let self = self, !Task.isCancelled else { return }
            switch outcome {
            case .response(let status, let headers, let body):
                let response = HTTPURLResponse(
                    url: stub.url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
                self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                if let body = body { self.client?.urlProtocol(self, didLoad: body) }
                self.client?.urlProtocolDidFinishLoading(self)
            case .error(let message):
                self.client?.urlProtocol(self, didFailWithError: NSError(
                    domain: "StubURLProtocol", code: 1, userInfo: [NSLocalizedDescriptionKey: message]))
            case .hang:
                try? await Task.sleep(nanoseconds: .max)
            }
        }
    }

    override func stopLoading() {
        loading?.cancel()
    }

    private static func readAll(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}

extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock(); defer { unlock() }
        return try body()
    }
}

/// A gate several tasks wait on until a test opens it (the queue scenarios).
final class AsyncGate: @unchecked Sendable {
    private let lock = NSLock()
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        await withCheckedContinuation { continuation in
            let resumeNow: Bool = lock.withLock {
                if opened { return true }
                waiters.append(continuation)
                return false
            }
            if resumeNow { continuation.resume() }
        }
    }

    func open() {
        let toResume: [CheckedContinuation<Void, Never>] = lock.withLock {
            opened = true
            let waiters = self.waiters
            self.waiters = []
            return waiters
        }
        for waiter in toResume { waiter.resume() }
    }
}

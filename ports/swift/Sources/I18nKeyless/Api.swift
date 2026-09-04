import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Waits a number of milliseconds. Injectable so tests replay the backoff schedule
/// without waiting.
public typealias Sleep = @Sendable (Int) async -> Void

/// One HTTP answer, already reduced to what the client needs. Never throws.
public struct ApiResult {
    /// `ok` of the JSON body on a `200`, `true` on a `304`, `false` otherwise.
    public var ok: Bool
    public var statusCode: Int?
    /// The parsed JSON object of a `200`.
    public var json: [String: Any]?
    /// The `ETag` header of a `200`.
    public var etag: String?
    public var error: String
    /// The API answered `304 Not Modified`: the caller's copy is current.
    public var notModified: Bool

    public var message: String { json?["message"] as? String ?? "" }

    init(
        ok: Bool, statusCode: Int? = nil, json: [String: Any]? = nil, etag: String? = nil,
        error: String = "", notModified: Bool = false
    ) {
        self.ok = ok
        self.statusCode = statusCode
        self.json = json
        self.etag = etag
        self.error = error
        self.notModified = notModified
    }
}

extension ApiResult: @unchecked Sendable {}

/// One shared request path for every API call, with the resilience a bare request lacks:
///
/// - a timeout of 10 s per attempt (an app must never hang on a slow translation API),
/// - retries with backoff (500 ms, then 1500 ms) on network errors, timeouts, 429 and 5xx,
/// - no retry on other 4xx (a wrong key stays wrong; retrying only burns quota).
///
/// Errors never throw out of here: the caller always receives an `ApiResult` and falls
/// back to its stored translations.
public final class ApiClient: @unchecked Sendable {
    public static let defaultTimeoutMs = 10_000
    public static let defaultRetryDelaysMs = [500, 1500]

    private let session: URLSession
    private let sleep: Sleep
    let timeoutMs: Int
    let retryDelaysMs: [Int]
    private let counter = NSLock()
    private var attemptCount = 0

    /// - Parameters:
    ///   - configuration: the session configuration; `.ephemeral` by default (the SDK does
    ///     its own caching, the HTTP cache would only hide `304`s from it).
    ///   - sleep: the backoff sleeper; `Task.sleep` by default.
    ///   - timeoutMs: the per-attempt timeout.
    public init(
        configuration: URLSessionConfiguration? = nil, sleep: Sleep? = nil,
        timeoutMs: Int = ApiClient.defaultTimeoutMs,
        retryDelaysMs: [Int] = ApiClient.defaultRetryDelaysMs
    ) {
        let configuration = configuration ?? .ephemeral
        self.session = URLSession(configuration: configuration)
        self.sleep = sleep ?? { ms in try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000) }
        self.timeoutMs = timeoutMs
        self.retryDelaysMs = retryDelaysMs
    }

    /// Total attempts made through this instance, for tests.
    public var attempts: Int {
        counter.lock(); defer { counter.unlock() }
        return attemptCount
    }

    /// The status a single attempt retries on: a rate limit or a server error.
    public static func isRetryableStatus(_ status: Int) -> Bool {
        status == 429 || status >= 500
    }

    public func get(_ url: URL, headers: [String: String]) async -> ApiResult {
        await requestWithRetry("GET", url, headers: headers, body: nil)
    }

    public func post(_ url: URL, headers: [String: String], body: [String: Any]) async -> ApiResult {
        let data = try? JSONSerialization.data(withJSONObject: body)
        return await requestWithRetry("POST", url, headers: headers, body: data)
    }

    private struct TimeoutError: Error {}

    private func requestWithRetry(
        _ method: String, _ url: URL, headers: [String: String], body: Data?
    ) async -> ApiResult {
        var lastError = ""
        var lastStatus = 0
        for attempt in 0...retryDelaysMs.count {
            counter.withLock { attemptCount += 1 }
            do {
                var request = URLRequest(url: url)
                request.httpMethod = method
                request.httpBody = body
                for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
                let (data, response) = try await perform(request)
                lastStatus = response.statusCode
                // 304: the caller's copy is current. No body to parse, nothing to merge.
                if response.statusCode == 304 {
                    return ApiResult(ok: true, statusCode: 304, notModified: true)
                }
                if response.statusCode == 200 {
                    // An unparsable body on a 200 is a failed attempt, retried like a 5xx.
                    let decoded = try JSONSerialization.jsonObject(with: data)
                    let json = decoded as? [String: Any]
                    return ApiResult(
                        ok: json?["ok"] as? Bool == true, statusCode: 200, json: json,
                        etag: response.value(forHTTPHeaderField: "ETag"),
                        error: json?["error"] as? String ?? "")
                }
                lastError = Self.httpErrorMessage(response.statusCode)
                // 4xx (except 429) is not transient: answer now, do not hammer the API.
                if !Self.isRetryableStatus(response.statusCode) {
                    return ApiResult(ok: false, statusCode: response.statusCode, error: lastError)
                }
            } catch is TimeoutError {
                lastError = "timeout"
            } catch let error as URLError where error.code == .timedOut {
                lastError = "timeout"
            } catch {
                lastError = (error as NSError).localizedDescription
            }
            if attempt < retryDelaysMs.count { await sleep(retryDelaysMs[attempt]) }
        }
        return ApiResult(ok: false, statusCode: lastStatus == 0 ? nil : lastStatus, error: lastError)
    }

    /// One attempt, raced against the timeout. The race is explicit rather than
    /// `URLRequest.timeoutInterval` so the same clock applies to every transport, a stubbed
    /// `URLProtocol` included.
    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let session = self.session
        let timeoutMs = self.timeoutMs
        return try await withThrowingTaskGroup(of: (Data, HTTPURLResponse).self) { group in
            group.addTask {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                return (data, http)
            }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000)
                throw TimeoutError()
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }

    /// The error string of a failed status. `HTTPURLResponse` does not expose the reason
    /// phrase the server sent, so the standard phrase of the status code stands in for it;
    /// a status with no standard phrase reads `HTTP <code>` (protocol section 3.4).
    public static func httpErrorMessage(_ status: Int) -> String {
        reasonPhrases[status] ?? "HTTP \(status)"
    }

    private static let reasonPhrases: [Int: String] = [
        201: "Created", 202: "Accepted", 203: "Non-Authoritative Information", 204: "No Content",
        205: "Reset Content", 206: "Partial Content", 300: "Multiple Choices",
        301: "Moved Permanently", 302: "Found", 303: "See Other", 305: "Use Proxy",
        307: "Temporary Redirect", 308: "Permanent Redirect", 400: "Bad Request",
        401: "Unauthorized", 402: "Payment Required", 403: "Forbidden", 404: "Not Found",
        405: "Method Not Allowed", 406: "Not Acceptable", 407: "Proxy Authentication Required",
        408: "Request Timeout", 409: "Conflict", 410: "Gone", 411: "Length Required",
        412: "Precondition Failed", 413: "Payload Too Large", 414: "URI Too Long",
        415: "Unsupported Media Type", 416: "Range Not Satisfiable", 417: "Expectation Failed",
        418: "I'm a teapot", 421: "Misdirected Request", 422: "Unprocessable Entity",
        423: "Locked", 424: "Failed Dependency", 425: "Too Early", 426: "Upgrade Required",
        428: "Precondition Required", 429: "Too Many Requests",
        431: "Request Header Fields Too Large", 451: "Unavailable For Legal Reasons",
        500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
        503: "Service Unavailable", 504: "Gateway Timeout", 505: "HTTP Version Not Supported",
        506: "Variant Also Negotiates", 507: "Insufficient Storage", 508: "Loop Detected",
        510: "Not Extended", 511: "Network Authentication Required",
    ]
}

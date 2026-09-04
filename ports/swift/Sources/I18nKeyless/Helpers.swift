import Foundation

/// The pure functions of the protocol, exposed so the conformance vectors can call them.
extension I18nKeyless {
    /// The storage key of a translation: `"key__context"` when a context is given, the key
    /// itself otherwise (an empty context counts as none).
    public static func storageKeyFor(_ key: String, context: String? = nil) -> String {
        if let context = context, !context.isEmpty { return "\(key)__\(context)" }
        return key
    }

    /// The id of a translate task in the queue: `namespace:key`. The context and the origin
    /// language are not part of it (protocol section 15, item 1).
    public static func queueIdFor(namespace: String, key: String) -> String {
        "\(namespace):\(key)"
    }

    /// The in-memory ETag map key of one dictionary: `apiKey|lang|namespace`.
    public static func etagCacheKey(apiKey: String, lang: String, namespace: String? = nil) -> String {
        let ns = (namespace?.isEmpty ?? true) ? i18nKeylessDefaultNamespace : namespace!
        return "\(apiKey)|\(lang)|\(ns)"
    }

    /// The effective namespace of a call: the per-call `namespace`, else the config
    /// `defaultNamespace`, else the literal `default`. Empty strings fall through.
    public static func resolveNamespace(_ options: TranslationOptions?, defaultNamespace: String?) -> String {
        if let ns = options?.namespace, !ns.isEmpty { return ns }
        if let ns = defaultNamespace, !ns.isEmpty { return ns }
        return i18nKeylessDefaultNamespace
    }

    /// The origin language of a UGC key: the per-call `originLanguage` when it exists and
    /// differs from `primary`, nil otherwise (regular flow).
    public static func resolveOriginLanguage(_ options: TranslationOptions?, primary: Lang) -> Lang? {
        guard let origin = options?.originLanguage, origin != primary else { return nil }
        return origin
    }

    /// The URL of `GET /translate/:lang` (protocol section 4.2). Without an ETag the delta
    /// cursor travels as `last_refresh=` (a nil cursor is written literally as `null`, an
    /// empty one as empty); with an ETag the cursor leaves the URL. The default namespace
    /// never appears; another namespace is URL-encoded like `encodeURIComponent`.
    public static func buildDictionaryUrl(
        apiUrl: String, lang: String, lastRefresh: String? = nil, namespace: String? = nil,
        etag: String? = nil
    ) -> String {
        var namespaceQuery = ""
        if let ns = namespace, !ns.isEmpty, ns != i18nKeylessDefaultNamespace {
            namespaceQuery = "&namespace=\(encodeURIComponent(ns))"
        }
        let query: String
        if etag != nil {
            query = namespaceQuery.isEmpty ? "" : "?" + namespaceQuery.dropFirst()
        } else {
            query = "?last_refresh=\(lastRefresh ?? "null")\(namespaceQuery)"
        }
        return "\(apiUrl)/translate/\(lang)\(query)"
    }

    /// JavaScript's `encodeURIComponent`: everything but `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
    static func encodeURIComponent(_ value: String) -> String {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    /// Replaces every placeholder of `replace` in `text` in one left-to-right pass.
    /// Placeholders are literal (regex-special characters escaped); at one position the
    /// first placeholder in pair order wins; an empty replacement keeps the placeholder;
    /// replacement values are inserted verbatim and never re-scanned.
    public static func applyReplace(_ text: String, _ replace: KeyValuePairs<String, String>?) -> String {
        guard let replace = replace, !replace.isEmpty else { return text }
        let pattern = replace.map { NSRegularExpression.escapedPattern(for: $0.key) }.joined(separator: "|")
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let values = Dictionary(replace.map { ($0.key, $0.value) }, uniquingKeysWith: { first, _ in first })
        let ns = text as NSString
        var result = ""
        var cursor = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let matched = ns.substring(with: match.range)
            let replacement = values[matched] ?? ""
            result += replacement.isEmpty ? matched : replacement
            cursor = match.range.location + match.range.length
        }
        result += ns.substring(from: cursor)
        return result
    }

    /// The API's rule for the `sdk` header: `node`, `laravel`, `rails`, `python`, `go` and
    /// every label ending in `-server` are servers (no `unique_id`, counted by connection).
    public static func isServerRuntime(_ runtime: String) -> Bool {
        ["node", "laravel", "rails", "python", "go"].contains(runtime) || runtime.hasSuffix("-server")
    }

    /// A single attempt retries on this status (429 and 5xx).
    public static func isRetryableStatus(_ status: Int) -> Bool { ApiClient.isRetryableStatus(status) }

    /// True for a value usable as the `unique_id` header (1 to 64 printable ASCII characters).
    public static func isUniqueId(_ value: String?) -> Bool { UniqueId.isValid(value) }

    /// A fresh device id: 16 characters of the 63-character alphabet.
    public static func generateUniqueId() -> String { UniqueId.generate() }

    /// Today's UTC calendar date, `YYYY-MM-DD`, the usage analytics stamp.
    static func todayUTC() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }
}

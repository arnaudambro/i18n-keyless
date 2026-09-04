/// The package version, sent as the `Version` header on every request.
///
/// The API reads the major of this header to pick the dialect of the language codes it
/// answers with: `>= 3` means the v3 codes (`zh-Hans`, `cs`), anything else the v2 codes
/// (`cn`, `cz`). This port speaks v3, so it shares the JavaScript SDKs' version line
/// (`scripts/set-version.mjs` rewrites this constant with every release).
public enum I18nKeylessVersion {
    public static let string = "3.6.1"
}

/// The `sdk` header values of this port (docs/PROTOCOL.md, section 10.1).
///
/// An app is a device: it is counted by its persisted `unique_id`. A server-side Swift
/// process (Vapor, Hummingbird, a command-line tool) sets `server: true` in its config and
/// is counted by its connection, like `node`: the `-server` suffix is the rule the API
/// applies to every label.
public enum I18nKeylessRuntime {
    public static let client = "swift-client"
    public static let server = "swift-server"
}

/// The official API.
public let i18nKeylessDefaultApiUrl = "https://api.i18n-keyless.com"

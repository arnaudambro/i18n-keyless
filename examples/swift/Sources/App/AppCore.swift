import Foundation
import I18nKeyless

/// The languages and the strings the example shows. Primary is French, like every example
/// in this repository: you write source strings in French and i18n-keyless translates them.
public enum Demo {
    public static let supported: [Lang] = [.fr, .en, .es]

    /// The mock backend of the repository, so the example runs with no key:
    ///
    ///     node ../_mock-server/server.mjs      # http://localhost:8787
    ///
    /// To use the real service, set `I18N_KEYLESS_API_KEY` (and unset `I18N_KEYLESS_API_URL`).
    public static func makeConfig(storage: I18nKeylessStorage? = nil, server: Bool = false) -> I18nKeylessConfig {
        let apiKey = ProcessInfo.processInfo.environment["I18N_KEYLESS_API_KEY"] ?? "demo"
        let apiURL = ProcessInfo.processInfo.environment["I18N_KEYLESS_API_URL"]
            ?? (apiKey == "demo" ? "http://localhost:8787" : nil)
        return I18nKeylessConfig(
            apiKey: apiKey,
            languages: .init(primary: .fr, supported: supported, fallback: .en),
            apiURL: apiURL,
            storage: storage,
            server: server)
    }
}

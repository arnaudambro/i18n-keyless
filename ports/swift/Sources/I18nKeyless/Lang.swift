import Foundation

/// Every language i18n-keyless can translate into: the App Store localizations collapsed
/// onto bare language codes, plus the variants that are a different translation
/// (`zh-Hans` / `zh-Hant`, `pt-BR`, `es-MX`, `fr-CA`, `en-GB`).
///
/// The raw value is the v3 wire code (`fr`, `pt-BR`, `zh-Hans`), exactly the strings the
/// JavaScript SDKs send. `allCases` is the reference order of `AVAILABLE_LANGS`.
public enum Lang: String, CaseIterable, Codable, Hashable, Sendable {
    case ar, bn, ca
    case zhHans = "zh-Hans"
    case zhHant = "zh-Hant"
    case hr, cs, da, nl, en
    case enGB = "en-GB"
    case fi, fr
    case frCA = "fr-CA"
    case de, el, gu, he, hi, hu, id, it, ja, kn, ko, ms, ml, mr, no, or, pl, pt
    case ptBR = "pt-BR"
    case pa, ro, ru, sk, sl, es
    case esMX = "es-MX"
    case sv, ta, te, th, tr, uk, ur, vi

    /// The v3 wire code.
    public var code: String { rawValue }

    /// The App Store Connect listing slot of this language (`fr` is `fr-FR`, `pt` is `pt-PT`).
    public var appStoreLocale: String {
        switch self {
        case .ar: return "ar-SA"
        case .nl: return "nl-NL"
        case .en: return "en-US"
        case .fr: return "fr-FR"
        case .de: return "de-DE"
        case .pt: return "pt-PT"
        case .es: return "es-ES"
        default: return rawValue
        }
    }

    /// The language whose code equals `code`, case-insensitively, or nil.
    ///
    /// This is an exact match on the 48 codes. To map any BCP-47 tag (`fr-CH`, `zh_TW`,
    /// `es-419`) onto a supported language, use `resolveLang`.
    public init?(code: String?) {
        guard let code = code,
              let lang = Lang.byLowercase[code.trimmingCharacters(in: .whitespaces).lowercased()]
        else { return nil }
        self = lang
    }

    static let byLowercase: [String: Lang] = Dictionary(
        uniqueKeysWithValues: Lang.allCases.map { ($0.rawValue.lowercased(), $0) })

    /// The 48 codes, in the reference order.
    public static let availableCodes: [String] = Lang.allCases.map(\.rawValue)
}

/// The App Store Connect locale shortcode of a language: `toAppStoreLocale(.fr)` is `fr-FR`.
public func toAppStoreLocale(_ lang: Lang) -> String { lang.appStoreLocale }

/// Chinese is selected by script, not by region, so the common region tags are spelled out.
private let chineseRegionScripts: [String: Lang] = [
    "cn": .zhHans, "sg": .zhHans, "hans": .zhHans,
    "tw": .zhHant, "hk": .zhHant, "mo": .zhHant, "hant": .zhHant,
]

/// Resolves any BCP-47 locale tag (`Locale.current.identifier`, `Locale.preferredLanguages`,
/// an `Accept-Language` entry) onto a supported language, most specific match first:
///
/// ```swift
/// resolveLang("pt-BR")   // .ptBR    exact variant
/// resolveLang("pt-AO")   // .pt      no Angolan variant: the bare language
/// resolveLang("zh-TW")   // .zhHant
/// resolveLang("zh_CN")   // .zhHans  underscores are accepted
/// resolveLang("es-419")  // .esMX    Latin America
/// resolveLang("xx")      // nil
/// ```
///
/// Pass `supported` to only ever get a language you ship: a `pt-BR` device on an app that
/// only ships `pt` gets `pt`, and `fallback` answers when nothing matches.
public func resolveLang(_ tag: String?, supported: [Lang]? = nil, fallback: Lang? = nil) -> Lang? {
    let usable = supported.map(Set.init)
    for candidate in langCandidates(tag) where usable?.contains(candidate) ?? true {
        return candidate
    }
    return fallback
}

private func langCandidates(_ tag: String?) -> [Lang] {
    guard let tag = tag else { return [] }
    let normalized = tag.replacingOccurrences(of: "_", with: "-")
        .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalized.isEmpty { return [] }
    let parts = normalized.split(separator: "-").map(String.init)
    let language = parts.first ?? normalized
    let region = parts.last ?? normalized
    var candidates: [Lang] = []
    func push(_ lang: Lang?) {
        if let lang = lang, !candidates.contains(lang) { candidates.append(lang) }
    }
    // 1. the tag as written ("pt-BR", "zh-Hans")
    push(Lang.byLowercase[normalized])
    // 2. Chinese resolves by script and never falls back to a bare language
    if language == "zh" {
        push(chineseRegionScripts[region] ?? .zhHans)
        return candidates
    }
    // 3. UN M49 code for Latin America, which is what the es-MX slot covers
    if normalized == "es-419" { push(.esMX) }
    // 4. the bare language ("pt-AO" -> "pt")
    push(Lang.byLowercase[language])
    return candidates
}

#if canImport(SwiftUI)
import SwiftUI

/// A `Text` whose content is translated: `I18nKeylessText("Bonjour")`.
///
/// Renders the source text at once, then the translation as soon as it lands in the cache
/// or the language changes. The source text is trimmed before it becomes the key (the
/// component path of the protocol); a debug build warns once per text that carried
/// surrounding whitespace.
///
/// ```swift
/// I18nKeylessText("Bonjour {name}", replace: ["{name}": user.name]).font(.title)
/// I18nKeylessText("8 heures", context: "durée")
/// ```
public struct I18nKeylessText: View {
    @ObservedObject private var store: I18nKeyless
    private let text: String
    private let options: TranslationOptions

    public init(
        _ text: String, context: String? = nil, namespace: String? = nil,
        replace: KeyValuePairs<String, String>? = nil, forceTemporary: [Lang: String]? = nil,
        originLanguage: Lang? = nil, unpersistedNamespace: Bool = false, debug: Bool = false,
        store: I18nKeyless = .shared
    ) {
        self.store = store
        self.text = text
        self.options = TranslationOptions(
            context: context, namespace: namespace, unpersistedNamespace: unpersistedNamespace,
            debug: debug, forceTemporary: forceTemporary, replace: replace,
            originLanguage: originLanguage)
    }

    public var body: some View {
        Text(I18nKeyless.resolveText(store, text, options))
    }
}

extension I18nKeyless {
    private static let warnedLock = NSLock()
    nonisolated(unsafe) private static var warnedAboutWhitespace: Set<String> = []

    /// The whitespace rule of `<I18nKeylessText>`: trim, and warn once per text in a
    /// debug build (it would otherwise change the key).
    static func resolveText(_ store: I18nKeyless, _ text: String, _ options: TranslationOptions) -> String {
        let source = text.trimmingCharacters(in: .whitespacesAndNewlines)
        #if DEBUG
        if source != text {
            warnedLock.lock()
            let first = warnedAboutWhitespace.insert(text).inserted
            warnedLock.unlock()
            if first {
                print("i18n-keyless received text with leading/trailing whitespace: \"\(text)\". "
                    + "This may cause inconsistencies in translations. Consider trimming the text.")
            }
        }
        #endif
        return store.translate(source, options)
    }

    /// The component path as a string, for a `navigationTitle`, a `Label`, an
    /// accessibility label: trims like `I18nKeylessText`. Read it inside a view that
    /// observes the store (`@ObservedObject var i18n = I18nKeyless.shared`) so it
    /// re-renders when the translation lands.
    public func text(_ text: String, _ options: TranslationOptions = TranslationOptions()) -> String {
        Self.resolveText(self, text, options)
    }
}
#endif

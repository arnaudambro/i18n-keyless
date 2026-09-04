#if canImport(SwiftUI)
import SwiftUI
import I18nKeyless

/// A two-screen SwiftUI app: `I18nKeylessText`, `I18nKeyless.t(...)`, `context`, `replace`
/// and a language switcher. Build it into an iOS/macOS app target, or run the CLI target to
/// exercise the same store headless.
public struct DemoApp: App {
    public init() {
        try? I18nKeyless.configure(Demo.makeConfig())
    }

    public var body: some Scene {
        WindowGroup { RootView() }
    }
}

public struct RootView: View {
    @ObservedObject private var i18n = I18nKeyless.shared

    public init() {}

    public var body: some View {
        TabView {
            HomeScreen().tabItem { Text(i18n.text("Accueil")) }
            AboutScreen().tabItem { Text(i18n.text("À propos")) }
        }
        .overlay(alignment: .topTrailing) { LanguageButton() }
    }
}

struct LanguageButton: View {
    @ObservedObject private var i18n = I18nKeyless.shared

    var body: some View {
        Button {
            let next = Demo.supported[(Demo.supported.firstIndex(of: i18n.currentLanguage).map { $0 + 1 } ?? 0) % Demo.supported.count]
            Task { await I18nKeyless.setLanguage(next) }
        } label: {
            I18nKeylessText("Changer de langue").padding(8)
        }
    }
}

struct HomeScreen: View {
    @ObservedObject private var i18n = I18nKeyless.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            I18nKeylessText("Langue : {{current_lang}}", replace: ["{{current_lang}}": i18n.currentLanguage.code])
                .font(.title)
            I18nKeylessText("Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.")
            // Two contexts of the same string become two distinct translations.
            I18nKeylessText("8 heures", context: "heure")
            I18nKeylessText("8 heures", context: "durée")
        }
        .padding()
    }
}

struct AboutScreen: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            I18nKeylessText("À propos de cette démo").font(.title)
            // The function path: a plain string, no view of its own.
            Text(I18nKeyless.t("Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>."))
        }
        .padding()
    }
}
#endif

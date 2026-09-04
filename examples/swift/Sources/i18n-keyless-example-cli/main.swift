// Runs the example's store headless: configure, render a few strings, switch language,
// render again. Against the mock backend (default) or the real service (set
// `I18N_KEYLESS_API_KEY`). This is what the example's test drives too.
import Foundation
import I18nKeyless
import App

let client = I18nKeyless()
try client.configure(Demo.makeConfig(storage: MemoryStorage()))

func show(_ label: String) {
    print("[\(client.currentLanguage.code)] \(label): "
        + client.t(label))
}

print("configured, primary fr, current \(client.currentLanguage.code)")
for label in ["Accueil", "À propos", "Changer de langue"] { show(label) }

await client.setLanguage(.en)
await client.waitForIdle()
print("--- switched to en ---")
for label in ["Accueil", "À propos", "Changer de langue"] { show(label) }
print("current language: \(client.currentLanguage.code)")

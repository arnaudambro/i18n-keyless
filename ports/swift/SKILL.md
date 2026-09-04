---
name: i18n-keyless-swift
description: Install and use I18nKeyless, the keyless i18n SDK for Swift and SwiftUI where the source string itself is the translation key. No .strings / .xcstrings files, no key names, AI translations at runtime. Use when adding, configuring or debugging internationalization / translations / multi-language support in a Swift, SwiftUI, iOS, macOS or server-side Swift project, or when the project already depends on I18nKeyless (SwiftPM `i18n-keyless-swift`).
license: MIT
---

# I18nKeyless (Swift)

Translate a Swift or SwiftUI app without translation keys. You write the string in your
primary language, wrap it in `I18nKeylessText(...)`, and the SDK resolves it at runtime:
cache hit, instant; cache miss, the server generates the translation with AI, stores it, and
pushes it to the device cache. One API call per string, ever, for all users worldwide.

**Version covered: 3.6.1 (protocol v3, `docs/PROTOCOL.md`).**

## Decide first

| Target | Runtime | Notes |
| --- | --- | --- |
| iOS / macOS / tvOS / watchOS / visionOS app | device (`swift-client`) | `UserDefaultsStorage()`, a persisted `unique_id`, usage analytics |
| Server-side Swift (Vapor, a CLI, a build step) | server (`swift-server`) | `server: true`: `MemoryStorage()`, no id, no usage |

An API key is required: https://i18n-keyless.com/#get-api-key

## Install (SwiftPM)

```swift
.package(url: "https://github.com/arnaudambro/i18n-keyless-swift.git", from: "3.6.1")
// target dependency: "I18nKeyless"
```

Configure once, at launch, before the first view renders:

```swift
import I18nKeyless

@main
struct MyApp: App {
    init() {
        try? I18nKeyless.configure(.init(
            apiKey: "YOUR_API_KEY",
            languages: .init(
                primary: .fr,               // the language the source code is written in
                supported: [.fr, .en],      // what the user can switch to
                fallback: .en)))            // optional
    }
    var body: some Scene { WindowGroup { ContentView() } }
}
```

`configure` returns once the cache is hydrated from storage; the network runs in the
background. It throws `I18nKeylessError.apiKeyRequired` on an empty key.

## Use it

### Two paths, pick per site

```swift
// 1. SwiftUI view: the default. A Text that re-renders on its own when the translation lands.
I18nKeylessText("Bonjour le monde").font(.title)

// 2. String: a navigationTitle, an accessibilityLabel, a value passed elsewhere. Read it in
//    a view that observes the store (@ObservedObject var i18n = I18nKeyless.shared) so it
//    re-renders: i18n.text("Accueil").
// 3. Plain function, outside a view: I18nKeyless.t("Bienvenue") — does not trim, no subscribe.
```

`I18nKeylessText` and `text(_:)` trim the source and warn once in a DEBUG build on
surrounding whitespace. `I18nKeyless.t(_:)` and `translate(_:_:)` do not trim.

### Switch language

```swift
await I18nKeyless.setLanguage(.en)
I18nKeyless.currentLanguage             // .en
I18nKeyless.shared.supportedLanguages   // for a picker
```

### Device language at first launch

```swift
let lang = resolveLang(Locale.preferredLanguages.first, supported: [.fr, .en], fallback: .en)
// pass it as languages.initWithDefault
```

## Per-translation options

Parameters of `I18nKeylessText(...)`, `I18nKeyless.t(...)` and `translate(_:_:)`:

- `context: "durée"` — disambiguates meaning; two contexts are two translations.
- `replace: ["{name}": user.name]` — interpolation; **keys include the delimiters**; the
  pairs are ordered (first match at a position wins); regex-special characters are literal;
  an empty replacement keeps the placeholder.
- `namespace: "checkout"` — a fetch/storage partition, not a semantic key. Reserved default
  `default`; set a project-wide one with `defaultNamespace`.
- `unpersistedNamespace: true` — memory-only namespace, never persisted, never reported.
- `forceTemporary: [.en: "Hi"]` — your own translation from code, arrives with the next fetch.
- `originLanguage: .es` — the language a user-written string is in (UGC).
- `debug: true` — logs the resolution of that string.

## Server and tests

- An app is a device: `sdk: swift-client`, a persisted `unique_id`, usage analytics once per
  `configure`.
- On server-side Swift set `server: true`: `sdk: swift-server`, no id, no usage; the API
  counts the connection, like `node`. Translate-on-miss still works. The default storage is
  `MemoryStorage()`.
- In tests inject a `URLProtocol` stub through `config.urlSessionConfiguration`, create your
  own `I18nKeyless()` (not `.shared`), and `await client.waitForIdle()` before asserting.

## Languages

48 supported codes as the `Lang` enum (`.fr`, `.ptBR`, `.zhHans`). The wire code is
`lang.code`. `Lang.availableCodes` lists them; never hardcode the list. `Lang(code: "pt-BR")`
is the exact match; `resolveLang("zh_TW")` maps any BCP-47 tag (`.zhHant`);
`toAppStoreLocale(.fr)` is `fr-FR`. The v2 codes `cn` and `cz` do not exist here: the enum
spells them `.zhHans` and `.cs`, and `Version: 3.6.1` makes the API answer in that dialect.

## Gotchas

- `configure` must run before the first `I18nKeylessText` renders a translation; one rendered
  earlier shows the source text and does not throw.
- `apiKey` is required in every mode, custom handlers included.
- Source strings must be written in the `primary` language.
- No leading or trailing whitespace inside `I18nKeylessText(...)`: it changes the key.
- The SwiftUI type is `I18nKeylessText`; the engine and singleton are `I18nKeyless` /
  `I18nKeyless.shared`; the config is `I18nKeylessConfig`.
- A dashboard edit reaches cached devices at the next refresh, not instantly.
- `clearStorage()` keeps the device id: wiping it would bill one more user.
- A source string is capped at 2000 characters (`context` and `namespace` at 200). Long-form
  content is allowed, but a blog post is one translation **per Markdown block** of about 1000
  characters: keep the Markdown inside each block, give every block the same `context` (one
  short summary of the document) and one `namespace` per document.
  https://docs.i18n-keyless.com/docs/guides/long-form-content

## Operate it from your agent (MCP)

```bash
claude mcp add --transport http i18n-keyless https://api.i18n-keyless.com/mcp
```

Call `get_started` first: it returns the install steps with the project's key and languages
filled in. Guide: https://docs.i18n-keyless.com/docs/guides/mcp

## Go deeper

- `llms.txt` next to this file: the whole Swift documentation in one pasteable file.
- The protocol every SDK follows: `docs/PROTOCOL.md` in the repository.
- Docs: https://docs.i18n-keyless.com — Dashboard: https://i18n-keyless.com/dashboard
- Get an API key: https://i18n-keyless.com/#get-api-key

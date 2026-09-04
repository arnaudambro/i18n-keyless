# I18nKeyless (Swift)

Keyless i18n for Swift and SwiftUI. No `.strings` files, no `.xcstrings` catalog, no keys:
write `I18nKeylessText("Bonjour")` and ship 48 languages at runtime. Add a language without
an App Store release.

The Swift port of [i18n-keyless](https://i18n-keyless.com): the source string is the
translation key, the API translates a missing string once with AI, and every device caches
the result. Same protocol, same dashboard and same API key as the React, Vue, Node,
Laravel, Rails and Flutter SDKs.

## Quick start

```swift
try I18nKeyless.configure(.init(                               // 1. configure once, at launch
    apiKey: "YOUR_API_KEY",
    languages: .init(primary: .fr, supported: [.fr, .en])))
I18nKeylessText("Bonjour le monde")                            // 2. render a string (SwiftUI)
let title = I18nKeyless.t("Votre profil")                     // 3. or the string, anywhere
await I18nKeyless.setLanguage(.en)                             // 4. switch language
// 5. run: the first render shows "Bonjour le monde", the API translates it once, and
//    every user in English sees "Hello world" from the local cache.
```

Install with Swift Package Manager — in Xcode, *File ▸ Add Package Dependencies*, or in a
`Package.swift`:

```swift
.package(url: "https://github.com/arnaudambro/i18n-keyless-swift.git", from: "3.6.1")
```

Then add `"I18nKeyless"` to your target's dependencies. Get an API key at
https://i18n-keyless.com/#get-api-key.

> The package is published from a mirror repository,
> [`github.com/arnaudambro/i18n-keyless-swift`](https://github.com/arnaudambro/i18n-keyless-swift),
> because SwiftPM requires `Package.swift` at a repository root; the source of truth is
> `ports/swift` in the [monorepo](https://github.com/arnaudambro/i18n-keyless).

## Use it

### Two paths, pick per site

```swift
// 1. SwiftUI view: a Text that re-renders on its own when the translation lands.
I18nKeylessText("Bonjour le monde").font(.title)

// 2. String: for a navigationTitle, an accessibilityLabel, a value handed elsewhere.
//    Read it inside a view that observes the store so it re-renders.
struct Header: View {
    @ObservedObject var i18n = I18nKeyless.shared
    var body: some View { MyView().navigationTitle(i18n.text("Accueil")) }
}

// 3. Plain function, outside a view: does not trim, subscribes nothing.
let subject = I18nKeyless.t("Bienvenue")
```

`I18nKeylessText` and `text(_:)` trim the source text and warn once, in a `DEBUG` build,
when it carried surrounding whitespace. `I18nKeyless.t(_:)` and `translate(_:_:)` do not
trim.

### Switch language

```swift
await I18nKeyless.setLanguage(.en)
I18nKeyless.currentLanguage                 // .en
I18nKeyless.shared.supportedLanguages       // for a picker
```

### Device language at first launch

```swift
let tag = Locale.preferredLanguages.first          // "pt-BR"
let lang = resolveLang(tag, supported: [.fr, .en], fallback: .en)
// pass it as languages.initWithDefault
```

## Per-translation options

Parameters of `I18nKeylessText(...)`, `I18nKeyless.t(...)` and `translate(_:_:)`:

- `context`: disambiguates meaning. `t("8 heures", context: "heure")` vs
  `t("8 heures", context: "durée")` become two distinct translations.
- `replace`: interpolation. **The keys include the literal delimiters**, and the pairs are
  ordered (at one position the first that matches wins):
  `t("Bonjour {name}", replace: ["{name}": user.name])`.
- `namespace`: a fetch/storage partition, not a semantic key. Splits a large project so a
  device downloads and persists only the slice it renders. Reserved default: `default`.
  Set a project-wide one with `defaultNamespace` in the config.
- `unpersistedNamespace`: a memory-only namespace, for high-cardinality transient content
  (one per conversation, per document).
- `forceTemporary`: `[.en: "Hi there"]` overrides the AI translation from code, without
  touching the dashboard.
- `originLanguage`: for user generated content — the language *that string* is written in
  when it is not the primary one. The server translates it to the primary language, keeps
  the raw text verbatim for viewers of that language, and AI-translates the rest.
- `debug`: logs the resolution of that one string.

## Configuration (`I18nKeylessConfig`)

| Field | Default | Notes |
| --- | --- | --- |
| `apiKey` | required | Always, even with custom handlers. Sent as `Authorization: Bearer`. |
| `apiURL` | `https://api.i18n-keyless.com` | A self-hosted backend, no trailing slash. |
| `languages` | required | `.init(primary:, supported:, fallback:, initWithDefault:, skipCurrentLanguageHydration:)`. |
| `storage` | app: `UserDefaultsStorage()`, server: `MemoryStorage()` | See [Storage adapters](#storage-adapters). |
| `defaultNamespace` | `default` | Applied to every call that has no `namespace`. |
| `server` | `false` | `true` on server-side Swift (Vapor, a CLI): runtime `swift-server`, no device id, no usage analytics. |
| `handleTranslate`, `getAllTranslations`, `sendTranslationsUsage` | | Custom handlers that replace the HTTP calls, in that priority. |
| `onInit`, `onSetLanguage` | | Callbacks. |
| `urlSessionConfiguration` | `.ephemeral` | Register a `URLProtocol` stub in tests. |
| `debug`, `logger` | `false`, `print` | Logging. |

## How it works

1. `I18nKeylessText("Bonjour")` looks the string up in the local cache, synchronously.
   Hit: the translation renders. Miss: the source text renders and the string is queued (30
   in flight at most, deduplicated by `namespace:key`).
2. The queue posts each missing string to `POST /translate`. When it drains, the dictionary
   of the current language is fetched in bulk (`GET /translate/:lang`, with `ETag` /
   `If-None-Match` revalidation — a `304` keeps the cache) and merged, then persisted per
   namespace in your storage.
3. `I18nKeyless` is an `ObservableObject`: a view that renders `I18nKeylessText` or reads
   `revision` re-renders when the cache or the language changes.

A network error never throws and never clears a stored translation: 10 s timeout per
attempt, 3 attempts with a 500 ms then 1500 ms backoff on network errors, timeouts, 429 and
5xx; no retry on other 4xx.

## Identity and the `Version` header

An app is a **device**: it generates a 16-character id before the first request, persists it
under `i18n-keyless-user-id`, and sends it as `unique_id` with `sdk: swift-client`. It is
what the API counts as one user. `clearStorage()` keeps it.

A **server-side** Swift process (Vapor, Hummingbird, a command-line tool) sets `server:
true`: the runtime is `swift-server`, no device id is generated or sent, and no usage
analytics are recorded — the API counts it by its connection, like `node`. Translate-on-miss
still works.

Every request carries `Version: 3.6.1` (the package version). The API reads its major to
answer in the v3 language-code dialect (`zh-Hans`, `cs`); a major below 3 would switch it to
the legacy `cn` / `cz`.

## Storage adapters

```swift
public protocol I18nKeylessStorage: AnyObject {
    func getItem(_ key: String) throws -> String?
    func setItem(_ key: String, _ value: String) throws
    func removeItem(_ key: String) throws
}
```

`UserDefaultsStorage()` is the app default (pass a suite to share the cache with an
extension or a widget: `UserDefaultsStorage(UserDefaults(suiteName: "group.app")!)`).
`MemoryStorage()` is the server default and the test storage. Keys, identical to the
JavaScript SDKs: `i18n-keyless-user-id`, `i18n-keyless-current-language`,
`i18n-keyless-translations` (default namespace, JSON), `i18n-keyless-translations__<ns>`,
`i18n-keyless-last-refresh`, `i18n-keyless-last-refresh__<ns>`,
`i18n-keyless-translations-usage`, `i18n-keyless-namespaces`,
`i18n-keyless-origin-namespaces`.

## Languages

48 supported codes as the `Lang` enum (`.fr`, `.ptBR`, `.zhHans`). The wire code is
`lang.code`; `Lang.availableCodes` lists them all — never hardcode the list.
`Lang(code: "pt-BR")` is the exact match. `resolveLang("zh_TW")` maps any BCP-47 tag onto a
supported language (`.zhHant`). `toAppStoreLocale(.fr)` is `fr-FR`. The v2 codes `cn` and
`cz` do not exist here: the enum spells them `.zhHans` and `.cs`.

## Testing

Inject a stub transport through `urlSessionConfiguration` and `await waitForIdle()` before
asserting:

```swift
let client = I18nKeyless()
try client.configure(.init(
    apiKey: "test", languages: .init(primary: .fr, supported: [.fr, .en]),
    apiURL: "https://api.test", storage: MemoryStorage(),
    urlSessionConfiguration: myStubConfiguration))
await client.waitForIdle()
```

`I18nKeyless.shared` is the singleton the SwiftUI helpers use; create your own `I18nKeyless()`
in a test so cases stay isolated.

## Gotchas

- `configure` must run before the first `I18nKeylessText` renders a translation; one rendered
  earlier shows the source text and does not throw.
- `configure` throws `I18nKeylessError.apiKeyRequired` on an empty key, in every mode.
- Source strings must be written in the `primary` language.
- No leading or trailing whitespace inside `I18nKeylessText(...)`: it changes the key. The
  view trims and warns in a `DEBUG` build.
- A dashboard edit reaches cached devices at the next refresh, not instantly.
- After a language switch, a string with no entry in the new language shows the previous
  language's text until its translation arrives.
- Two contexts of the same string in one batch make one `POST /translate`; the second is
  translated on a later render.
- A source string is capped at 2000 characters (`context` and `namespace` at 200).
  Long-form content is allowed, but a blog post is one translation **per Markdown block** of
  about 1000 characters: keep the Markdown inside each block, give every block the same
  `context` (one short summary of the document) and one `namespace` per document.
  https://docs.i18n-keyless.com/docs/guides/long-form-content

## Operate it from your agent (MCP)

Anything a human can do in the dashboard, an agent can do through the MCP server:

```bash
claude mcp add --transport http i18n-keyless https://api.i18n-keyless.com/mcp
```

Guide: https://docs.i18n-keyless.com/docs/guides/mcp

## Links

- `llms.txt` next to this file: the whole Swift documentation in one pasteable file.
- The protocol every SDK follows: `docs/PROTOCOL.md` in the repository.
- Docs: https://docs.i18n-keyless.com — Dashboard: https://i18n-keyless.com/dashboard
- Get an API key: https://i18n-keyless.com/#get-api-key

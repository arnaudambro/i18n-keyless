---
name: i18n-keyless-kotlin
description: Install and use i18n-keyless-kotlin, the keyless i18n SDK for Kotlin and Android where the source string itself is the translation key. No strings.xml per language, no resource ids, no key names, AI translations at runtime. Use when adding, configuring or debugging internationalization / translations / multi-language support in a Kotlin, Android, Compose or Ktor project, or when the project already depends on `io.github.arnaudambro:i18n-keyless-kotlin`.
license: MIT
---

# i18n-keyless-kotlin (Kotlin, Android)

Translate a Kotlin app without translation keys. You write the string in your primary
language, pass it to `I18nKeyless.t(...)`, and the SDK resolves it at runtime: cache hit,
instant; cache miss, the server generates the translation with AI, stores it, and pushes it
to the device cache. One API call per string, ever, for all users worldwide.

**Version covered: 3.6.1 (protocol v3, `docs/PROTOCOL.md`).**

## Decide first

| Target | Config | Notes |
| --- | --- | --- |
| Android app, Compose Desktop, any app for one user | `server = false` (default) | a device: persisted id, usage analytics; `FileStorage` or a `SharedPreferences` adapter |
| Ktor, Spring, a build step | `server = true` | no id, no usage; one client per language for a multi-user server |

An API key is required: https://i18n-keyless.com/#get-api-key

## Install in one step

```kotlin
// build.gradle.kts
implementation("io.github.arnaudambro:i18n-keyless-kotlin:3.6.1")
```

Init once, in `Application.onCreate()` (Android) or `main`:

```kotlin
import io.i18nkeyless.*

I18nKeyless.init(I18nKeylessConfig(
    apiKey = "YOUR_API_KEY",
    languages = LanguagesConfig(
        primary = Lang.FR,                       // the language the source code is written in
        supported = listOf(Lang.FR, Lang.EN),    // what the user can switch to
        fallback = Lang.EN,                      // optional
    ),
    storage = FileStorage(context.filesDir.resolve("i18n-keyless")),
))
```

`init` returns a future at once; the cache is hydrated on a worker thread and the network
runs in the background. `initBlocking` waits for the hydration.

## Use it

### Two paths, pick per site

```kotlin
// 1. Component path: trims the source text. For a Compose Text or a TextView.
Text(T("Bonjour le monde"))                       // T is the 8-line composable below
textView.text = I18nKeyless.text("Bonjour le monde")

// 2. Function path: no trim, no subscription. Notifications, logs, a value handed elsewhere.
val title = I18nKeyless.t("Nouveau message")
```

Compose: wrap the listener in `produceState` once, then use `T(...)` everywhere.

```kotlin
@Composable
fun T(text: String, context: String? = null, replace: Map<String, String>? = null): String {
    val value by produceState(I18nKeyless.text(text, context = context, replace = replace), text, context, replace) {
        val listener = { value = I18nKeyless.text(text, context = context, replace = replace) }
        I18nKeyless.addListener(listener)
        awaitDispose { I18nKeyless.removeListener(listener) }
    }
    return value
}
```

### Switch language

```kotlin
I18nKeyless.setLanguage(Lang.EN)      // notifies at once, fetches the dictionary in the background
I18nKeyless.currentLanguage           // Lang.EN
I18nKeyless.supportedLanguages        // for a picker
```

### Device language at first launch

```kotlin
val tag = Locale.getDefault().toLanguageTag()                                        // "pt-BR"
val lang = resolveLang(tag, supported = listOf(Lang.FR, Lang.EN), fallback = Lang.EN)
// pass it as languages.initWithDefault
```

## Per-translation options

Named parameters of `t(...)` and `text(...)`:

- `context`: disambiguates meaning. `t("8 heures", context = "heure")` vs
  `t("8 heures", context = "durée")` become two distinct translations.
- `replace`: interpolation. **The keys include the literal delimiters**:
  `t("Bonjour {name}", replace = mapOf("{name}" to user.name))`.
- `namespace`: a fetch/storage partition, not a semantic key. Splits a large project so a
  device downloads and persists only the slice it renders. Reserved default: `default`.
  Set a project-wide one with `defaultNamespace` in the config.
- `unpersistedNamespace`: memory-only namespace, for high-cardinality transient content
  (one per discussion, per document).
- `forceTemporary`: `mapOf(Lang.EN to "Hi there")` overrides the AI translation from code,
  without touching the dashboard.
- `originLanguage`: for user generated content: the language *that string* is written in
  when it is not the primary one. The server translates it to the primary language, keeps
  the raw text verbatim for viewers of that language, and AI-translates the rest.
- `debug`: logs the resolution of that one string.

## Server and tests

- `server = true`: the client sends `sdk: kotlin-server` and no `unique_id`, records and
  sends no usage analytics, never mints a device id. Translate-on-miss still works.
- A client holds one current language. A multi-user server keeps one
  `I18nKeylessClient(server = true)` per supported language, each switched once with
  `setLanguage`. See `examples/kotlin`.
- In tests, build the client with a fake transport, `I18nKeylessClient(api =
  Api(transport = HttpTransport { request -> HttpResponse(...) }))`, and call
  `client.waitForIdle()` before asserting. No network, no key.

## Languages

48 supported codes, the App Store localizations, as the `Lang` enum (`Lang.FR`,
`Lang.PT_BR`, `Lang.ZH_HANS`). The wire code is `lang.code`. `AVAILABLE_LANGS` and
`AVAILABLE_LANG_CODES` list them; never hardcode the list.

`Lang.fromCode("pt-BR")` is the exact match. `resolveLang("zh_TW")` maps any BCP-47 tag
onto a supported language (`Lang.ZH_HANT`). `toAppStoreLocale(Lang.FR)` is `fr-FR`.

The v2 codes `cn` and `cz` do not exist here: the enum spells them `Lang.ZH_HANS` and
`Lang.CS`, and the `Version: 3.6.1` header makes the API answer in that dialect.

## Gotchas

- `t()` before `init` returns the source text (with `replace` applied) and does not throw.
- Listeners fire on a worker thread: post to the main thread before touching a view.
  Compose through `produceState` handles it.
- Source strings must be written in the `primary` language.
- `apiKey` is required in every mode, custom handlers included.
- Do not leave leading or trailing whitespace inside `t(...)`: it changes the key. `text()`
  trims and warns with `debug`.
- Translations are cached on-device. A dashboard edit reaches cached devices at the next
  refresh, not instantly.
- `clearStorage()` keeps the device id: wiping it would bill one more user.
- Zero dependencies: the library carries its own JSON codec and uses `HttpURLConnection`.
  Nothing to exclude, nothing to shade.
- A source string is capped at 2000 characters (`context` and `namespace` at 200). Long-form
  content is allowed, but a blog post is one translation **per Markdown block** of about 1000
  characters: keep the Markdown inside each block, give every block of the document the same
  `context` (one very short summary of it) and one `namespace` per document.
  https://docs.i18n-keyless.com/docs/guides/long-form-content

## Operate it from your agent (MCP)

Anything a human can do in the dashboard, you can do through the MCP server:

```bash
claude mcp add --transport http i18n-keyless https://api.i18n-keyless.com/mcp
```

Call `get_started` first: it returns the install steps with the project's key and
languages already filled in. Tools: `list_languages`, `get_project`, `list_translations`,
`translate`, `migrate_translation`, `override_translation`, `set_project_languages`, ...
Guide: https://docs.i18n-keyless.com/docs/guides/mcp

## Go deeper

- `llms.txt` next to this file: the whole Kotlin documentation in one pasteable file.
- The protocol every SDK follows: `docs/PROTOCOL.md` in the repository.
- Docs: https://docs.i18n-keyless.com
- Dashboard: https://i18n-keyless.com/dashboard
- Get an API key: https://i18n-keyless.com/#get-api-key

---
name: i18n-keyless-flutter
description: Install and use i18n_keyless, the keyless i18n SDK for Flutter where the source string itself is the translation key. No ARB files, no flutter gen-l10n, no key names, AI translations at runtime. Use when adding, configuring or debugging internationalization / translations / multi-language support in a Flutter or Dart project, or when the project already depends on `i18n_keyless`.
license: MIT
---

# i18n_keyless (Flutter)

Translate a Flutter app without translation keys. You write the string in your primary
language, wrap it in `T(...)`, and the SDK resolves it at runtime: cache hit, instant; cache
miss, the server generates the translation with AI, stores it, and pushes it to the device
cache. One API call per string, ever, for all users worldwide.

**Version covered: 3.3.0 (protocol v3, `docs/PROTOCOL.md` reference 3.3.0).**

## Decide first

| Target | Import | Notes |
| --- | --- | --- |
| Flutter app (iOS, Android, desktop, web) | `package:i18n_keyless/i18n_keyless.dart` | `SharedPreferencesStorage()` on a device |
| Dart CLI, server, build step | `package:i18n_keyless/i18n_keyless_core.dart` | no Flutter import, `sendUsage: false`, `MemoryStorage` |

An API key is required: https://i18n-keyless.com/#get-api-key

## Install in one step

```bash
flutter pub add i18n_keyless
```

Create one client, init it **before** `runApp`, wrap the app in `I18nKeylessScope`:

```dart
import 'package:flutter/material.dart';
import 'package:i18n_keyless/i18n_keyless.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final i18n = I18nKeylessClient();
  await i18n.init(I18nKeylessConfig(
    apiKey: 'YOUR_API_KEY',
    languages: const LanguagesConfig(
      primary: Lang.fr,                 // the language the source code is written in
      supported: [Lang.fr, Lang.en],    // what the user can switch to
      fallback: Lang.en,                // optional
    ),
    storage: SharedPreferencesStorage(),
  ));
  runApp(I18nKeylessScope(client: i18n, child: const MyApp()));
}
```

`init` returns once the cache is hydrated from storage; the network runs in the background.
Put the scope above `MaterialApp` so every route sees it.

## Use it

### Two paths, pick per site

```dart
// 1. Widget: the default. A Text that rebuilds on its own when the translation lands.
T('Bonjour le monde', style: Theme.of(context).textTheme.titleLarge)

// 2. String: for a hintText, a tooltip, a SnackBar, a string handed to another widget.
//    Same options as T, same resolution, rebuilds the calling widget.
TextField(decoration: InputDecoration(hintText: context.t('Votre email')))
```

Both trim the source text. Outside a widget tree, `client.getTranslation('...')` is the
plain function: it does not trim and does not subscribe anything.

### Switch language

```dart
final i18n = I18nKeyless.of(context);   // or context.i18n
i18n.setCurrentLanguage(Lang.en);
i18n.currentLanguage;                    // Lang.en
i18n.supportedLanguages;                 // for a picker
```

### Device language at first launch

```dart
final tag = WidgetsBinding.instance.platformDispatcher.locale.toLanguageTag(); // "pt-BR"
final lang = resolveLang(tag, supported: [Lang.fr, Lang.en], fallback: Lang.en);
// pass it as languages.initWithDefault
```

## Per-translation options

Named parameters of `T(...)`, `context.t(...)` and `getTranslation(...)`:

- `context`: disambiguates meaning. `T('8 heures', context: 'heure')` vs
  `T('8 heures', context: 'durée')` become two distinct translations.
- `replace`: interpolation. **The keys include the literal delimiters**:
  `T('Bonjour {name}', replace: {'{name}': user.name})`.
- `namespace`: a fetch/storage partition, not a semantic key. Splits a large project so a
  device downloads and persists only the slice it renders. Reserved default: `default`.
  Set a project-wide one with `defaultNamespace` in the config.
- `unpersistedNamespace`: memory-only namespace, for high-cardinality transient content
  (one per discussion, per document).
- `forceTemporary`: `{Lang.en: 'Hi there'}` overrides the AI translation from code, without
  touching the dashboard.
- `originLanguage`: for user generated content: the language *that string* is written in
  when it is not the primary one. The server translates it to the primary language, keeps
  the raw text verbatim for viewers of that language, and AI-translates the rest.
- `debug`: logs the resolution of that one string.

## Server and tests

- There is no SSR in Flutter. A Flutter app is a device: it sends `sdk: flutter` and a
  persisted `unique_id` on every request, and reports usage analytics once per `init`.
- On a Dart server or in a build step, use `i18n_keyless_core.dart`, `MemoryStorage()` and
  `sendUsage: false`: no usage recorded, no usage POST, translate-on-miss still works.
- In tests, pass `httpClient: MockClient(...)` (from `package:http/testing.dart`) and
  `await client.waitForIdle()` before asserting. `flutter test` needs no platform channel
  as long as you do not construct `SharedPreferencesStorage`.

## Languages

48 supported codes, the App Store localizations, as the `Lang` enum (`Lang.fr`,
`Lang.ptBR`, `Lang.zhHans`). The wire code is `lang.code`. `availableLangs` and
`availableLangCodes` list them; never hardcode the list.

`Lang.fromCode('pt-BR')` is the exact match. `resolveLang('zh_TW')` maps any BCP-47 tag
onto a supported language (`Lang.zhHant`). `toAppStoreLocale(Lang.fr)` is `fr-FR`.

The v2 codes `cn` and `cz` do not exist here: the enum spells them `Lang.zhHans` and
`Lang.cs`, and the `Version: 3.3.0` header makes the API answer in that dialect.

## Gotchas

- `init` must complete before the first `T` renders a translation; a `T` rendered earlier
  shows the source text and does not throw.
- Every `T` and `context.t()` needs an `I18nKeylessScope` above it. Missing scope: an
  assertion with the fix in its message.
- Source strings must be written in the `primary` language.
- `apiKey` is required in every mode, custom handlers included.
- Do not leave leading or trailing whitespace inside `T(...)`: it changes the key. The SDK
  trims and warns in a debug build.
- Use `const T('...')` where possible; the widget is const-constructible.
- Do not name a generic type parameter `T` in a file that imports the package, or import
  the widget with a prefix (`import ... as i18n; i18n.T('...')`).
- Translations are cached on-device. A dashboard edit reaches cached devices at the next
  refresh, not instantly.
- `clearStorageAndStore()` keeps the device id: wiping it would bill one more user.
- The widget is `T`; the inherited widget is `I18nKeyless`; the wrapper is
  `I18nKeylessScope`; the engine is `I18nKeylessClient`.
- A source string is capped at 2000 characters (`context` and `namespace` at 200). Long-form
  content is allowed, but a blog post is one translation **per Markdown block**: keep the
  Markdown inside each block, give every block of the document the same `context` — one very
  short summary of it — and one `namespace` per document.
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

- `llms.txt` next to this file: the whole Flutter documentation in one pasteable file.
- The protocol every SDK follows: `docs/PROTOCOL.md` in the repository.
- Docs: https://docs.i18n-keyless.com
- Dashboard: https://i18n-keyless.com/dashboard
- Get an API key: https://i18n-keyless.com/#get-api-key

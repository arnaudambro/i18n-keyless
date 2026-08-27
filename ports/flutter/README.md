# i18n_keyless

Keyless i18n for Flutter. No ARB files, no `flutter gen-l10n`, no keys: write `T('Bonjour')`
and ship 48 languages at runtime. Add a language without a release.

The Flutter port of [i18n-keyless](https://i18n-keyless.com): the source string is the
translation key, the API translates a missing string once with AI, and every device caches
the result. Same protocol, same dashboard and same API key as the React, React Native and
Node SDKs.

## Quick start

```dart
final i18n = I18nKeylessClient();                                              // 1. one client
await i18n.init(I18nKeylessConfig(apiKey: 'YOUR_API_KEY',                      // 2. init once
    languages: LanguagesConfig(primary: Lang.fr, supported: [Lang.fr, Lang.en]),
    storage: SharedPreferencesStorage()));
runApp(I18nKeylessScope(client: i18n, child: const MyApp()));                  // 3. wrap the app
T('Bonjour le monde');                                                         // 4. render a string
I18nKeyless.of(context).setCurrentLanguage(Lang.en);                           // 5. switch language
```

Install: `flutter pub add i18n_keyless`. Get an API key at
https://i18n-keyless.com/#get-api-key. Then `flutter run`: the first render shows
`Bonjour le monde`, the API translates it once, and every user in English sees `Hello
world` from the local cache.

## How it works

1. `T('Bonjour')` looks the string up in the local cache, synchronously. Hit: the
   translation renders. Miss: the source text renders and the string is queued.
2. The queue posts each missing string to `POST /translate` (30 in flight at most, one
   request per string). When it drains, the dictionary of the current language is fetched
   in bulk (`GET /translate/:lang`, with `ETag` / `If-None-Match` revalidation) and merged
   into the cache, which is persisted in your storage.
3. Every `T` and `context.t()` below the `I18nKeylessScope` rebuilds when the cache or the
   language changes.

A network error never throws and never clears a stored translation: 10 s timeout per
attempt, 3 attempts with a 500 ms then 1500 ms backoff on network errors, 429 and 5xx, no
retry on other 4xx.

## API

### `I18nKeylessClient`

| Member | What it does |
| --- | --- |
| `init(I18nKeylessConfig)` | Validates the config, hydrates the cache from storage, then starts the bulk fetch and the usage POST in the background. Returns once the cache is hydrated. |
| `getTranslation(text, {context, namespace, replace, unpersistedNamespace, forceTemporary, originLanguage, debug})` | Synchronous lookup with translate-on-miss. Never throws; returns `text` until the translation lands. Does not trim. |
| `translate(text, TranslationOptions)` | The same with an options object. |
| `setCurrentLanguage(Lang)` | Switches the language (an unsupported one falls back to `languages.fallback`), notifies at once, fetches the new dictionary. |
| `currentLanguage`, `primaryLanguage`, `supportedLanguages` | The state. |
| `changes` (`Stream<void>`), `addListener` / `removeListener` | Fire on every translation or language change. |
| `waitForIdle()` | Completes when no request or storage write is pending (tests, splash screens). |
| `clearStorageAndStore()` | Removes the cache from storage and memory. Keeps the device id and the config. |
| `dispose()` | Releases the HTTP client and listeners. |

### `I18nKeylessConfig`

| Field | Default | Notes |
| --- | --- | --- |
| `apiKey` | required | Always, even with custom handlers. Sent as `Authorization: Bearer`. |
| `apiUrl` | `https://api.i18n-keyless.com` | A self-hosted backend, no trailing slash. |
| `languages` | required | `LanguagesConfig(primary, supported, fallback, initWithDefault, skipCurrentLanguageHydration)`. |
| `storage` | `MemoryStorage()` | `SharedPreferencesStorage()` on a device. See [Storage adapters](#storage-adapters). |
| `defaultNamespace` | `default` | Applied to every call that has no `namespace`. |
| `sendUsage` | `true` | `false` neither records nor sends usage analytics (the `ssr: true` of the JavaScript SDKs). Translate-on-miss still works. |
| `handleTranslate`, `getAllTranslations`, `sendTranslationsUsage` | | Custom handlers: they replace the HTTP calls, in that priority. |
| `onInit(lang)`, `onSetLanguage(lang)` | | Callbacks. |
| `httpClient` | `http.Client()` | Inject a `MockClient` in tests. |
| `debug`, `logger` | `false`, `print` | Logging. |

### Widgets

```dart
// A Text whose content is translated. Every Text layout parameter is accepted.
T('Bonjour {name}', replace: {'{name}': user.name}, style: theme.textTheme.titleLarge)

// The string itself: hint texts, tooltips, snack bars, other widgets.
TextField(decoration: InputDecoration(hintText: context.t('Votre email')))

// The client: language switcher, current language.
final i18n = I18nKeyless.of(context);   // or context.i18n
i18n.setCurrentLanguage(Lang.en);
i18n.currentLanguage;                    // Lang.en
```

`T` and `context.t()` trim the source text and, in a debug build, warn once per text that
carried leading or trailing whitespace (it would change the key). `getTranslation` does not
trim.

### Per-translation options

Named parameters of `T(...)`, `context.t(...)` and `getTranslation(...)`:

- `context`: disambiguates meaning. `T('8 heures', context: 'heure')` and
  `T('8 heures', context: 'durée')` are two translations, stored as `8 heures__heure` and
  `8 heures__durée`.
- `replace`: interpolation. The keys include the delimiters:
  `replace: {'{name}': user.name}`. Regex-special characters are literal. An empty
  replacement leaves the placeholder in place.
- `namespace`: a fetch/storage partition, not a semantic key. A client downloads and
  persists only the namespaces it renders. Reserved default: `default`.
- `unpersistedNamespace`: memory-only namespace, for high-cardinality transient content
  (one per discussion). Never persisted, never reported in usage.
- `forceTemporary`: `{Lang.en: 'Hi there'}` overrides the AI translation from code. The
  value travels to the API; the override arrives with the next dictionary fetch.
- `originLanguage`: for user generated content, the language that string is written in
  when it is not the primary one.
- `debug`: logs the resolution of that one string.

### Languages

`Lang` is an enum of the 48 supported codes (`Lang.fr`, `Lang.ptBR`, `Lang.zhHans`); the
wire code is `lang.code`. `availableLangs` and `availableLangCodes` list them.
`Lang.fromCode('pt-BR')` is the exact match; `resolveLang('pt-AO')` maps any BCP-47 tag
onto a supported language (`Lang.pt`), with `supported` and `fallback` filters:

```dart
final device = WidgetsBinding.instance.platformDispatcher.locale.toLanguageTag();
final lang = resolveLang(device, supported: [Lang.fr, Lang.en], fallback: Lang.en);
```

`toAppStoreLocale(Lang.fr)` is `fr-FR`, the App Store Connect listing slot.

### Pure Dart

`package:i18n_keyless/i18n_keyless_core.dart` has no Flutter import: the client, the
queue, the transport, `MemoryStorage`, the languages. Use it in a Dart CLI or a server.

## Add a language without a release

Translations are not in the binary. Add `Lang.de` to `languages.supported` and ship once;
from then on:

1. Add or remove a language in the dashboard at https://i18n-keyless.com/dashboard, or
   through the MCP server (`set_project_languages`).
2. Edit any translation in the dashboard. The next dictionary fetch of every device
   receives it: at the next app launch, at the next language switch, or after the next
   missing string.

A string you add in the code is translated once, for every language, the first time any
user renders it. No ARB file to update, no `flutter gen-l10n`, no key to invent, no
review of a generated Dart file.

## Storage adapters

`I18nKeylessStorage` is three async methods:

```dart
abstract class I18nKeylessStorage {
  Future<String?> getItem(String key);
  Future<void> setItem(String key, String value);
  Future<void> removeItem(String key);
}
```

- `SharedPreferencesStorage()` (bundled, on `shared_preferences`): the default choice on a
  device. `SharedPreferencesStorage(SharedPreferencesAsync(...))` to pass your own instance.
- `MemoryStorage()`: the default when `storage` is omitted. Nothing survives a restart.
- Your own: Hive, a file, Drift, `flutter_secure_storage`. Return `null` for a missing key.

The keys and their serialisation are the ones of the JavaScript SDKs
(`i18n-keyless-translations`, `i18n-keyless-translations__<namespace>`,
`i18n-keyless-current-language`, `i18n-keyless-user-id`, ...). The device id under
`i18n-keyless-user-id` is what the API counts as one user; `clearStorageAndStore()` keeps it
on purpose.

## Server and tests

A Flutter app is a device: every request carries `sdk: flutter` and the persisted
`unique_id`. There is no server mode. To run the core on a server (a Dart backend, a
build step), set `sendUsage: false` so it records and sends no usage analytics, and use
`MemoryStorage`. The `Version` header carries the package version (`3.3.0`), which selects
the v3 dialect of the API (`zh-Hans`, `cs`).

In tests, inject `httpClient: MockClient(...)` and use `await client.waitForIdle()`.

## Example

`example/lib/main.dart` is a two-page app (`T`, `context.t`, `context`, `replace`, a
language switcher) that runs offline against the mock backend of the repository:

```bash
node ../../examples/_mock-server/server.mjs   # http://localhost:8787
cd example && flutter run
```

On an Android emulator the host is `10.0.2.2`. Set `apiUrl: 'https://api.i18n-keyless.com'`
and your `apiKey` to use the real service.

## Limitations

- Every `T` below the scope rebuilds when a translation lands or the language changes
  (an `InheritedNotifier`). Fine for a screen; a list of thousands of `T` widgets is not
  the intended use.
- The flat cache is shared across languages: after a switch, a string that has no entry in
  the new language shows the previous language's text until its translation arrives.
- Every boot in a non-primary language fetches the full dictionary of each namespace
  (the delta cursor is reset by the boot language switch; the ETag map is in memory).
- The queue id ignores the context: two contexts of the same string in one batch make one
  `POST /translate`; the second one is translated on a later render.
- A rebuild does not re-request a string already queued for the current language until
  its namespace's bulk fetch has landed (stricter than the JavaScript SDKs, fewer requests).
- The API translates in the background; a string added in production shows its source text
  to the first user who renders it.

## Links

- Docs: https://docs.i18n-keyless.com
- Protocol and conformance vectors: `docs/PROTOCOL.md`, `conformance/` in the repository
- Agent skill: `SKILL.md` next to this file; `llms.txt` for one pasteable file
- License: MIT

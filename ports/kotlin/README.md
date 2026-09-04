# i18n-keyless-kotlin

Keyless i18n for Kotlin and Android. No `strings.xml` per language, no resource ids, no
keys: write `I18nKeyless.t("Bonjour")` and ship 48 languages at runtime. Add a language
without a release.

The Kotlin port of [i18n-keyless](https://i18n-keyless.com): the source string is the
translation key, the API translates a missing string once with AI, and every device caches
the result. Same protocol, same dashboard and same API key as the React, React Native, Node,
Vue, Angular, Laravel, Rails and Flutter SDKs.

Pure JVM, **zero runtime dependencies** (`HttpURLConnection`, `java.util.concurrent`, a
built-in JSON codec): it loads in an Android app, a Compose Desktop app, a Ktor server or a
build step without pulling anything in.

## Quick start

```kotlin
implementation("io.github.arnaudambro:i18n-keyless-kotlin:3.6.1")              // 1. build.gradle.kts
I18nKeyless.initBlocking(I18nKeylessConfig(apiKey = "YOUR_API_KEY",              // 2. init once
    languages = LanguagesConfig(primary = Lang.FR, supported = listOf(Lang.FR, Lang.EN)),
    storage = FileStorage(context.filesDir.resolve("i18n-keyless"))))
I18nKeyless.t("Bonjour le monde")                                                // 3. render a string
I18nKeyless.setLanguage(Lang.EN)                                                 // 4. switch language
// 5. run: the first render shows "Bonjour le monde", every English user then sees "Hello world"
```

Get an API key at https://i18n-keyless.com/#get-api-key. The first render shows the source
text, the API translates it once, and every user in English sees `Hello world` from the local
cache.

## How it works

1. `t("Bonjour")` looks the string up in the local cache, synchronously. Hit: the
   translation is returned. Miss: the source text is returned and the string is queued.
2. The queue posts each missing string to `POST /translate` (30 in flight at most, one
   request per string, deduplicated by `namespace:key`). When it drains, the dictionary of
   the current language is fetched in bulk (`GET /translate/:lang`, with `ETag` /
   `If-None-Match` revalidation) and merged into the cache, which is persisted in your
   storage.
3. Every listener registered with `addListener` fires when the cache or the language
   changes, so a view can re-render.

A network error never throws and never clears a stored translation: 10 s timeout per
attempt, 3 attempts with a 500 ms then 1500 ms backoff on network errors, 429 and 5xx, no
retry on other 4xx. All of it runs on daemon worker threads; `t()` never blocks on the
network.

## API

### `I18nKeyless` and `I18nKeylessClient`

`I18nKeyless` is the default instance, for one project per process; every member delegates
to `I18nKeyless.client`. Create your own `I18nKeylessClient()` when a process serves several
projects or languages, or to inject a transport in a test.

| Member | What it does |
| --- | --- |
| `init(config): CompletableFuture<Unit>` | Validates the config (throws at once on a missing key), hydrates the cache from storage on a worker thread, then starts the bulk fetch and the usage POST in the background. Completes once the cache is hydrated. `initBlocking(config)` waits for it. |
| `t(text, context, namespace, replace, forceTemporary, originLanguage, unpersistedNamespace, debug)` | Synchronous lookup with translate-on-miss. Never throws; returns `text` until the translation lands. Does not trim. The function path. |
| `text(text, ...)` | The same, with the source text trimmed (the component path, for a Compose or XML binding). Warns once per text, with `debug`, when it had to trim. |
| `translate(text, TranslationOptions)` | `t` with an options object. |
| `setLanguage(Lang): CompletableFuture<Unit>` | Switches the language (an unsupported one falls back to `languages.fallback`), notifies at once, fetches the new dictionary; the future completes when it is merged. |
| `currentLanguage`, `primaryLanguage`, `supportedLanguages` | The state. |
| `addListener { }` / `removeListener` | Fire on every translation or language change, on the thread that made the change. |
| `waitForIdle()` | Blocks until no request or storage write is pending (tests, splash screens). |
| `clearStorage()` | Removes the cache from storage and memory. Keeps the device id and the config. |
| `dispose()` | Stops listening to the queue and drops the listeners. |

### `I18nKeylessConfig`

| Field | Default | Notes |
| --- | --- | --- |
| `apiKey` | required | Always, even with custom handlers. Sent as `Authorization: Bearer`. |
| `apiUrl` | `https://api.i18n-keyless.com` | A self-hosted backend, no trailing slash. |
| `languages` | required | `LanguagesConfig(primary, supported, fallback, initWithDefault, skipCurrentLanguageHydration)`. |
| `storage` | `MemoryStorage()` | `FileStorage(dir)` or a `SharedPreferences` adapter on a device. See [Storage adapters](#storage-adapters). |
| `defaultNamespace` | `default` | Applied to every call that has no `namespace`. |
| `server` | `false` | `true` on a server: `sdk: kotlin-server`, no device id, no usage analytics. See [Server](#server-ktor-spring-a-build-step). |
| `handleTranslate`, `getAllTranslations`, `sendTranslationsUsage` | | Custom handlers: they replace the HTTP calls, in that priority. Called on a worker thread. |
| `onInit(lang)`, `onSetLanguage(lang)` | | Callbacks. |
| `debug`, `logger` | `false`, `println` | Logging. |

The transport is injected on the client, not in the config: `I18nKeylessClient(api =
Api(transport = myTransport))`. `HttpTransport` is one function, `send(HttpRequest):
HttpResponse`.

### Per-translation options

Named parameters of `t(...)` and `text(...)`, or a `TranslationOptions` for `translate(...)`:

- `context`: disambiguates meaning. `t("8 heures", context = "heure")` and
  `t("8 heures", context = "durée")` are two translations, stored as `8 heures__heure` and
  `8 heures__durée`.
- `replace`: interpolation. The keys include the delimiters:
  `replace = mapOf("{name}" to user.name)`. Regex-special characters are literal. An empty
  replacement leaves the placeholder in place.
- `namespace`: a fetch/storage partition, not a semantic key. A device downloads and
  persists only the namespaces it renders. Reserved default: `default`.
- `unpersistedNamespace`: memory-only namespace, for high-cardinality transient content
  (one per discussion). Never persisted, never reported in usage.
- `forceTemporary`: `mapOf(Lang.EN to "Hi there")` overrides the AI translation from code.
  The value travels to the API; the override arrives with the next dictionary fetch.
- `originLanguage`: for user generated content, the language that string is written in
  when it is not the primary one.
- `debug`: logs the resolution of that one string.

### Languages

`Lang` is an enum of the 48 supported codes (`Lang.FR`, `Lang.PT_BR`, `Lang.ZH_HANS`); the
wire code is `lang.code`. `AVAILABLE_LANGS` and `AVAILABLE_LANG_CODES` list them.
`Lang.fromCode("pt-BR")` is the exact match; `resolveLang("pt-AO")` maps any BCP-47 tag onto
a supported language (`Lang.PT`), with `supported` and `fallback` filters:

```kotlin
val device = Locale.getDefault().toLanguageTag()                       // "pt-BR"
val lang = resolveLang(device, supported = listOf(Lang.FR, Lang.EN), fallback = Lang.EN)
// LanguagesConfig(..., initWithDefault = lang)
```

`toAppStoreLocale(Lang.FR)` is `fr-FR`, the App Store Connect listing slot.

## Android

### Storage

`FileStorage(context.filesDir.resolve("i18n-keyless"))` works everywhere. To share the
cache with `SharedPreferences`, the adapter is six lines:

```kotlin
class SharedPreferencesStorage(private val prefs: SharedPreferences) : Storage {
    override fun getItem(key: String): String? = prefs.getString(key, null)
    override fun setItem(key: String, value: String) = prefs.edit().putString(key, value).apply()
    override fun removeItem(key: String) = prefs.edit().remove(key).apply()
}
// I18nKeylessConfig(..., storage = SharedPreferencesStorage(context.getSharedPreferences("i18n-keyless", MODE_PRIVATE)))
```

### Init

Call `I18nKeyless.init(config)` from `Application.onCreate()`. It returns at once; the
hydration runs on a worker thread and the first screens render the cached translations.
Storage reads and writes happen on that worker, never on the main thread.

### Compose

Listeners fire on a worker thread. `produceState` turns them into a state a composable reads:

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

Text(T("Bonjour {name}", replace = mapOf("{name}" to user.name)))
```

### Views (XML)

`textView.text = I18nKeyless.text("Bonjour")`, and in a listener `runOnUiThread { ... }` to
refresh the screen when a translation lands or the language changes.

## Server (Ktor, Spring, a build step)

Set `server = true`. The client then sends `sdk: kotlin-server` and no `unique_id` (the API
counts the server by its connection, not as one user per process), records and sends no
usage analytics, and never mints a device id. Translate-on-miss still works. Use
`MemoryStorage` (the default) or a `FileStorage` to survive restarts.

A client holds **one** current language, like a device. A server that answers users in
several languages keeps one client per language, each `server = true`, each switched once
with `setLanguage(lang)`: they share nothing but the API key, and each fetches only its own
dictionary. `examples/kotlin` does exactly that.

## Storage adapters

`Storage` is three synchronous methods:

```kotlin
interface Storage {
    fun getItem(key: String): String?
    fun setItem(key: String, value: String)
    fun removeItem(key: String)
}
```

- `MemoryStorage()`: the default. Nothing survives a restart.
- `FileStorage(dir)`: one file per key, atomic writes. Any JVM, Android included.
- Your own: `SharedPreferences` (above), DataStore, Room, a `File` on a server.

The keys and their serialisation are the ones of the JavaScript SDKs
(`i18n-keyless-translations`, `i18n-keyless-translations__<namespace>`,
`i18n-keyless-current-language`, `i18n-keyless-user-id`, ...). The device id under
`i18n-keyless-user-id` is what the API counts as one user; `clearStorage()` keeps it on
purpose.

## Wire facts

- `Version: 3.6.1` (the library version, `VERSION`): the API answers in the v3 dialect of
  the language codes (`zh-Hans`, `cs`).
- `sdk: kotlin-client` on a device, `kotlin-server` with `server = true`.
- `unique_id`: a 16-character id generated before the first request, persisted under
  `i18n-keyless-user-id`, sent by a device only.
- The JDK adds its own transport headers (`Host`, `User-Agent`, `Accept`); the library
  adds none beyond the five of the protocol, plus `If-None-Match` when an ETag is known.

## Tests

Inject a transport and wait for the network:

```kotlin
val transport = HttpTransport { request -> HttpResponse(200, "OK", emptyMap(), """{"ok":true,"data":{"translations":{"Bonjour":"Hello"}},"error":"","message":""}""") }
val client = I18nKeylessClient(api = Api(transport))
client.initBlocking(I18nKeylessConfig(apiKey = "test", languages = LanguagesConfig(Lang.FR, listOf(Lang.FR, Lang.EN))))
client.setLanguage(Lang.EN).get()
client.waitForIdle()
assertEquals("Hello", client.t("Bonjour"))
```

The port's own suite: `./gradlew test` in `ports/kotlin`. It replays every vector of
`conformance/vectors/` (read from the repository at test time), the client end to end
against a fake transport, and the default transport against a real socket.

## Example

`examples/kotlin` is a two-page web app (`com.sun.net.httpserver`, one client per language,
`t()`, `context`, `replace`, a `?lang=` switcher) that runs offline against the mock backend
of the repository:

```bash
node examples/_mock-server/server.mjs      # http://localhost:8787
cd examples/kotlin && ./gradlew run        # http://localhost:8080
```

Set `I18N_KEYLESS_API_URL=https://api.i18n-keyless.com` and `I18N_KEYLESS_API_KEY` to use the
real service.

## Publishing

Group `io.github.arnaudambro` (a GitHub-verified namespace on the Maven Central portal),
artifact `i18n-keyless-kotlin`. `./gradlew publishToMavenLocal` builds the POM, the sources
and the javadoc jars; the release to Central goes through the portal with the signed
bundle. The version is the one shared line of the repository (`scripts/set-version.mjs`
rewrites `build.gradle.kts` and `Version.kt`).

## Limitations

- The flat cache is shared across languages: after a switch, a string that has no entry in
  the new language shows the previous language's text until its translation arrives.
- Every boot in a non-primary language fetches the full dictionary of each namespace (the
  delta cursor is reset by the boot language switch; the ETag map is in memory).
- The queue id ignores the context: two contexts of the same string in one batch make one
  `POST /translate`; the second one is translated on a later render.
- A re-render does not re-request a string already queued for the current language until
  its namespace's bulk fetch has landed (stricter than the JavaScript SDKs, fewer requests).
- The API translates in the background; a string added in production shows its source text
  to the first user who renders it.

## Links

- Docs: https://docs.i18n-keyless.com
- Protocol and conformance vectors: `docs/PROTOCOL.md`, `conformance/` in the repository
- Agent skill: `SKILL.md` next to this file; `llms.txt` for one pasteable file
- License: MIT

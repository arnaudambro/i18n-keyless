# i18n-keyless · Kotlin example

A two-page web app (`com.sun.net.httpserver`, no framework) showing
[`i18n-keyless-kotlin`](../../ports/kotlin) on a server: `t()` in a handler, `context`,
`replace`, a `?lang=` switcher, and the one-client-per-language pattern a multi-user server
needs. Primary language is French, like every example of the repository.

## Run it offline (no API key)

```bash
node ../_mock-server/server.mjs      # http://localhost:8787, in another terminal
./gradlew run                        # http://localhost:8080
```

Open http://localhost:8080/?lang=en, then `/about?lang=es`. The mock backend serves the
canned translations of [`_mock-server/fixtures.json`](../_mock-server/fixtures.json); a
string it does not know is rendered as its French source (that is what the real service
does too, until the AI has translated it).

## Run it against the real service

```bash
I18N_KEYLESS_API_URL=https://api.i18n-keyless.com I18N_KEYLESS_API_KEY=your_key ./gradlew run
```

Every French string is translated once, on its first render, and cached under
`.i18n-keyless/` (one `FileStorage` per language).

## Test

```bash
./gradlew test
```

The test boots an in-process copy of the mock backend, starts the site on a free port and
asserts the rendered HTML in three languages, the one-request-per-missing-string rule and
the server identity (`sdk: kotlin-server`, no `unique_id`, no usage POST).

## What to look at

- [`src/main/kotlin/example/App.kt`](src/main/kotlin/example/App.kt): `Site` holds one
  `I18nKeylessClient` per supported language, each `server = true` and switched once with
  `setLanguage`. A handler resolves `?lang=` with `resolveLang` (any BCP-47 tag) and renders
  with the client of that language.
- The library is consumed through `includeBuild("../../ports/kotlin")` in
  `settings.gradle.kts`, so the example always builds against the local source. A real app
  uses the published coordinates:

  ```kotlin
  implementation("io.github.arnaudambro:i18n-keyless-kotlin:3.6.1")
  ```

## The same library on Android

The device side is the default (`server = false`): a persisted device id, usage analytics,
the cache in `FileStorage(context.filesDir.resolve("i18n-keyless"))` or a `SharedPreferences`
adapter. Init in `Application.onCreate()`:

```kotlin
I18nKeyless.init(I18nKeylessConfig(
    apiKey = BuildConfig.I18N_KEYLESS_API_KEY,
    languages = LanguagesConfig(primary = Lang.FR, supported = listOf(Lang.FR, Lang.EN)),
    storage = FileStorage(filesDir.resolve("i18n-keyless")),
))
```

Compose, with the 8-line `T` composable from the [library README](../../ports/kotlin/README.md#compose):

```kotlin
Text(T("Bonjour {name}", replace = mapOf("{name}" to user.name)))
Button(onClick = { I18nKeyless.setLanguage(Lang.EN) }) { Text(T("Changer de langue")) }
```

# Changelog

## 3.8.0

- **The precompiled bundle** (`docs/PROTOCOL.md` sections 4.5 and 7.4): ship the translations
  with the app and keep the API for the misses. Export the files with the MCP `export_bundle`
  tool or `GET /translate/bundle` (`manifest.json` plus one `<namespace>/<lang>.json`), put them
  in the app's assets, and hand the manifest and a loader to `init` as
  `bundle = I18nKeylessBundle(manifest, load)` (`I18nKeylessBundle.from { path -> ... }` builds
  one over any `path -> text` reader, `context.assets` on Android; the loader runs on a worker
  thread, like the other handlers). A namespace the manifest covers in the current language is
  seeded from the file instead of fetched, at boot and on every language switch, with the
  bundle's cursor; storage wins only when newer and in the same language. A miss still POSTs,
  and the delta fetch after it starts from the seeded cursor. Nothing else changes.
  `bundleCovers` and `mergeBundleWithStorage` replay `conformance/vectors/bundle-seed.json`.

## 3.7.0

No change in the port. The version tracks the JavaScript SDKs: 3.7.0 adds plurals, ordinals and
`select` choices (ICU MessageFormat, `docs/PROTOCOL.md` section 5.4). The port stores and returns
such a cell verbatim and does not render it yet.

## 3.6.1

First release of the Kotlin port. The version tracks the JavaScript SDKs and the protocol
revision it implements: `docs/PROTOCOL.md` reference 3.6.1 (i18n-keyless-core 3.6.1).

- `I18nKeylessClient` and the `I18nKeyless` default instance: a pure-JVM port of the core and
  of the react store, zero runtime dependencies (`HttpURLConnection`, `java.util.concurrent`,
  a built-in JSON codec). Synchronous lookup, translate-on-miss queue (30 concurrent,
  deduplicated by `namespace:key`), bulk fetch with `ETag` / `If-None-Match` replay, 10 s
  timeout, 3 attempts with 500 ms and 1500 ms backoff, no retry on 4xx, never throws, never
  clears a stored translation. The network runs on daemon worker threads.
- Device id: generated before the first request, persisted under `i18n-keyless-user-id`,
  sent as `unique_id` with `sdk: kotlin-client` and `Version: 3.6.1`.
- `server = true`: `sdk: kotlin-server`, no device id, no usage analytics (the `ssr: true`
  of the JavaScript SDKs). One client per language on a multi-user server.
- Usage analytics recorded per render and sent once per `init`.
- Storage: `Storage` (three synchronous methods), `MemoryStorage`, `FileStorage` (atomic
  writes), a documented `SharedPreferences` adapter. Same keys and serialisation as
  `i18n-keyless-react`.
- `t()` (the function path), `text()` (the component path, trims), `translate(options)`,
  `setLanguage`, `addListener` / `removeListener`, `waitForIdle`, `clearStorage`.
- Languages: the `Lang` enum with the 48 v3 codes, `AVAILABLE_LANGS`, `resolveLang`,
  `toAppStoreLocale`.
- Tests: `ConformanceTest` replaying every vector of `conformance/vectors/` (device and
  `*-server` cases; the `node` runtime does not apply), `ClientTest` end to end against a
  fake transport, `HttpUrlConnectionTransportTest` against a real socket, `JsonTest`.
- Documented divergences from the reference: a re-render does not re-request a string
  already queued for the current language until its namespace's bulk fetch has landed (the
  Flutter port's rule); the JDK adds its own transport headers (`Host`, `User-Agent`,
  `Accept`) beside the five of the protocol.

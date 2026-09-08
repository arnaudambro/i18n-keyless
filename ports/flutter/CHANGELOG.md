# Changelog

## Unreleased

- **The precompiled bundle** (`docs/PROTOCOL.md` sections 4.5 and 7.4): ship the translations
  with the app and keep the API for the misses. Export the files with the MCP `export_bundle`
  tool or `GET /translate/bundle` (`manifest.json` plus one `<namespace>/<lang>.json`), declare
  them as assets, and hand the manifest and a loader to `init` as
  `bundle: I18nKeylessBundle(manifest:, load:)` (`loadI18nKeylessBundleFromAssets('assets/i18n-keyless')`
  builds one on `rootBundle`). A namespace the manifest covers in the current language is seeded
  from the file instead of fetched, at boot and on every language switch, with the bundle's
  cursor; storage wins only when newer and in the same language. A miss still POSTs, and the
  delta fetch after it starts from the seeded cursor. Nothing else changes. `bundleCovers` and
  `mergeBundleWithStorage` replay `conformance/vectors/bundle-seed.json`.

## 3.7.0

No change in the port. The version tracks the JavaScript SDKs: 3.7.0 adds plurals, ordinals and
`select` choices (ICU MessageFormat, `docs/PROTOCOL.md` section 5.4). The port stores and returns
such a cell verbatim and does not render it yet.

## 3.6.1

No change in the port. The version tracks the JavaScript SDKs: 3.6.1 makes every SDK render the source text
before `init()` instead of throwing. Protocol reference unchanged.

## 3.6.0

No change in the port. The version tracks the JavaScript SDKs: 3.6.0 adds the function form
of `useTranslation()` to `i18n-keyless-react` and makes every SDK render the source text
before `init()` instead of throwing. Protocol reference unchanged.

## 3.5.0

No change in the port. The version tracks the JavaScript SDKs: 3.5.0 adds
`awaitForTranslationOrThrow` / `awaitForTranslationOrFallbackToOriginal` to `i18n-keyless-node`
and deprecates `awaitForTranslation` there. Protocol reference unchanged.

## 3.4.0

First release of the Flutter port. The version tracks the JavaScript SDKs and the protocol
revision it implements: `docs/PROTOCOL.md` reference 3.4.0 (i18n-keyless-core 3.4.0).

- `I18nKeylessClient`: pure-Dart port of the core and of the react store. Synchronous
  lookup, translate-on-miss queue (30 concurrent, deduplicated by `namespace:key`), bulk
  fetch with `ETag` / `If-None-Match` replay, 10 s timeout, 3 attempts with 500 ms and
  1500 ms backoff, no retry on 4xx, never throws, never clears a stored translation.
- Device id: generated before the first request, persisted under `i18n-keyless-user-id`,
  sent as `unique_id` with `sdk: flutter` and `Version: 3.4.0`.
- Usage analytics recorded per render and sent once per `init`; `sendUsage: false` to
  disable (the `ssr: true` of the JavaScript SDKs).
- Storage: `I18nKeylessStorage` (three async methods), `MemoryStorage`,
  `SharedPreferencesStorage`. Same keys and serialisation as `i18n-keyless-react`.
- Flutter: `I18nKeylessScope`, `I18nKeyless.of(context)`, the `T` widget, `context.t()`,
  `context.i18n`.
- Languages: the `Lang` enum with the 48 v3 codes, `availableLangs`, `resolveLang`,
  `toAppStoreLocale`.
- Tests: `core_test.dart`, `widget_test.dart`, and `conformance_test.dart` replaying every
  vector of `conformance/vectors/` that applies to a device SDK.
- Documented divergences from the reference: a rebuild does not re-request a string
  already queued for the current language until its namespace's bulk fetch has landed;
  `sendUsage: false` keeps the device identity (`sdk: flutter`, `unique_id`) instead
  of switching to a server runtime.

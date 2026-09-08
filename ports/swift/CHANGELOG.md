# Changelog

## Unreleased

- **The precompiled bundle** (`docs/PROTOCOL.md` sections 4.5 and 7.4): ship the translations
  with the app and keep the API for the misses. Export the files with the MCP `export_bundle`
  tool or `GET /translate/bundle` (`manifest.json` plus one `<namespace>/<lang>.json`), add the
  folder to the app target, and hand the manifest and an async `load` closure to `configure` as
  `bundle: I18nKeylessBundle(manifest:load:)` (`I18nKeylessBundle.files(in:)` builds one over a
  directory of `Bundle.main`). A namespace the manifest covers in the current language is seeded
  from the file instead of fetched, at boot and on every language switch, with the bundle's
  cursor; storage wins only when newer and in the same language. A miss still POSTs, and the
  delta fetch after it starts from the seeded cursor. Nothing else changes.
  `I18nKeyless.bundleCovers` and `mergeBundleWithStorage` replay
  `conformance/vectors/bundle-seed.json`.

## 3.7.0

No change in the port. The version tracks the JavaScript SDKs: 3.7.0 adds plurals, ordinals and
`select` choices (ICU MessageFormat, `docs/PROTOCOL.md` section 5.4). The port stores and returns
such a cell verbatim and does not render it yet.

## 3.6.1

First release of the Swift port. The version tracks the JavaScript SDKs and the protocol
revision it implements: `docs/PROTOCOL.md` reference 3.6.x (i18n-keyless-core 3.6.x).

- `I18nKeyless`: a Swift port of the core and of the react store. Synchronous lookup,
  translate-on-miss queue (30 concurrent, deduplicated by `namespace:key`), bulk fetch with
  `ETag` / `If-None-Match` replay, 10 s timeout, 3 attempts with 500 ms and 1500 ms
  backoff, no retry on 4xx, never throws, never clears a stored translation. `URLSession`
  only, zero dependencies.
- Two runtimes: an app is a device (`sdk: swift-client`, a persisted `unique_id`, usage
  analytics once per configure); a server-side process sets `server: true` and is a server
  (`sdk: swift-server`, no id, no usage), like the `-server` labels of the JavaScript SDKs.
- Storage: the `I18nKeylessStorage` protocol, `UserDefaultsStorage` (the app default),
  `MemoryStorage` (the server default and the test storage). Same keys and serialisation as
  `i18n-keyless-react`.
- SwiftUI: `I18nKeylessText`, and `I18nKeyless` is an `ObservableObject` (`revision`,
  `objectWillChange` on the main thread) so a view re-renders when a translation lands or
  the language changes.
- Languages: the `Lang` enum with the 48 v3 codes, `Lang.availableCodes`, `resolveLang`,
  `toAppStoreLocale`.
- Tests: `ClientTests` (the end-to-end behaviour) and `ConformanceTests` replaying every
  vector of `conformance/vectors/` that applies (`storage-keys.json` included), against a
  stubbed `URLProtocol` transport and a fake backoff clock.
- Documented divergences from the reference: a re-render does not re-request a string
  already queued for the current language until its namespace's bulk fetch has landed; the
  error string of a failed status with no reason phrase is the code's standard phrase (the
  wire reason phrase is not exposed by `HTTPURLResponse`); `server: true` keeps no device
  identity, exactly the `react-server` runtime.

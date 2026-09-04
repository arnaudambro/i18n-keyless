# Changelog

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

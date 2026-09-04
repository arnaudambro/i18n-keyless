# Changelog

## 3.6.1

First release of the Go port. The version tracks the JavaScript SDKs and the protocol
revision it implements: `docs/PROTOCOL.md` reference 3.3.0 (i18n-keyless-core 3.6.1).

- `i18nkeyless.Init` / `New`: a port of the node SDK in standard-library Go. One in-memory
  dictionary per language loaded at `Init` (`GET /translate/`), a blocking translate-on-miss
  (`T` never fails, `Translate` returns the error), at most 30 `POST /translate` in flight,
  concurrent misses of one key deduplicated, the missed namespaces refetched when the burst
  settles, `ETag` / `If-None-Match` replay, 10 s timeout, 3 attempts with 500 ms and 1500 ms
  backoff, no retry on 4xx, never throws, never clears a stored translation.
- Per-call options: `WithContext`, `WithNamespace`, `WithReplace` / `WithReplaceOrdered`,
  `WithForceTemporary`, `WithOriginLanguage`, `WithUnpersistedNamespace`.
- Custom handlers (`HandleTranslate`, `GetAllTranslationsForAllLanguages`,
  `SendTranslationsUsage`), a self-hosted `APIURL`, or the official service.
- Usage analytics on the node rules: recorded on every call, sent at most once every 10 s,
  cumulative map, `FlushUsage` for scripts, `DisableUsage` to switch off.
- Identity: `sdk: go` (a server label, counted by connection), `Version: 3.6.1`, no
  `unique_id`.
- Pure helpers exported for the conformance vectors: `StorageKeyFor`, `QueueIDFor`,
  `ApplyReplace`, `ResolveNamespace`, `ResolveOriginLanguage`, `BuildDictionaryURL`,
  `EtagCacheKey`, `IsRetryableStatus`, `DecideStatus`, `DelayAfter`, `IsServerRuntime`,
  `ResolveLang`, `ToAppStoreLocale`, `AvailableLangs`.

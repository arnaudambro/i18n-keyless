# Changelog

## 3.6.1

First release of the Python port. The version tracks the JavaScript SDKs and the protocol
revision it implements: `docs/PROTOCOL.md` reference 3.3.0+ (i18n-keyless-core 3.6.1).

- `i18n_keyless.init()`, `t()`, `t_or_raise()`: the node SDK's behaviour in Python. One
  in-memory store per language loaded by `GET /translate/` at init, a synchronous miss
  that POSTs `/translate` and returns the answer (read from `data.translation.languages`),
  concurrent misses of one key collapsed into one request, at most 30 in flight, a bulk
  refetch of the namespaces that missed once the batch drains, ETag replay (`304` keeps the
  store), the 10 s timeout and the 500 / 1500 ms backoff on network error, timeout, `429`,
  `5xx` and unparsable bodies, nothing ever raised by `t()`.
- Usage analytics on the node rules: recorded per call, POSTed on a 10 s debounce from a
  daemon thread, cumulative, `flush_usage()` for scripts.
- `sdk: python` (a server label, registered on the API), `Version: 3.6.1`, no `unique_id`.
- The three network modes: custom handlers, `api_url`, the official service.
- `resolve_lang`, `to_app_store_locale`, `AVAILABLE_LANGS`, `apply_replace`,
  `storage_key_for`: the pure rules, replayed against every conformance vector.
- Zero dependency, Python >= 3.9, typed (`py.typed`).

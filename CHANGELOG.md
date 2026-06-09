# Changelog

All notable changes to i18n-keyless are documented here. The three packages
(`i18n-keyless-core`, `i18n-keyless-react`, `i18n-keyless-node`) share one version.

This project follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [2.1.0] — 2026-06-09

### Added — SSR for the imperative `getTranslation`

- **`runWithI18nKeyless(scope, fn)`** (`i18n-keyless-react`) — runs a server render with
  a per-request scope active so every **`getTranslation(...)`** call *and*
  `<I18nKeylessText>` rendered within it resolves in `scope.lang` using
  `scope.translations`, across `await`s and streaming, with full isolation between
  concurrent requests (via `AsyncLocalStorage`). This makes the imperative
  `getTranslation` SSR-correct **without rewriting call sites** — wrap the render once.
  Complements v2.0's `<I18nKeylessProvider>` (which only covers `<T>`).
- **`getRequestScope()`** and type **`I18nRequestScope`** (`i18n-keyless-react`) —
  exported alongside, to read the active request scope.

### Notes

- **No breaking changes; SPA-safe.** `runWithI18nKeyless` is server-only and a no-op in
  the browser. `AsyncLocalStorage` is loaded via a guarded dynamic import, so
  `node:async_hooks` never enters browser/React Native bundles (verified with an
  esbuild `--platform=browser` build). Existing `getTranslation`/`<T>` behavior is
  unchanged when no scope/provider is present.
- Requires `AsyncLocalStorage` (Node ≥ 20.10 and most edge runtimes; Cloudflare Workers
  needs a flag — where unavailable, scoping degrades to a no-op and `<I18nKeylessProvider>`
  still covers `<T>`).

## [2.0.0] — 2026-06-08

### Headline — Native SSR support

i18n-keyless now works under server-side rendering (TanStack Start, Next, Remix,
Expo Router server output, …). You can server-render in any supported language and
hydrate without a flash or mismatch.

> **No breaking changes.** This is a feature major, not a breaking one. Existing
> browser/SPA apps upgrade with **no code changes** — every previous export keeps its
> signature, and `<I18nKeylessText>` behaves identically when no SSR provider is
> present. The major version marks the significance of the SSR feature, not a
> migration. See [`docs/SSR.md`](./docs/SSR.md).

### Added

- **`<I18nKeylessProvider lang translations>`** (`i18n-keyless-react`) — per-request
  React context. `<I18nKeylessText>` ("`<T>`") reads `lang`/`translations` from it
  first and falls back to the global store when absent, so a single server render can
  produce HTML in a chosen non-primary language without leaking state across concurrent
  requests. On the client it seeds the store on mount for flash-free hydration.
- **`getServerTranslations(lang)`** (`i18n-keyless-react`) — fetches the translations
  map for `lang`, cached per process (each language fetched at most once per boot).
  Returns `{}` for the primary language and on fetch failure.
- **`clearServerTranslationsCache(lang?)`** (`i18n-keyless-react`) — evicts one or all
  languages from that cache (e.g. after publishing new translations).
- **`createMemoryStorage()`** (`i18n-keyless-react`) — in-memory storage adapter, used
  automatically as the server default and exported for explicit use.
- **`useI18nKeylessContext()`** (`i18n-keyless-react`) — read the current provider
  value (or `null` in SPA mode).
- **`ssr?: boolean`** config flag — forces read-only behavior (no usage analytics) even
  in an environment where `window` exists.
- `clearI18nKeylessStorageAndStore` is now exported from `i18n-keyless-react`.

### Changed

- **`storage` is now optional on the server.** When `storage` is absent **and**
  `typeof window === "undefined"`, `init` defaults to an in-memory adapter instead of
  throwing. In the browser a missing `storage` still throws loudly (it is a real
  misconfiguration). This removes the main SSR footgun — no more no-op storage hacks.
- **The server is read-only.** On the server (`typeof window === "undefined"`) or with
  `ssr: true`, translation-usage analytics are neither recorded nor sent. This avoids
  per-boot / per-request usage POSTs and keeps crawler renders from polluting the
  "which translations are still used" signal. **Translate-on-miss is unaffected** —
  missing keys are still requested.

### Fixed

- **`dist` is now valid native Node ESM.** Relative imports emit explicit `.js`
  extensions (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`), so the
  packages no longer throw `ERR_MODULE_NOT_FOUND` when externalized in a Node SSR
  runtime. Previously consumers needed a bundler workaround
  (`ssr.noExternal`) — that workaround is no longer required.
- JSON imports use `with { type: "json" }` import attributes, valid under native Node
  ESM.
- `i18n-keyless-node` no longer emits a broken bare `import … from "types"` (now
  `./types`).

### Upgrade notes

- **SPA / browser apps:** none. Drop-in.
- **SSR apps that used workarounds:** you can remove `ssr.noExternal` for
  `i18n-keyless-*` from your bundler config, and remove any no-op server storage — omit
  `storage` on the server and it defaults to in-memory. To server-render non-primary
  languages, wrap your tree in `<I18nKeylessProvider>` fed by `getServerTranslations`.
  See [`docs/SSR.md`](./docs/SSR.md).
- **Minimum runtime:** Node ≥ 20.10 or a modern bundler (Vite, esbuild, webpack 5,
  Rollup 3+) — required for the JSON import attributes.

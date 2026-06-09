# Changelog

All notable changes to i18n-keyless are documented here. The three packages
(`i18n-keyless-core`, `i18n-keyless-react`, `i18n-keyless-node`) share one version.

This project follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [2.3.0] — 2026-06-09

### Added — per-page SSR translation snapshot

- **`getUsedTranslationsSnapshot()`** (`i18n-keyless-react`) → `{ lang, translations } |
  undefined` — like `getRequestScope()` but `translations` contains only the keys the
  current render actually used (∩ the keys available). Serialize THIS instead of
  `getRequestScope()` to embed a per-page subset into the SSR HTML rather than the full
  language set — important for large translation sets. The full set stays in scope for
  resolution during render; only the serialized payload is narrowed.
  - `getTranslation` and `<I18nKeylessText>` record each key they touch into a per-request
    `Set` held in the AsyncLocalStorage scope — a plain `Set.add`, no store write / no
    setState (no render-time update warning), isolated between concurrent requests.

### Notes

- Additive and non-breaking: `getServerTranslations`, `getRequestScope`,
  `hydrateFromServer`, `runWithI18nKeyless` keep their signatures. SPA mode unchanged.
- **Client navigation invariant:** keep calling `init()` — the per-page subset seeds the
  first paint via `hydrateFromServer`, and `init()`'s background full fetch then fills the
  store with the complete set for client-side navigation. Use the full
  `getRequestScope()` snapshot for small sets, `getUsedTranslationsSnapshot()` for large
  ones. `node:async_hooks` stays server-only.

## [2.2.0] — 2026-06-09

Two SSR correctness fixes surfaced by a TanStack Start (React 19, streaming) app that
calls the imperative `getTranslation(key)` pervasively in render.

### Added

- **`hydrateFromServer({ lang, translations })`** (`i18n-keyless-react`) — synchronously
  seeds the store from a server snapshot **before React's first client render**, so the
  imperative `getTranslation(key)` returns the correct language on the very first render
  (no hydration mismatch, no blink). Call it in the client entry, before `hydrateRoot`,
  with the `{ lang, translations }` the server serialized into the HTML (read on the
  server from `getRequestScope()`). The component path (`<I18nKeylessText>`) is covered by
  `<I18nKeylessProvider>`; the function path needs this because a plain function can't read
  React context.

### Fixed

- **Hydration mismatch / blink with `getTranslation` (Bug 1).** On a cold cache the client
  store had the right `currentLanguage` but an empty translations map at first render, so
  `getTranslation` fell back to the primary language and React re-rendered after the async
  fetch. Fixed by `hydrateFromServer` (above); `init()`'s async `hydrate()` now treats an
  applied server snapshot as authoritative and no longer overwrites the seeded
  language/translations from storage.
- **`getTranslation` triggered a store write during render (Bug 2).** Usage recording
  (`setTranslationUsage`) ran synchronously during the caller's render, making React 19
  log "Cannot update a component while rendering a different component". Usage recording is
  now deferred to a microtask (it never needs to affect the current render). Server
  read-only behavior is unchanged.

### Notes

- No breaking changes; SPA mode unchanged (`hydrateFromServer` is opt-in; the snapshot
  flag is never set in SPA). `node:async_hooks` still stays out of browser bundles.

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

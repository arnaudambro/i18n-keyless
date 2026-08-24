# Changelog

All notable changes to i18n-keyless are documented here. The three packages
(`i18n-keyless-core`, `i18n-keyless-react`, `i18n-keyless-node`) share one version.

This project follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [3.1.0] — 2026-08-24

### Changed — `<T>` re-renders only when its own text changes (`i18n-keyless-react`)

`<I18nKeylessText>` selected the whole `translations` map. `setTranslations` rebuilds that
object on every batch that lands, so zustand's `Object.is` check always failed and **every
`<T>` on the page re-rendered** — including the ones whose text had not changed, and the
ones belonging to a different namespace. `<T>` now selects the single string it renders.

Measured on a 50-`<T>` page (`packages/react/__tests__/render-count.test.tsx`):

| Event | Before | After |
| --- | --- | --- |
| A batch lands for another namespace (chat / checkout / UGC) | 50 re-renders | 0 |
| A batch adds one new key | 50 re-renders | 1 |
| Language switch | 50 re-renders | 50 (all texts really do change) |

Apps that use namespaces, and above all apps with high-cardinality
`unpersistedNamespace` namespaces (one per discussion), gain the most. No API change.

### Docs — `getTranslation()` needs `useCurrentLanguage()` in the same component

`getTranslation` is a plain function: it reads the store once and never subscribes. The
component that calls it therefore does not re-render on a language switch, and its text
stays in the previous language — while the `<I18nKeylessText>` around it updates, because
`<T>` subscribes on its own. Call `useCurrentLanguage()` at the top of any component that
calls `getTranslation()`, even when you ignore the return value. The README and the JSDoc
now state the rule, and the ReactMarkdown recipe applies it.

## [3.0.0] — 2026-08-04

### Added — all 50 App Store localizations (19 → 48 language codes)

i18n-keyless now covers every [App Store
localization](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations/),
including the 11 languages Apple added in March 2026. 29 new languages: `bn`, `ca`, `hr`,
`da`, `fi`, `gu`, `he`, `hi`, `id`, `kn`, `ms`, `ml`, `mr`, `no`, `or`, `pa`, `sk`, `sl`,
`ta`, `te`, `th`, `uk`, `ur`, `vi`, plus the variants `zh-Hant`, `pt-BR`, `es-MX`, `fr-CA`
and `en-GB`.

**Most codes stay bare on purpose.** A bare language code matches every region of that
language — `fr` covers fr-FR, fr-CA, fr-BE and fr-CH — so adding a region *narrows* it.
Regions are used only where the translation is genuinely different text: `zh-Hans`/`zh-Hant`
(a script, not a region — Simplified and Traditional aren't mutually readable, so there is no
bare `zh`), `pt-BR`, `es-MX`, `fr-CA`, `en-GB`. You are billed per language you opt into, so
`['pt']` is one translation and `['pt', 'pt-BR']` is two.

### Added — `resolveLang`, `toAppStoreLocale` (`i18n-keyless-core`)

- **`resolveLang(tag, { supported, fallback })`** maps any BCP-47 tag — `navigator.language`,
  `Localization.getLocales()[0].languageTag`, an `Accept-Language` entry — onto a language you
  ship, most specific match first: `"pt-BR"` → `pt-BR`, `"pt-AO"` → `pt`, `"zh-TW"` →
  `zh-Hant`, `"es-419"` → `es-MX`. Underscores and any casing are accepted (`"zh_CN"`,
  `"PT-br"`). With `supported`, the walk continues to the next candidate when a more specific
  one isn't in your list, so a `pt-BR` device on an app shipping only `pt` gets `pt`.
- **`toAppStoreLocale(lang)`** maps a language onto its App Store Connect listing slot
  (`"fr"` → `"fr-FR"`, `"pt"` → `"pt-PT"`), for pushing localized metadata, screenshots or
  release notes. Also exported as the `APP_STORE_LOCALES` record. Apple's `en-AU` and `en-CA`
  slots have no dedicated language — fill them from `en`.

### Changed — `primary` accepts any supported language

`PrimaryLang` was `"fr" | "en"`; it is now every language in `AVAILABLE_LANGS`. You can write
your app in any of the 48.

### BREAKING — `cn` → `zh-Hans`, `cz` → `cs`

The only two codes that moved. Both were country codes standing in for a language; they are
now the standard ones. **The other 17 v2 codes** — `fr`, `en`, `nl`, `it`, `de`, `es`, `pl`,
`pt`, `ro`, `hu`, `sv`, `tr`, `ja`, `ru`, `ko`, `ar`, `el` — **are unchanged and travel
identically on the wire.**

Update your config:

```diff
  languages: {
    primary: 'fr',
-   supported: ['fr', 'en', 'cn', 'cz'],
+   supported: ['fr', 'en', 'zh-Hans', 'cs'],
  }
```

A `cn` or `cz` persisted by a v2 install is not recognised by v3 and falls back to
`languages.fallback`. If you run your own backend, rename the two codes in your stored data.

### Fixed — `setLanguage` fetched the requested language, not the resolved one

`setCurrentLanguage(lang)` set the store to the *validated* language but downloaded
translations for the **raw** one, so passing an unsupported code switched the UI to the
fallback while fetching a language the store never used — a wasted round-trip, and an empty
result merged into the store. It now fetches the language it switched to.

## [2.6.1] — 2026-07-22

### Fixed — crash in `getTranslationCore` with the `replace` option

- **`getTranslation(key, { replace })` threw `Cannot read properties of undefined
  (reading 'replace')`** when the current language differed from the source language and
  the translation hadn't arrived in the store yet (first render, offline, or key not yet
  translated server-side). The no-replace path already fell back to the key
  (`translation || key`); the replace path now does the same before interpolating.
  `i18n-keyless-node` was not affected (it guards on `translation` before interpolating).

## [2.4.2] — 2026-06-22

### Fixed — Metro/React Native bundling of `request-scope`

- **`i18n-keyless-react` failed to bundle under Metro (Expo / React Native)** with
  `Invalid call ... import(__rewriteRelativeImportExtension(... "node:async_hooks"))`. The
  tsconfig's `rewriteRelativeImportExtensions` wraps every variable-specifier dynamic
  `import()` in a `__rewriteRelativeImportExtension(...)` runtime helper, and Metro refuses
  to parse a function call inside `import()`. The server-only AsyncLocalStorage load in
  `request-scope.ts` now goes through the `Function` constructor
  (`new Function("return import('node:async_hooks')")`), which is opaque to both tsc's
  emit and every bundler's static resolver — so no helper is emitted and no Node builtin is
  pulled into a client graph. The branch is still server-only and try/caught, so the
  browser / React Native degrade to a no-op exactly as before (verified the load works in
  Node; SSR scoping unchanged).

## [2.4.1] — 2026-06-22

### Changed — usage analytics are now namespace-aware

Following 2.4.0's namespaces, the usage endpoint (`POST /translate/last-used-translations`)
now reports **which namespace** each key was used under, so the backend can mark `last_used`
on the exact `(key, context, namespace)` row instead of every copy of the string.

- The request body's flat `translationsUsage` is replaced by a single
  **`translationsUsageByNamespace`** map: `{ "<namespace>": { "key__context": "YYYY-MM-DD" } }`,
  with the default namespace under the key `"default"`.
- **`unpersistedNamespace` namespaces are excluded** from usage reporting (they'd flood the
  prune signal; reclaim them by their own lifecycle, or use the per-namespace `GET` as a
  namespace-level liveness signal).
- Internally the react/node stores keep a single usage map keyed by namespace; the react
  store persists it under the same `i18n-keyless-translations-usage` key and discards any
  pre-2.4.1 flat blob on hydrate (usage is ephemeral).

### Backend note

Clients on versions **< 2.4.1 still send the old flat `translationsUsage`** (no namespace) —
treat that as the `"default"` namespace. New clients send only `translationsUsageByNamespace`.
Custom `sendTranslationsUsage` handlers keep their existing signature and receive the
default-namespace bucket.

## [2.4.0] — 2026-06-22

### Added — translation namespaces

Split a project's translations into **namespaces** so a client fetches and persists only
the slice it renders, instead of the whole project. This fixes the browser storage quota
error (`Setting the value of 'i18n-keyless-translations' exceeded the quota`) and reduces
download size.

- **`namespace` option** on every translation call:
  - `<I18nKeylessText namespace="checkout">…</I18nKeylessText>` (`i18n-keyless-react`)
  - `getTranslation(key, { namespace })` (`i18n-keyless-react`)
  - `awaitForTranslation(key, lang, { namespace })` (`i18n-keyless-node`)
- **`defaultNamespace`** config option (all packages) — applied when a call doesn't pass
  its own `namespace`; per-call always overrides.
- **Per-namespace storage & fetch** (`i18n-keyless-react`): each namespace persists under
  its own key (`i18n-keyless-translations__<ns>`) with its own delta cursor
  (`i18n-keyless-last-refresh__<ns>`); a `i18n-keyless-namespaces` index lets `hydrate()`
  reload them. Only the namespaces actually rendered are bulk-fetched (each on queue-empty
  and on language change).
- **`unpersistedNamespace: true`** flag (option + `<I18nKeylessText>` prop) — keeps a
  high-cardinality/transient namespace (e.g. one per discussion) **in memory only**: never
  written to storage, never in the persisted index, never reloaded at boot or refetched on
  language switch. No effect in `i18n-keyless-node` (in-memory regardless).

### Backend / wire contract (for self-hosted `API_URL`)

Additive and backward compatible — the **default** namespace is omitted from the wire, so
non-namespaced projects send byte-identical requests.

- `POST /translate` body gains an optional `namespace` (omitted when default).
- `GET /translate/:lang` (react) and `GET /translate/` (node) gain an optional
  `&namespace=<ns>` query param (omitted when default). A namespaced GET should return
  **only** that namespace's translations; no `namespace` ⇒ the default bucket.

### Fixed

- **`clearI18nKeylessStorage` now actually clears.** It iterated `Object.keys(storeKeys)`
  (property names) instead of `Object.values` (the real storage keys), so it deleted
  nothing. It now removes every fixed key **and** each per-namespace translations /
  last-refresh key (read from the namespaces index).

### Notes

- **No breaking changes.** The default namespace reuses the legacy
  `i18n-keyless-translations` / `i18n-keyless-last-refresh` keys, so existing installs
  hydrate with no migration. Lookups remain a flat, merged in-memory map (display is
  namespace-agnostic); namespace only affects what is fetched and how it is persisted.
- Reassigning **existing** translations to a namespace is a backend operation (re-tag the
  key server-side); the client picks up the new layout via the namespaced GET.

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

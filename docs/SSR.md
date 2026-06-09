# i18n-keyless under SSR

How the library behaves when rendered on a server (TanStack Start, Next, Remix,
Expo Router server output…), what works today, and what the dedicated SSR feature
will add. This is the reference both for library maintenance and for consumers
wiring i18n-keyless into an SSR app.

## Mental model

The only thing that is **per-request** in i18n-keyless is *which language to render
in*. The translations for a given language (`en`, `es`, …) are the same for every
request — they are global, cacheable data, not request state.

So "SSR support" is not "a store per request". It is:

1. a process-wide `Map<Lang, Translations>` cache (translations are shared), plus
2. a way to thread **one string** — the target language — through a single render.

Keep that framing in mind; it makes the whole feature much smaller than it first
looks.

## What is true *today* (current async-hydrate behavior)

- **The server renders the primary language.** `getTranslationCore` returns the key
  verbatim when `currentLanguage === languages.primary` (`core/service.ts`), and
  `setLanguage` skips the bulk fetch for the primary language (`react/store.ts`).
  So a server rendering the primary language makes **zero** translation traffic.
- **The client re-translates after hydration.** The zustand store hydrates
  asynchronously, so the client's *first* render is also primary → it matches the
  server HTML exactly → **no hydration mismatch**. Then the store fills from cache
  and the UI re-renders into the target language.
- Net: today, "SSR" gives you primary-language HTML plus client-side translation.
  The "translate once on the server, serve to everyone" benefit is **not** there
  yet — it is exactly what the per-request language feature (below) unlocks.

This async-hydrate behavior is correct but currently *implicit*. It is the official
SSR pattern: **server renders primary; client re-translates post-hydration.** Any
change to the async hydration must preserve the first-client-render-equals-server
invariant or it will introduce mismatches.

## The translate-on-miss design is SSR-safe

The core promise — *write text in your own language; if a translation is missing it
is requested once, with zero cognitive load* — holds under SSR:

- It cannot even fire while the server renders the primary language (the path is a
  no-op for primary).
- When the server *does* render a non-primary language (the future feature), a
  crawler triggering a translation for a new sentence is the design working as
  intended — that sentence needed translating eventually. "Only once" is enforced
  per process (`translating` map + store check in `core/service.ts`); a server
  process is just one very busy "user", and the SaaS already dedupes concurrent
  requests for the same key. This is identical to what N fresh browsers do today.

## Usage analytics under SSR — there is no "spam"

Two separate mechanisms, only one of which is a network call:

- `sendTranslationsUsage` — the **POST to the SaaS**. Called in exactly **one
  place: `init`** (`react/store.ts`). No interval, no per-render trigger.
- `setTranslationUsage` — called per `<T>` render, but only mutates the in-memory
  usage map + storage. **No network.**

Therefore the volume of usage POSTs is **one per `init`**:

- **Long-lived Node server:** `init` runs once per boot and serves thousands of
  users → *fewer* usage POSTs than the SPA case (where every browser session =
  one `init` = one POST). SSR done right is **less** traffic, not more.
- **Serverless / per-request `init`** (Lambda, Vercel functions) is the *only*
  shape where this could exceed SPA volume and be polluted by bot renders — one
  POST per cold-started request. Dev HMR re-init is similar but is dev-only noise.

Conclusion: guarding usage on the server is **optional serverless hygiene**, not a
fix for a problem that exists on a normal server.

## Status — all SSR work is implemented

| # | Issue | Status |
|---|-------|--------|
| 1 | `dist` emitted **extensionless** relative imports → `ERR_MODULE_NOT_FOUND` when externalized in Node ESM. | **Done.** `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` now emit explicit `.js` extensions across core/react/node. JSON imports use `with { type: "json" }`. The node package's broken bare `from "types"` import is fixed. Verified: all three packages load as native Node ESM, fully externalized. |
| 2 | `storage` hard-required; no server init path. | **Done.** `init` defaults to an in-memory adapter (`createMemoryStorage`) when `storage` is absent **and** `typeof window === "undefined"`. The browser still throws loudly (a missing browser storage is a real bug). |
| 3 | `init` POSTed usage; `<T>` recorded usage server-side. | **Done.** On the server (`typeof window === "undefined"`) or with `ssr: true`, usage is neither recorded nor sent. Translate-on-miss is unaffected. |
| 4 | Module-singleton store → state shared across requests. | **Done.** `<I18nKeylessProvider>` supplies per-request `lang`/`translations`; `<T>` reads context first and falls back to the store. `getServerTranslations(lang)` fetches with a per-process cache. |
| 5 | Undocumented hydration semantics. | **Done.** This file, plus the provider seeds the store on client mount for flash-free hydration. |

## SEO consequence (why Issue 4 eventually matters)

If an app emits `hreflang` alternates pointing at `?lang=xx` URLs, but those URLs
currently server-render the primary language, search engines see identical
primary-language content on every alternate. Real server-side language selection
(Issue 4) is what lets a `?lang=en` URL actually serve English HTML and get indexed
in English. Until then, non-primary `hreflang` entries are aspirational.

## The SSR feature — API

Three new exports from `i18n-keyless-react`:

- **`createMemoryStorage()`** — an in-memory storage adapter. Used automatically as
  the server default; exported in case you want to pass it explicitly.
- **`getServerTranslations(lang)`** → `Promise<Translations>` — fetches the
  translations map for `lang`, cached per process (`Map<Lang, Translations>`), so each
  language is fetched at most once per boot. Returns `{}` for the primary language and
  on fetch failure. Requires `init()` to have run first. Use
  `clearServerTranslationsCache(lang?)` to evict.
- **`<I18nKeylessProvider lang translations>`** — per-request React context. `<T>`
  reads `lang`/`translations` from it first and falls back to the global store when no
  provider is present (so SPA mode is unchanged). On the client it also seeds the store
  on mount for flash-free hydration.
- **`runWithI18nKeyless(scope, fn)`** → `Promise<R>` — runs `fn` with a per-request scope
  active so the **imperative `getTranslation(...)`** (and `<T>`) resolve in `scope.lang`
  for the duration of the render. `getServerTranslations`/`<I18nKeylessProvider>` only
  cover `<T>`; this covers code that renders text via `getTranslation` without rewriting
  call sites. `getRequestScope()` and type `I18nRequestScope` are exported alongside it.

### `getTranslation` under SSR (why and how)

`<T>` is a component, so the Provider reaches it via React context. `getTranslation(key)`
is a plain function — it reads the global store and can't see React context, so on the
server it would render the primary language. `runWithI18nKeyless` fixes this with
`AsyncLocalStorage`: it sets a per-request scope that `getTranslation` reads, isolated
across concurrent requests and preserved across `await`s/streaming. Wrap the server
render once:

```tsx
const html = await runWithI18nKeyless({ lang, translations }, () =>
  renderToString(<App />) // every getTranslation(...) AND <T> inside renders in `lang`
);
```

**SPA-safety:** `AsyncLocalStorage` is loaded via a guarded dynamic import
(`typeof window === "undefined"` + variable specifier + `@vite-ignore`/`webpackIgnore`),
so `node:async_hooks` never enters browser bundles and the browser path is a no-op —
`getRequestScope()` returns `undefined` and everything falls back to the store exactly as
before. Verified: an esbuild `--platform=browser` bundle of the SPA exports builds with
no resolution error and no `node:async_hooks` in the output. Requires Node ≥ 20.10 /
a runtime with `AsyncLocalStorage` (most edge runtimes; Cloudflare needs a flag — where
it's unavailable, scoping degrades to a no-op and you fall back to the Provider for `<T>`).

The app owns routing, `?lang=` / `Accept-Language` detection, calling
`getServerTranslations` in its loader, serializing the map into the HTML, and passing
it back to the provider on the client. The library owns the context read path in `<T>`
and the store seeding.

In provider mode the language is the `lang` prop (drive it from the URL).
`setCurrentLanguage` is for non-provider SPA mode.

### Usage sketch

```tsx
// server / app bootstrap (once)
await init({ languages: { primary: "fr", supported: ["fr", "en"] }, API_KEY });
// storage is optional on the server — it defaults to in-memory.

// per request (e.g. a route loader)
const lang = langFromUrlOrHeader(request);          // "en"
const translations = await getServerTranslations(lang); // cached per process

// render (server) and hydrate (client) with the SAME props
<I18nKeylessProvider lang={lang} translations={translations}>
  <App /> {/* <T>…</T> inside now renders in `lang` */}
</I18nKeylessProvider>
// serialize `translations` into the HTML and pass the same object on the client.
```

## Escape hatch available today (no lib change)

For SEO-critical pages that need real server-side translation *now*, skip `<T>` on
those pages and use the **node package's `awaitForTranslation`** in the route
loader, passing the resolved strings down as plain props. Clunky for a whole app,
fine for a landing page + a few blog routes. This is the supported pattern until the
provider ships.

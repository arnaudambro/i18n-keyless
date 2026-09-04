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
| 6 | Under Vite SSR (TanStack Start) the `AsyncLocalStorage` scope was duplicated across the server-entry and SSR-render module graphs/realms → `?lang=en` rendered the primary language with a hydration mismatch. | **Done (2.3.2).** The ALS instance lives on one `globalThis` slot keyed by a plain string (not `Symbol.for()`, whose registry is per-realm), so every module copy in the process shares one ALS. See *One ALS per process* below. |
| 7 | Under Next.js App Router the provider resolved the primary language from the **store**, but Next server-renders client components in a second module graph where `init()` never ran → a `<I18nKeylessProvider lang="fr">` in a French-primary app rendered the English source text (and a non-primary `lang` worked by accident). `dist` shipped no `"use client"`, so a Server Component could not render `<T>` without a client re-export. `getServerTranslations` cached `{}` after a failed fetch for the life of the process. | **Done (3.6.1).** The provider carries `primary` and the hooks read it from context, never from the store. `I18nKeylessText`, `I18nKeylessProvider` and `useTranslation` ship the `"use client"` directive. Only a successful, non-empty response enters the server cache. See *Next.js App Router* below. |

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
  on fetch failure. Only a successful, non-empty response is cached (≥ 3.6.1): a failed or
  timed-out fetch answers `{}` for that request and is retried on the next one. Requires
  `init()` to have run first. Use `clearServerTranslationsCache(lang?)` to evict.
- **`<I18nKeylessProvider lang translations primary?>`** — per-request React context. `<T>`
  reads `lang`/`translations` from it first and falls back to the global store when no
  provider is present (so SPA mode is unchanged). On the client it also seeds the store
  on mount for flash-free hydration. `primary` (≥ 3.6.1) is the language the source
  strings are written in: the hooks under a provider compare `lang` with **that**, never
  with the store's config. It defaults to the store's primary where the provider renders
  in the same module graph as `init()`; **pass it under Next.js App Router**, whose SSR
  layer never runs `init()` (see *Next.js App Router* below). The vue package (`primary` on
  `<I18nKeylessProvider>` and on the plugin) and the angular package (`primary` in the
  `provideI18nKeylessServer` scope) carry it the same way.
- **`runWithI18nKeyless(scope, fn)`** → `Promise<R>` — runs `fn` with a per-request scope
  active so the **imperative `getTranslation(...)`** (and `<T>`) resolve in `scope.lang`
  for the duration of the **server** render. `getServerTranslations`/`<I18nKeylessProvider>`
  only cover `<T>`; this covers code that renders text via `getTranslation` without
  rewriting call sites. `getRequestScope()` and type `I18nRequestScope` are exported
  alongside it.
- **`hydrateFromServer({ lang, translations })`** — synchronously seeds the store on the
  **client**, before the first render, so `getTranslation` returns the right language on
  the very first render (no mismatch / blink). Call it before `hydrateRoot`. `init()`'s
  async `hydrate()` then treats the snapshot as authoritative and won't overwrite it.
- **`getUsedTranslationsSnapshot()`** → `{ lang, translations } | undefined` — like
  `getRequestScope()` but the `translations` contain **only the keys this render actually
  used** (∩ the keys available). Serialize THIS instead of `getRequestScope()` when the
  language set is large, to keep the inline HTML small. The full set is still used for
  resolution during render.

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

**One ALS per process (≥ 2.3.2).** Vite-based SSR — notably **TanStack Start** — builds the
server entry and the SSR render as separate module graphs, often in separate V8 realms that
share one `globalThis` object. The ALS instance is therefore stored on a single `globalThis`
slot keyed by a plain **string** — *not* `Symbol.for()`, whose registry is per-realm and would
hand each realm a different symbol, so the write side (`runWithI18nKeyless`, in the server
entry) and the read side (`getTranslation`/`getRequestScope`, during render) would silently
miss each other and you'd get primary-language HTML + a hydration mismatch. If you do SSR with
TanStack Start / Vite, require i18n-keyless **≥ 2.3.2**. Other setups (Remix, a hand-rolled
`renderToString`, Node) use one module graph and were unaffected.

### Function `getTranslation` vs component `<I18nKeylessText>` in SSR

Both must resolve in the request's language, but they read it from different places, so
they need different wiring:

- **`<I18nKeylessText>` / `<T>`** is a component and reads the language from React context
  — `<I18nKeylessProvider>` covers it on both server and client (and the Provider seeds
  the store on mount). **`useTranslation(text, options)`** is the hook behind it and reads
  the same context: use it where the component needs a *string* (a `placeholder`, a
  `title`, a markdown source). It is the component path, not the function path.
  `useCurrentLanguage()` reads the Provider too, so a switcher shows the request's language.
- **Store selectors are SSR-safe (≥ 3.3.0).** `useI18nKeyless(selector)` hands React the
  real state as its server snapshot. Before, React read zustand's `getInitialState()` on the
  server and on the hydration render, so selectors saw the defaults (`primary: "fr"`).
- **`getTranslation(key)`** is a plain function and cannot read React context. On the
  **server** it reads the request scope set by `runWithI18nKeyless` (AsyncLocalStorage).
  On the **client** it reads the store, so the store must be seeded **synchronously before
  the first render** with `hydrateFromServer` — otherwise the first render falls back to
  the primary language (cold cache) and you get a hydration mismatch + blink.

### Per-framework wiring

Which mechanism you need depends on whether your framework renders the **component tree
inside or outside** the `runWithI18nKeyless` scope:

| Framework | Component tree renders… | `<T>` / `useTranslation` (component path) | `getTranslation` (function path) |
|---|---|---|---|
| **Remix / React Router 7** | **inside** the ALS (`entry.server` calls `renderToPipeableStream` directly inside `runWithI18nKeyless`) | ALS *or* Provider | ALS — works anywhere in the tree |
| **TanStack Start** | **outside** the ALS (only `head()` + `loader`s run inside it) | **Provider** (fed via the root loader) | ALS — **only in loaders / `head()`**, never a component body |
| **Astro islands** | no render hook to wrap | **Provider** | not scoped — renders primary on the server, resolves after `hydrateFromServer` on the client |
| **Next.js App Router** | no render hook to wrap; client components are server-rendered in a module graph where `init()` never ran | **Provider with `primary`** (≥ 3.6.1); `<T>` renders from Server Components directly, the package ships `"use client"` | not scoped — renders primary on the server, resolves after `hydrateFromServer` on the client |

Rules of thumb:

- If you can wrap the actual render call (`renderToString`/`renderToPipeableStream`) in
  `runWithI18nKeyless`, the whole tree is in scope → both paths work from the ALS (Remix).
- If the framework renders the tree outside your reach, use `<I18nKeylessProvider>` for `<T>`
  and `useTranslation`, and keep imperative `getTranslation` calls in a place that *is* in
  scope (a loader/`head()`) or accept primary-on-server for that call (Next/Astro).

**TanStack Start (the one that needs both mechanisms):**

1. Wrap the **whole** server handler — not just `defaultStreamHandler` — because
   `createStartHandler` resolves `head()`/loaders *around* the render callback:
   ```ts
   const baseHandler = createStartHandler(defaultStreamHandler);
   const fetch = (async (request, ...rest) => {
     const lang = langFromRequest(request);
     const translations = await getServerTranslations(lang);
     return runWithI18nKeyless({ lang, translations }, () => baseHandler(request, ...rest));
   }) as typeof baseHandler;
   ```
2. Feed the component path from the **root loader** (TanStack serializes it into the HTML and
   replays it on the client — no manual `<script>`, no hydration mismatch), then drive the
   provider from that data:
   ```tsx
   loader: async ({ deps }) => {
     const lang = normalizeLang(deps.lang);
     const translations = typeof window === "undefined"
       ? await getServerTranslations(lang)        // server
       : useI18nKeyless.getState().translations;  // client navigation
     return { lang, translations };
   },
   // …wrap the body in <I18nKeylessProvider lang={data.lang} translations={data.translations}>.
   ```
3. Put imperative `getTranslation()` calls in route **loaders** (in scope), not component bodies.
   A component that needs a *string* — a `placeholder`, an `aria-label` — calls
   `useTranslation(text)` instead: it reads the Provider, so it is correct on the server
   and identical on the client. Do not re-implement the lookup against the store or the
   context yourself; the hook is the lookup.

Requires i18n-keyless **≥ 2.3.2** (see *One ALS per process* above). Gotchas:

- **`?lang=` is the single source of truth, and the switcher makes two calls.**
  `setCurrentLanguage(next)` fetches the language the browser has not seen yet and fills the
  store; `navigate()` writes the URL. Both are needed: a client-side navigation never reaches
  the server, and the root loader is a pure read of the store on the client, so navigating
  alone keeps the previous language on screen. Don't add an effect syncing
  `currentLanguage → URL` (it creates an infinite navigation loop).
- **Don't reactively subscribe to `translations` in a provider wrapper** — the Provider seeds the
  store in an effect with a fresh `translations` ref each run, so re-feeding it as the prop
  re-renders forever. Read it from loader data; subscribe to `currentLanguage`/context only.
- **`getUsedTranslationsSnapshot()` doesn't work here** — component bodies render outside the ALS,
  so `recordUsedKey` never sees them and the subset misses body keys → mismatch. Serialize the
  **full** map via the loader.

**Next.js App Router (≥ 3.6.1):**

Next renders a page twice on the server: the Server Components in the RSC layer, then the
client components in a **second module graph** (the SSR layer) to produce their HTML. Every
module-scope singleton exists twice, the store included. The layout's `init()` ran in the RSC
layer; the store the provider and `<T>` see in the SSR layer is a fresh instance, with the
default config and no API key. Three consequences, and what the package does about each:

1. **The provider carries the primary language.** Before 3.6.1 the hooks compared `lang` with
   the *store's* primary, which in the SSR layer is the default `fr`: a French-primary app
   rendered the English source text under `<I18nKeylessProvider lang="fr">` (the request
   language *looked like* the primary), while `lang="de"` worked by accident. Pass
   `primary={languages.primary}` to the provider; the hooks read it from context and never
   from the store. Omitting it falls back to the store's primary and logs a warning in
   development when that store never ran `init()`.
2. **`<T>` renders from a Server Component.** `I18nKeylessText`, `I18nKeylessProvider` and
   `useTranslation` ship the `"use client"` directive, so `import { T } from
   "i18n-keyless-react"` works in a Server Component: Next hands the element to the client
   boundary itself. No re-export from a client module of your own. `init`,
   `getServerTranslations` and the request-scope helpers stay server-safe (no directive).
3. **A failed fetch is not cached.** `getServerTranslations` used to cache `{}` after a
   timeout for the life of the process — invisible on an edge isolate, wrong on a long-lived
   Node server. Only a successful, non-empty response is cached; a failure answers `{}` for
   that request and is retried on the next one.

Translate-on-miss runs in an effect, never on the server: the first server render of a new
string is the source text until a browser has rendered it once. Seed the project before
opening it to crawlers.

Full runnable apps for each framework live in [`examples/`](../examples); the `tanstack-start`
one mirrors the recipe above.

### Serialization contract & synchronous client hydration

The server emits `{ lang, translations }` into the HTML; the client seeds the store from
it at module-load time, before `hydrateRoot`. This is the **framework-agnostic** pattern for
when *you* own the render and the HTML (e.g. a hand-rolled `renderToString`, Remix
`entry.server`):

```tsx
// SERVER — inside the scoped render, read the active scope and embed it
const html = await runWithI18nKeyless({ lang, translations }, () => {
  const body = renderToString(
    <I18nKeylessProvider lang={lang} translations={translations}>
      <App />
    </I18nKeylessProvider>
  );
  const snapshot = JSON.stringify(getRequestScope()); // { lang, translations }
  return `${body}<script id="i18n-keyless" type="application/json">${snapshot}</script>`;
});

// CLIENT entry — seed synchronously BEFORE the first render
import { hydrateFromServer, init } from "i18n-keyless-react";

const el = document.getElementById("i18n-keyless");
if (el) hydrateFromServer(JSON.parse(el.textContent)); // sync: getTranslation is correct on render 1
init({ languages: { primary: "fr", supported: ["fr", "en"] }, API_KEY, storage: window.localStorage });
hydrateRoot(document, <App />);
```

`hydrateFromServer` runs before any component renders, so it never writes to the store
during render (no React warning). On a cold cache, `init()`'s async `hydrate()` keeps the
seed instead of resetting to the primary language.

> Frameworks that serialize loader/route data for you — **TanStack Start** loaders, **Next.js**
> RSC payload, **Astro** island props — don't need this manual `<script>`/`hydrateFromServer`
> dance: pass `{ lang, translations }` through that channel and drive `<I18nKeylessProvider>`
> from it (it seeds the store on mount). The manual snapshot here is for when you own the HTML.

### Full snapshot vs per-page snapshot (large translation sets)

The snapshot above embeds the **full** language set. For a small/medium set (tens of KB)
that's the simplest choice — keep it. For a **large** set (thousands of keys), embedding
all of it in every page's HTML is wasteful. Embed only the keys the page rendered:

```diff
- const snapshot = JSON.stringify(getRequestScope());          // full language set
+ const snapshot = JSON.stringify(getUsedTranslationsSnapshot()); // only keys this page used
```

That one-line swap at the serialization site is the whole change. During the render,
`getTranslation`/`<T>` record each key they touch into a per-request `Set` (a plain
`Set.add` — no store write), and `getUsedTranslationsSnapshot()` returns just those keys
(∩ available). The full set is still in scope, so any key resolves correctly mid-render.

**Client navigation invariant:** keep calling `init()` on the client (you already do). The
per-page subset only seeds the **first paint**; `init()` then fetches the **full** language
set in the background and caches it to storage, so subsequent client-side navigation has
every key. So: `hydrateFromServer(subset)` = instant correct first paint;
`init()`'s background fetch = full set for browsing. (Until that fetch lands, a key not in
the subset resolves via translate-on-miss; on a warm cache it's already there.)

Decision rule: small set → `getRequestScope()` (full). Large set →
`getUsedTranslationsSnapshot()` (subset) + the background full fetch. Measure first:
`JSON.stringify(getRequestScope().translations).length`.

**Requires the body to render *inside* the ALS.** The per-page subset relies on `recordUsedKey`
firing during render, so it only works where the component tree renders inside the scope (Remix,
a hand-rolled `renderToString`). It does **not** work under TanStack Start, whose component tree
renders outside the ALS — serialize the full map via the loader there (see *Per-framework
wiring*). Code-split/lazy routes have the same limitation.

> **Usage analytics never block render.** `getTranslation` records usage on a microtask,
> never synchronously during render, so it can't trigger React's "Cannot update a
> component while rendering" warning. The server stays read-only (records nothing).

The app owns routing, `?lang=` / `Accept-Language` detection, calling
`getServerTranslations` in its loader, serializing the map into the HTML, and seeding the
client. The library owns the read paths in `<T>` / `getTranslation` and the store seeding.

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
<I18nKeylessProvider lang={lang} primary="fr" translations={translations}>
  <App /> {/* <T>…</T> inside now renders in `lang` */}
</I18nKeylessProvider>
// serialize `translations` into the HTML and pass the same object on the client.
// `primary` is optional where the provider shares init()'s module graph; under Next.js
// App Router it is required (the SSR layer never runs init()).
```

## Escape hatch available today (no lib change)

For SEO-critical pages that need real server-side translation *now*, skip `<T>` on
those pages and use the **node package's `awaitForTranslationOrFallbackToOriginal`**
in the route loader, passing the resolved strings down as plain props. Clunky for a
whole app, fine for a landing page + a few blog routes. This is the supported pattern
until the provider ships.

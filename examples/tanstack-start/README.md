# i18n-keyless · TanStack Start (SSR)

The canonical **SSR** example. The page is server-rendered in the request's language (from
`?lang=`), the client hydrates without a blink, and language switching is plain URL
navigation.

> Requires `i18n-keyless` **≥ 2.3.2** — earlier versions key the SSR request scope in a way
> that breaks under Vite/TanStack's split module graph (server-entry vs SSR-render). See the
> "Why it works" note at the bottom.

## Two render paths, two mechanisms (the key insight)

In TanStack Start the React **component tree renders OUTSIDE** the `AsyncLocalStorage`
request scope — only `head()` and route `loader`s run inside it. So a single mechanism isn't
enough; you wire up **both**:

| Path              | Used by                                            | Gets the language via                              |
| ----------------- | -------------------------------------------------- | -------------------------------------------------- |
| **Component path** | `<I18nKeylessText>` / `<T>` in the page body       | `<I18nKeylessProvider>` (React context)            |
| **Function path**  | imperative `getTranslation()` in a loader, `head()` | the ALS scope set by `runWithI18nKeyless`          |

The ALS alone renders a correct `<head>` but a **primary-language body**; the provider alone
can't reach `head()`. You need both.

## The four integration points

1. **Wrap the whole handler** — [`src/server.ts`](./src/server.ts) wraps the entire
   `createStartHandler` fetch in `runWithI18nKeyless({ lang, translations }, …)`, not just
   `defaultStreamHandler`. `createStartHandler` resolves `head()`/loaders *around* the render
   callback, so wrapping only the render leaves the **function path** unscoped.
2. **Root loader feeds the component path** — [`src/routes/__root.tsx`](./src/routes/__root.tsx)
   returns `{ lang, translations }` from its `loader` (lang from `?lang=`, translations from
   `getServerTranslations(lang)`). TanStack serializes that into the HTML and replays it
   **identically** on the client → no hydration mismatch.
3. **Provider in `__root`** — the body is wrapped in
   `<I18nKeylessProvider lang={…} translations={…}>` driven by that loader data, so every
   `<I18nKeylessText>` resolves in `lang`.
4. **Imperative calls live in loaders** — [`src/routes/about.tsx`](./src/routes/about.tsx)
   calls `getTranslation()` in its **loader** (inside the ALS), and the component renders the
   serialized result. Never call `getTranslation()` in a component body here — that renders
   outside the ALS and falls back to the primary language.

Primary language is **`fr`**; `?lang=en` / `?lang=es` server-render the other languages.
[`src/client.tsx`](./src/client.tsx) just calls `initI18nClient()` so client-side navigation
has the full language set — the per-request data already arrives via the loader.

## Run

```bash
cp .env.example .env       # add your API key (real service) — or leave empty for offline
npm install
npm run dev
```

Verify SSR directly (English HTML straight from the server, before any JS):

```bash
curl -s 'http://localhost:3000/about?lang=en' | grep -o '8 AM\|8 hours\|About this demo'
```

Offline (no key): also start the mock backend —
`cd ../_mock-server && node server.mjs`.

## Test

```bash
npm test
```

Covers both paths: the **component path** renders inside `<I18nKeylessProvider>` and asserts
the body is translated; the **function path** runs `getTranslation()` inside
`runWithI18nKeyless` and asserts it resolves in the request language.

## Gotchas worth knowing

- **The URL `?lang=` is the single source of truth.** The language switcher just
  `navigate()`s the URL. Do **not** add an effect syncing `currentLanguage` → URL — with the
  loader/provider already seeding the store from the URL, a reverse sync creates an infinite
  `?lang=en ↔ ?lang=fr` navigation loop.
- **Don't reactively subscribe to `translations` in a provider wrapper.**
  `<I18nKeylessProvider>` seeds the store in an effect (a fresh `translations` ref each run);
  a wrapper that subscribes to `store.translations` and feeds it back as the prop will
  re-render forever. Subscribe to `currentLanguage` / read the provider context only, and
  read `translations` from loader data (as `__root.tsx` does).
- **`getUsedTranslationsSnapshot()` (per-page key subset) is incompatible with this setup.**
  Component bodies render outside the ALS, so `recordUsedKey` never sees them and the subset
  would miss body keys → hydration mismatch. This example serializes the **full** language
  map via the loader instead. (Snapshotting only works where the body renders *inside* the
  ALS, e.g. non-lazy routes under a framework that keeps the render in the scope.)

## Why it works (≥ 2.3.2)

Vite/TanStack Start build the server entry and the SSR render as **separate module graphs**,
often in **separate V8 realms that share one `globalThis` object**. i18n-keyless stores its
`AsyncLocalStorage` instance on `globalThis` under a plain **string** key (not `Symbol.for()`,
whose registry is per-realm) so the write side (`runWithI18nKeyless` in the server entry) and
the read side (`getTranslation`/`getRequestScope` during render) share **one** ALS. That's
the fix shipped in 2.3.2.

- Pinned to `@tanstack/react-start` `^1.95` conventions (`createServerEntry` + file-based
  routes). Adjust imports / the `navigate({ to: "." })` call to your installed version if they
  differ.
- Consumes the library via `file:../../packages/*` (always the local build).

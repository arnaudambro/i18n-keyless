# i18n-keyless · TanStack Start (SSR)

The canonical **SSR** example. The page is server-rendered in the request's language, the
client hydrates without a blink, and each page ships only the translations it used.

## The four integration points

1. **Server scope** — [`src/server.ts`](./src/server.ts) wraps the render in
   `runWithI18nKeyless({ lang, translations }, () => defaultStreamHandler(ctx))`, with
   `lang` from `?lang=` and `translations` from `getServerTranslations(lang)`. Inside the
   scope, both `<I18nKeylessText>` and `getTranslation(...)` resolve in `lang`.
2. **Per-page snapshot** — [`src/components/I18nKeylessSnapshot.tsx`](./src/components/I18nKeylessSnapshot.tsx),
   placed **after `<Outlet />`** in [`__root.tsx`](./src/routes/__root.tsx), serializes
   `getUsedTranslationsSnapshot()` (only this page's keys) into a `<script>`.
3. **Synchronous client seed** — [`src/client.tsx`](./src/client.tsx) reads that script and
   calls `hydrateFromServer(...)` **before** `hydrateRoot`, so `getTranslation` is correct
   on the very first client render (no blink, no hydration mismatch).
4. **Background full fetch** — `initI18nClient()` then loads the complete language set so
   client-side navigation (Accueil ↔ À propos) has every key.

Primary language is **`fr`**; `?lang=en` / `?lang=es` server-render the other languages.

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

Includes a real SSR assertion: render a page inside `runWithI18nKeyless`, confirm the HTML
is translated and the snapshot contains **only that page's keys**.

## Notes

- The snapshot component must render **after** the page content. With deferred/streaming
  data (Suspense), content may stream *after* the shell — if you use that, serialize the
  full `getRequestScope()` instead, or inject the snapshot once the stream completes.
- The `globalThis`-based AsyncLocalStorage in i18n-keyless is what makes this work under
  TanStack Start's split server-entry / SSR-render module graphs (one ALS across both).
- Pinned to `@tanstack/react-start` `^1.95` conventions (`createServerEntry` +
  `defineHandlerCallback`). Adjust imports to your installed version if they differ.
- Consumes the library via `file:../../packages/*` (always the local build).

# i18n-keyless · Next.js (App Router, SSR)

Next.js owns rendering and doesn't expose a `renderToString` hook, so this example uses the
**client-boundary pattern** instead of `runWithI18nKeyless`:

- **`/[lang]`** dynamic segment drives the language ([`src/app/[lang]/layout.tsx`](./src/app/%5Blang%5D/layout.tsx)).
- The **server layout** calls `getServerTranslations(lang)` and passes the map to a client
  boundary ([`src/app/Providers.tsx`](./src/app/Providers.tsx)). Next serializes those props
  into the RSC payload automatically — no manual `<script>` needed.
- **`<I18nKeylessProvider lang primary translations>`** makes the `<I18nKeylessText>` (`<T>`)
  component **SSR-correct** (it reads the provider via React context during Next's server
  render). **`primary` is required in Next**: client components are server-rendered in a
  second module graph where the layout's `init()` never ran, so the provider must carry the
  primary language itself (≥ 3.6.1).
- **`<T>` renders from a Server Component** ([`src/app/[lang]/page.tsx`](./src/app/%5Blang%5D/page.tsx)):
  the package ships the `"use client"` directive (≥ 3.6.1), no client re-export needed.
- `hydrateFromServer` + `initI18nClient` run in an effect for the store + background fetch.
- `getServerTranslations` caches a language per process, but never a failed fetch: a timeout
  answers `{}` for that request and is retried on the next one (≥ 3.6.1).

Primary language is **`fr`**; `/en` and `/es` server-render the other languages. The
switcher navigates to `/:lang`, so the server re-renders in the chosen language.

## ⚠️ `getTranslation` caveat in Next App Router

The **`<T>` component is fully SSR-translated.** The imperative **`getTranslation(...)`**
function renders the **primary** language during SSR and on the first client render (no
hydration mismatch), then resolves to the target language after hydration — a brief flash,
because App Router has no render hook to scope the function path on the server (that's what
`runWithI18nKeyless` does in TanStack Start / Remix). **Prefer `<T>` in Next** if you need
zero-flash server translation; use `getTranslation` for non-critical/below-the-fold text.

## Run

```bash
cp .env.example .env.local   # add your API key — or leave empty for offline
npm install
npm run dev                  # http://localhost:3000  → redirects to /fr
```

Offline (no key): also start the mock backend — `cd ../_mock-server && node server.mjs`.

Check SSR: `curl -s http://localhost:3000/en | grep -o 'Here is a phrase'`.

Consumes the library via `file:../../packages/*`.

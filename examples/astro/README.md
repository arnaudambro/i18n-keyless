# i18n-keyless · Astro (React islands, SSR)

The whole app is one React island ([`src/components/App.tsx`](./src/components/App.tsx))
rendered with `client:load`. Like Next, Astro doesn't expose a `renderToString` hook, so
it uses the **provider + client-boundary** pattern:

- **`/[lang]`** pages ([`src/pages/[lang]/index.astro`](./src/pages/%5Blang%5D/index.astro))
  read the language, `initI18nServer()`, and `getServerTranslations(lang)` in the
  frontmatter (server), then pass it to the island as props (Astro serializes them).
- **`<I18nKeylessProvider>`** makes `<I18nKeylessText>` (`<T>`) SSR-correct (Astro
  server-renders the island).
- `hydrateFromServer` + `initI18nClient` run in an effect.

Primary language is **`fr`**; `/en` and `/es` server-render the other languages. The
switcher does a full navigation to `/:lang`.

## ⚠️ `getTranslation` caveat

Same as Next: the **`<T>` component is SSR-translated**; the imperative
**`getTranslation(...)`** renders the primary language during SSR and resolves after
hydration (no render hook for `runWithI18nKeyless` in island mode). Prefer `<T>` for
zero-flash SSR. TanStack Start / Remix have full `getTranslation` SSR via
`runWithI18nKeyless`.

## Run

```bash
cp .env.example .env       # add your API key — or leave empty for offline
npm install
npm run dev
```

Offline (no key): also start the mock backend — `cd ../_mock-server && node server.mjs`.

Consumes the library via `file:../../packages/*`.

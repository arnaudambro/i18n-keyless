# i18n-keyless · React Router 7 / Remix (SSR)

Same SSR pattern as the TanStack Start example, wired into React Router 7's framework mode
(this is also the Remix integration — Remix v3 and RR7 framework mode share these entries).

## Integration points

1. **Server scope** — [`app/entry.server.tsx`](./app/entry.server.tsx) wraps
   `renderToPipeableStream(<ServerRouter />)` in
   `runWithI18nKeyless({ lang, translations })`, with `lang` from `?lang=` and
   `translations` from `getServerTranslations(lang)`.
2. **Per-page snapshot** — [`app/components/I18nKeylessSnapshot.tsx`](./app/components/I18nKeylessSnapshot.tsx),
   placed after the app in [`app/root.tsx`](./app/root.tsx)'s `Layout`, serializes
   `getUsedTranslationsSnapshot()` into a `<script>`.
3. **Synchronous client seed** — [`app/entry.client.tsx`](./app/entry.client.tsx) calls
   `hydrateFromServer(...)` before `hydrateRoot`.
4. **Background full fetch** — `initI18nClient()` loads the full set for client navigation.

Primary language is **`fr`**; `?lang=en` / `?lang=es` server-render the other languages.

## Run

```bash
cp .env.example .env       # add your API key — or leave empty for offline
npm install
npm run dev
```

Offline (no key): also start the mock backend — `cd ../_mock-server && node server.mjs`.

Check SSR: `curl -s 'http://localhost:5173/about?lang=en' | grep -o '8 AM'`.

## Test

```bash
npm test
```

`vite.config.ts` skips the React Router plugin in test mode, so Vitest runs the component
+ SSR-snapshot tests directly. Consumes the library via `file:../../packages/*`.

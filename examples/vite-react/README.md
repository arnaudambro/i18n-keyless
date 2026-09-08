# i18n-keyless · Vite + React (SPA)

The baseline example — a single-page app. No SSR. Shows the core of i18n-keyless:

- `init()` with `window.localStorage` ([`src/i18n.ts`](./src/i18n.ts))
- the `<I18nKeylessText>` (`<T>`) component ([`src/pages/Home.tsx`](./src/pages/Home.tsx))
- the imperative `getTranslation(key)` function + the `context` option — the canonical
  `8 heures` → "8 AM" / "8 hours" example ([`src/pages/About.tsx`](./src/pages/About.tsx))
- the `replace` option (Home)
- a language switcher with `useCurrentLanguage` / `setCurrentLanguage`
  ([`src/components/LanguageSwitcher.tsx`](./src/components/LanguageSwitcher.tsx))
- two pages, so you can see navigation stay translated

Primary language is **`fr`** — you write your strings in French and i18n-keyless
translates them to `en`/`es` (and any other supported language).

## Run (real service)

1. Get an API key at [i18n-keyless.com](https://i18n-keyless.com), then:
   ```bash
   cp .env.example .env        # put VITE_I18N_KEYLESS_API_KEY=sk_... in it
   npm install
   npm run dev
   ```

That's the real-life setup: the app calls the live i18n-keyless service, which translates
your French strings on demand (once per string, then cached).

## Run (offline, no key)

Leave `VITE_I18N_KEYLESS_API_KEY` empty and start the bundled mock backend instead:

```bash
cd ../_mock-server && node server.mjs    # http://localhost:8787, in another terminal
npm install && npm run dev               # in this folder
```

## Test

```bash
npm test
```

The test seeds the store with `hydrateFromServer(...)` and asserts both the component and
function paths render translated text, plus the switcher changes language — no backend
needed.

## The precompiled bundle

`src/i18n-keyless/` holds the dictionaries exported at build time (`manifest.json` plus one
`default/<lang>.json`), and `src/i18n.ts` hands them to `init` as `bundle: { manifest, load }`.
A language the manifest covers is read from its file — never downloaded — and the API is
only called for a string the bundle does not have. Refresh the files before a release:

```bash
node scripts/export-bundle.mjs                                # against the local mock server
VITE_I18N_KEYLESS_API_KEY=... node scripts/export-bundle.mjs  # against the real service
```

The bundle sits on the critical path (downloaded before the first paint), so it is loaded
with a dynamic `import()` per language. For a web app with many languages and a good
network the default runtime fetch is the better choice: delete the `bundle` line.

## Notes

- This example consumes the library via **`file:../../packages/*`**, so it always builds
  against the local source. To pin a published version instead, set
  `"i18n-keyless-react": "^2.3.0"` (and remove the core `file:` entry).
- Add languages in `SUPPORTED_LANGUAGES` (`src/i18n.ts`) — the real service translates
  them automatically; for the offline mock, also add them to
  `examples/_mock-server/fixtures.json`.

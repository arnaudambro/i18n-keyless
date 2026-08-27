# i18n-keyless · Vite + Vue (SPA)

The Vue baseline example: a single-page app, no SSR. Shows the core of `i18n-keyless-vue`:

- `init()` with `window.localStorage` ([`src/i18n.ts`](./src/i18n.ts))
- the `I18nKeyless` plugin, which registers `<T>` globally ([`src/main.ts`](./src/main.ts))
- the `<T>` component, `t()` from `useI18nKeyless()`, the `replace` and `context` options
  and a language switcher with `currentLanguage` / `setCurrentLanguage`
  ([`src/App.vue`](./src/App.vue))
- two views, so you can see navigation stay translated

Primary language is **`fr`**: you write your strings in French and i18n-keyless
translates them to `en`/`es` (and any other supported language).

## Run (real service)

1. Get an API key at [i18n-keyless.com](https://i18n-keyless.com), then:
   ```bash
   cp .env.example .env        # put VITE_I18N_KEYLESS_API_KEY=sk_... in it
   npm install
   npm run dev
   ```

## Run (offline, no key)

Leave `VITE_I18N_KEYLESS_API_KEY` empty and start the bundled mock backend instead:

```bash
cd ../_mock-server && node server.mjs    # http://localhost:8787, in another terminal
npm install && npm run dev               # in this folder
```

## Notes

- This example consumes the library via **`file:../../packages/*`**, so it always builds
  against the local source. To pin a published version instead, set
  `"i18n-keyless-vue": "^3.3.0"` (and remove the core `file:` entry).
- Add languages in `SUPPORTED_LANGUAGES` (`src/i18n.ts`): the real service translates
  them automatically; for the offline mock, also add them to
  `examples/_mock-server/fixtures.json`.

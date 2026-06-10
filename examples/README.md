# i18n-keyless examples

Runnable example apps showing i18n-keyless in each major framework. Every app demonstrates
the same feature set so you can compare integrations side by side:

- `init()` + a **language switcher** (`useCurrentLanguage` / `setCurrentLanguage`)
- text via **both** paths: the `<I18nKeylessText>` (`<T>`) component **and** the
  `getTranslation(key)` function
- the `replace` and `context` options
- **two pages**, so you can see client-side navigation stay translated
- for SSR apps: server-rendered translated HTML (`?lang=en`), flash-free hydration, and
  the **per-page snapshot** (each page serializes only the keys it used)

## Examples

| Example | Framework | Mode | Demonstrates |
|---|---|---|---|
| [`vite-react`](./vite-react) | Vite + React | SPA | the baseline: init, storage, `<T>`, `getTranslation`, switcher |
| [`tanstack-start`](./tanstack-start) | TanStack Start | SSR + SPA | `getServerTranslations` → `runWithI18nKeyless` → `getUsedTranslationsSnapshot` → `hydrateFromServer` |
| [`remix-rr7`](./remix-rr7) | Remix / React Router 7 | SSR | same SSR pattern in `entry.server`/`entry.client` |
| [`nextjs`](./nextjs) | Next.js (App Router) | SSR | client-boundary pattern (`<I18nKeylessProvider>` + `hydrateFromServer`) |
| [`astro`](./astro) | Astro + React islands | SSR | island + provider + snapshot |
| [`react-native`](./react-native) | React Native (CLI) | native | MMKV / AsyncStorage adapter |
| [`expo`](./expo) | Expo Router | native | Expo storage + router |
| [`node`](./node) | Node.js (no React) | server | `i18n-keyless-node` + `awaitForTranslation` |

Primary language is **`fr`** across all examples — you write strings in French and
i18n-keyless translates them to `en`/`es` (and any other supported language).

## Running any example (real service)

```bash
cd examples/<name>
cp .env.example .env     # add your API key (get one at https://i18n-keyless.com)
npm install
npm run dev
```

This is the real-life setup: the app talks to the live i18n-keyless service, which
translates your strings on demand (once per string, then cached). `npm test` for tests.

### Offline mode (no API key)

Each example also runs without a key against a tiny bundled mock backend — handy for
trying it out, CI, or screenshots. Leave the API key empty and:

```bash
cd examples/_mock-server && node server.mjs   # http://localhost:8787, in another terminal
```

See [`_mock-server`](./_mock-server) for what it does.

## Consuming the library

The examples reference the packages via **`file:../../packages/*`**, so they always build
against the local source in this repo (no publish step needed). To pin a published version
instead, set e.g. `"i18n-keyless-react": "^2.3.0"` in the example's `package.json`.

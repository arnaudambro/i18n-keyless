# i18n-keyless · Node.js (server, no React)

A plain Node HTTP server using **`i18n-keyless-node`** — translate strings server-side with
no React involved. Renders an HTML page in the requested language (`/?lang=en`).

- `init()` ([`src/i18n.ts`](./src/i18n.ts)) — the Node SDK bulk-loads every language up front.
- `awaitForTranslationOrFallbackToOriginal(key, lang, options?)` ([`src/render.ts`](./src/render.ts))
  — the imperative async API for a request handler. **Always `await` it** (rate limiting);
  it never rejects, and falls back to the French source on a failed POST instead of failing
  the whole page. Supports the same `context` option (`8 heures` → "8 AM" / "8 hours"). For
  a script or a build step, use `awaitForTranslationOrThrow` instead — it intentionally
  crashes the process on an unhandled rejection, to surface translation errors.

Primary language is **`fr`**.

## Run

```bash
cp .env.example .env       # add your API key — or leave empty for offline
npm install
npm run dev                # http://localhost:3000  (try /?lang=en, /?lang=es)
```

Offline (no key): also start the mock backend —
`cd ../_mock-server && node server.mjs`.

`npm run dev` uses Node's built-in TypeScript stripping (`--experimental-strip-types`,
Node ≥ 22). For older Node, run with `tsx` or compile first.

## Test

```bash
npm test
```

Mocks `fetch` (no backend needed) and asserts the rendered HTML is translated for `en` and
is the French source for the primary language.

## Notes

- Uses the documented `API_URL` mode (mock) / official-service mode (real key) — see the
  three config modes in the main README.
- Consumes the library via `file:../../packages/*` (always the local build).

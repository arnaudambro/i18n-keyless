# Mock i18n-keyless backend

A tiny, **dependency-free** Node server that implements the i18n-keyless HTTP protocol
against the canned translations in [`fixtures.json`](./fixtures.json), so the example apps
run **offline — no API key, no network**.

```bash
node server.mjs          # http://localhost:8787
PORT=9000 node server.mjs
```

Every example points `API_URL` at this server with a dummy `API_KEY: "demo"`. To use the
real service instead, set `API_URL: "https://api.i18n-keyless.com"` and your real
`API_KEY` — the AI service then produces translations on demand (this mock only serves a
fixed set).

Primary language is **`fr`** (the demo source strings are written in French); `en` and
`es` are translated in the fixtures. Add languages by editing `fixtures.json`.

> This mock is **optional** — it only exists so the examples can run without an API key.
> The real-life path is to set your `API_KEY` and use the real service (see each
> example's README).

## Endpoints

| Method | Path | Used by | Returns |
|---|---|---|---|
| `GET` | `/translate/:lang` | react SDK | `{ ok, data: { translations } }` for one language |
| `GET` | `/translate/` | node SDK | `{ ok, data: { translations: { <lang>: {…} } } }` (all languages) |
| `POST` | `/translate` | both | `{ ok, data: { translation: { <lang>: … } } }` for one key |
| `POST` | `/translate/last-used-translations` | both | `{ ok }` (usage sink) |

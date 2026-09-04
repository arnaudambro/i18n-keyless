# i18n-keyless · Python (server, no framework)

A two-page HTTP server on the standard library using the **`i18n-keyless`** package
([`ports/python`](../../ports/python)): translate strings server-side and render each page
in the requested language (`/?lang=en`, `/about?lang=es`).

- `init()` ([`app.py`](./app.py), `init_i18n`): the Python port bulk-loads every language
  up front, once at process start.
- `t(key, lang, ...)` in the handler: the imperative API. It never raises and falls back to
  the French source on a failed request instead of failing the page. `context` disambiguates
  `8 heures` ("8 AM" / "8 hours"); `replace` fills `{{current_lang}}`; the switcher is a
  link per language, and `resolve_lang` maps `?lang=en_US` onto `en`.
- Two pages, so each one renders its own strings.

Primary language is **`fr`**.

## Run

```bash
cp .env.example .env       # add your API key — or leave empty for offline
export $(cat .env)         # or set I18N_KEYLESS_API_KEY in your shell
uv run app.py              # http://localhost:3000  (try /?lang=en, /about?lang=es)
```

Offline (no key): also start the mock backend —
`cd ../_mock-server && node server.mjs` — the app then talks to `http://localhost:8787`.

`uv run` installs the port from `../../ports/python` (editable) and Python >= 3.9 if
needed. Without uv: `pip install -e ../../ports/python && python app.py`.

## Test

```bash
uv run pytest
```

Scripts the port's HTTP transport (no backend needed) and asserts the rendered HTML is
translated for `en` and is the French source for the primary language.

## Notes

- Uses the documented `api_url` mode (mock) / official-service mode (real key) — see the
  three config modes in the port's README.
- A string the mock does not know (`t("Bonjour", "en")`) is POSTed to `/translate` and the
  mock echoes the French source: that is what you see. With a real key the AI translates it.

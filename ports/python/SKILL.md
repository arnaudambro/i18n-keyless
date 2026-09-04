---
name: i18n-keyless-python
description: Install and use i18n-keyless in a Python server, script or build step (Django, Flask, FastAPI, plain Python). t("Welcome to our app", lang) (the source string where a key would go) resolves through the i18n-keyless API with one package and one init() call. Use when adding, configuring or debugging translations / localization / multi-language support in a Python project, or when the project already depends on `i18n-keyless`.
license: MIT
---

# i18n-keyless for Python

gettext takes a key and a catalogue. This package takes the source string: a
`t("Welcome to our app", "fr")` call is translated by AI once, for every language, cached in
memory, and served from there. No `.po` file, no message id, no key to name.

**Version covered: `i18n-keyless` 3.x on PyPI, Python >= 3.9, no dependency.**

## Install in one step

```bash
pip install i18n-keyless          # or: uv add i18n-keyless
```

```python
import i18n_keyless as i18n

i18n.init(api_key=os.environ["I18N_KEYLESS_API_KEY"], primary="en", supported=["en", "fr", "es"])
```

Once, at process start (a module import, the app factory, Django's `AppConfig.ready()`, the
FastAPI lifespan). It loads every language in one request.

## Rules

- Source strings are written in the primary language. `t("Bonjour", lang)` in a
  French-first app, `t("Hello", lang)` in an English-first one. Never invent a key name.
- The language is an argument: `t(text, lang)`. Resolve it from the request with
  `i18n.resolve_lang(tag, supported=..., fallback=...)` (`pt_BR` is `pt-BR`, `zh-TW` is
  `zh-Hant`, `en-US` is `en`, an unknown tag is the fallback). Never pass a raw
  `Accept-Language` value.
- Placeholders: write `{{name}}` (any literal) in the source string and pass
  `replace={"{{name}}": value}`. It is applied after the translation. Do not format the
  string before calling `t()`: a formatted string is a new key on every call.
- Ambiguous strings take a context: `t("8 hours", lang, context="duration")`. Stored as
  `8 hours__duration`, the same entry the other SDKs use. `namespace=` travels the same way.
- Plurals: one call per form with a `context` (`context="one"`, `context="other"`).
- `t()` never raises: a failed request returns the source text and logs an error on the
  `i18n_keyless` logger. `t_or_raise()` raises `TranslationError` instead: use it in a
  script or a build step, never in a request handler.
- A miss blocks the call once per string per process (one round trip, 10 s timeout, two
  retries). In an async handler that must never wait on the network, run `t()` in a
  threadpool.
- Always pass the full list of served languages in `supported`: a new string is
  translated into all of them, and the API stores the list as the project's languages
  (it replaces the previous one).
- Every request carries `Authorization: Bearer`, `Version: 3.6.1` and `sdk: python` (a
  server label: counted by connection, no device id, usage analytics like the node SDK).
- Usage analytics are on, like the node SDK: one `POST /translate/last-used-translations`
  at most every 10 s from a daemon thread. A script that exits sooner calls
  `i18n.flush_usage()` first.
- A source string is capped at 2000 characters (`context` and `namespace` at 200). Long-form
  content is allowed, but a blog post is one translation **per Markdown block** of about 1000
  characters: keep the Markdown inside each block, give every block of the document the same
  `context` (one very short summary of it) and one `namespace` per document.
  https://docs.i18n-keyless.com/docs/guides/long-form-content

## Configuration

`i18n.init(api_key, primary, supported, api_url=None, default_namespace=None, debug=False,
on_init=None, handle_translate=None, get_all_translations_for_all_languages=None,
send_translations_usage=None)`. Or `i18n.init(i18n.Config(...))`. Several projects in one
process: `client = i18n.I18nKeyless(); client.init(config); client.t(...)`.

Three network modes, in priority order: the custom handlers, then `api_url` (a self-hosted
backend or a proxy), then the official service. `api_key` is sent in every mode.

## Frameworks

- **Django**: a `simple_tag` in `templatetags/` that calls `i18n.t(text, lang, context=...)`
  with `lang = resolve_lang(translation.get_language(), ...)`; `{% load keyless %}` then
  `{% t "Welcome to our app" %}`. `LocaleMiddleware` keeps choosing the language.
- **Flask**: `i18n.init()` next to `Flask(__name__)`; in a view,
  `lang = resolve_lang(request.args.get("lang") or request.accept_languages.best, ...)`.
- **FastAPI**: `i18n.init()` in the lifespan; a dependency resolves the language from the
  `Accept-Language` header; `await run_in_threadpool(i18n.t, text, lang)` in an async route.

## Debug

- `t()` returns the source text in a non-primary language: check `api_key`, that `lang` is
  one of the 48 codes and is in `supported`, and the `i18n_keyless` logger for lines
  starting with `i18n-keyless:` (set `debug=True` for one line per resolution).
- `t()` returns the source text before `init()`: one warning is logged; call `init()` at
  process start.
- A translation does not update after a dashboard edit: the process holds its dictionary
  until the next refetch, which follows a miss. Restart the process, or make one call for
  a new string.
- Every call POSTs the same string: the answer had no text for `lang` (the AI failed for
  that cell, or `lang` is not in `supported`). Check the dashboard row.

## Offline try-out

Run `examples/_mock-server` (`node server.mjs`, port 8787) and
`i18n.init(api_key="demo", api_url="http://localhost:8787", primary="fr", supported=["fr", "en", "es"])`.
See `examples/python/README.md`.

## Go deeper

- Package README: `ports/python/README.md`
- The whole i18n-keyless documentation as one file: https://docs.i18n-keyless.com/llms.txt
- Dashboard: https://i18n-keyless.com/dashboard

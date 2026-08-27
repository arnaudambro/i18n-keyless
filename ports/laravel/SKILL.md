---
name: i18n-keyless-laravel
description: Install and use i18n-keyless in a Laravel application. The existing __('...') calls (JSON keyless mode) resolve through the i18n-keyless API with one composer require and one .env line. Use when adding, configuring or debugging translations / localization / multi-language support in a Laravel 11, 12 or 13 project, or when the project already depends on `i18n-keyless/laravel`.
license: MIT
---

# i18n-keyless for Laravel

Laravel's JSON translation mode already uses the source string as the key
(`__('Welcome to our app')`). This package makes those calls resolve through the
i18n-keyless API: a missing string is translated by AI once, for every language, cached in
Laravel's cache, and served from there. No `lang/*.json` to maintain.

**Version covered: `i18n-keyless/laravel` 3.x, Laravel 11, 12 and 13, PHP >= 8.2.**

## Install in one step

```bash
composer require i18n-keyless/laravel
```

```dotenv
I18N_KEYLESS_API_KEY=...            # required: https://i18n-keyless.com/#get-api-key
I18N_KEYLESS_LANGUAGES=en,fr,es     # required for translation: every language the app serves
I18N_KEYLESS_PRIMARY_LANG=en        # the language the source strings are written in (default: app.locale)
```

The service provider is auto-discovered. No code change: `__()`, `@lang`, `trans()` and
`Lang::get()` keep their signatures.

## Rules

- Source strings are written in the primary language. `__('Bonjour')` in a French-first app,
  `__('Hello')` in an English-first one. Never write a key name (`__('messages.welcome')`
  still works but goes to Laravel's PHP array files, not to i18n-keyless).
- Placeholders are Laravel's: `__('Bienvenue :name', ['name' => $name])`. Do not use the
  SDKs' `replace` option or `{{name}}` syntax.
- Ambiguous strings take a context through the helper: `i18nk('8 heures', context:
  'duration')`. Stored as `8 heures__duration`, the same entry the other SDKs use.
- Plurals: do not send `trans_choice` pipe strings. Use one `i18nk()` per form with a
  `context`, or a PHP array file.
- The current locale is `App::getLocale()`. Switching it (`App::setLocale('fr')`, a
  middleware, `?lang=`) is all that is needed; the package loads the locale on its first
  miss. Laravel locales are mapped: `pt_BR` is `pt-BR`, `zh_CN` is `zh-Hans`.
- Always set `I18N_KEYLESS_LANGUAGES` to the full list the app serves. It is what a new
  string is translated into, and the API stores it as the project's language list (it
  replaces the previous one). Without it, missing strings are never sent: they stay as
  source text and one warning `I18N_KEYLESS_LANGUAGES is required` is logged per process.
- Nothing blocks a request except the very first fetch of a language's dictionary. Misses
  are sent after the response (`terminating`) or, with `I18N_KEYLESS_QUEUE=<queue>`, as a
  `TranslateMissingKeys` job.
- Never throws. A failed API call shows the source text and is retried at the next request.
- Every request carries `Authorization: Bearer`, `Version: 3.3.0` and `sdk: laravel` (a
  server label: counted by connection, no device id, usage analytics like the node SDK).
- A line in `lang/{locale}.json` wins over the API. Delete the file to let the API serve it.
- Usage analytics are on by default, like the node SDK: one `POST
  /translate/last-used-translations` at most every 10 s, after the response, never blocking.
  `I18N_KEYLESS_USAGE=false` turns them off (the dictionary is then injected with
  `Lang::addLines()`).
- If the app calls `Lang::handleMissingKeysUsing()` itself, it replaces the package's
  hook: call `app(\I18nKeyless\Laravel\KeylessTranslator::class)->handleMissingKey(...)`
  from that callback.
- A source string is capped at 2000 characters (`context` and `namespace` at 200). Long-form
  content is allowed, but a blog post is one translation **per Markdown block**: keep the
  Markdown inside each block, give every block of the document the same `context` — one very
  short summary of it — and one `namespace` per document.
  https://docs.i18n-keyless.com/docs/guides/long-form-content

## Configuration

`php artisan vendor:publish --tag=i18n-keyless-config`. Keys: `enabled`, `api_key`,
`api_url`, `primary`, `languages`, `namespace`, `cache.store`, `cache.ttl`, `cache.prefix`,
`timeout` (10 s), `retry` (`[500, 1500]` ms), `concurrency` (30), `usage` (true), `queue`.
Env: `I18N_KEYLESS_ENABLED`, `I18N_KEYLESS_API_KEY`, `I18N_KEYLESS_API_URL`,
`I18N_KEYLESS_PRIMARY_LANG`, `I18N_KEYLESS_LANGUAGES`, `I18N_KEYLESS_NAMESPACE`,
`I18N_KEYLESS_CACHE_STORE`, `I18N_KEYLESS_CACHE_TTL`, `I18N_KEYLESS_USAGE`,
`I18N_KEYLESS_QUEUE`.

## Debug

- `__()` returns the source text in a non-primary locale: check `I18N_KEYLESS_API_KEY` and
  `I18N_KEYLESS_LANGUAGES`, that the locale maps to a supported code and is in the list, and
  the log for lines starting with `i18n-keyless:`.
- A translation does not update after a dashboard edit: the dictionary is served for
  `cache.ttl` seconds before revalidation. `php artisan cache:clear` forces a refetch.
- A string is POSTed on every request: the miss guard lives in the cache; make sure the
  cache store is shared between processes (not `array`).

## Offline try-out

Run `examples/_mock-server` (`node server.mjs`, port 8787) and set
`I18N_KEYLESS_API_URL=http://localhost:8787`, `I18N_KEYLESS_API_KEY=demo`,
`I18N_KEYLESS_PRIMARY_LANG=fr`. See `examples/laravel/README.md`.

## Go deeper

- Package README: `ports/laravel/README.md`
- The whole i18n-keyless documentation as one file: https://docs.i18n-keyless.com/llms.txt
- Dashboard: https://i18n-keyless.com/dashboard

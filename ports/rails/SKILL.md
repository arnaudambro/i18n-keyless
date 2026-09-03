---
name: i18n-keyless-rails
description: Install and use i18n-keyless in a Ruby on Rails application. t('Welcome to our app') (the source string where a key would go) resolves through the i18n-keyless API with one gem and two .env lines. Use when adding, configuring or debugging translations / localization / multi-language support in a Rails 7 or 8 project, or when the project already depends on `i18n-keyless-rails`.
license: MIT
---

# i18n-keyless for Ruby on Rails

Rails' `t()` takes a key and looks it up in `config/locales/*.yml`. This gem chains an I18n
backend after the application's: a `t('Welcome to our app')` call whose argument is a source
string, not a key, is translated by AI once, for every language, cached in `Rails.cache`,
and served from there. No YAML to maintain for those strings.

**Version covered: `i18n-keyless-rails` 3.x, Rails 7.0 to 8.x, Ruby >= 3.1.**

## Install in one step

```bash
bundle add i18n-keyless-rails
```

```dotenv
I18N_KEYLESS_API_KEY=...            # required: https://i18n-keyless.com/#get-api-key
I18N_KEYLESS_LANGUAGES=en,fr,es     # required for translation: every language the app serves
I18N_KEYLESS_PRIMARY_LANG=en        # the language the source strings are written in (default: I18n.default_locale)
```

The Railtie is auto-loaded. No code change: `t()`, `I18n.t`, `translate()` keep their
signatures; the `i18nk` helper is mixed into views, controllers, mailers and jobs.

## Rules

- Source strings are written in the primary language. `t('Bonjour')` in a French-first app,
  `t('Hello')` in an English-first one. Never invent a key name for a keyless string.
- What is a Rails key, left to YAML and never sent: a Symbol (`t(:hello)`), a `scope:`, a
  lazy lookup (`t('.title')`), or a lowercase identifier path (`t('hello')`,
  `t('users.index.title')`). What is a source string: anything with a space, an uppercase
  letter or punctuation. For a lowercase one-word source string, use `i18nk('close')`.
  The rule is `config.rails_key_pattern`.
- Placeholders are I18n's: `t('Bienvenue %{name}', name: name)`. Do not use the SDKs'
  `replace` option or `{{name}}` syntax.
- Ambiguous strings take a context: `t('8 heures', context: 'duration')` or
  `i18nk('8 heures', context: 'duration')`. Stored as `8 heures__duration`, the same entry
  the other SDKs use. `namespace:` travels the same way.
- Plurals: YAML `one:` / `other:` rules do not apply to a source string. Use one `i18nk()`
  per form with a `context`, or a YAML file.
- The current locale is `I18n.locale`. Switching it (`I18n.locale = :fr`, `around_action`,
  `?locale=`) is all that is needed; the gem loads the locale on its first miss. Rails
  locales are mapped: `pt_BR` is `pt-BR`, `zh_CN` is `zh-Hans`. List the served locales in
  `config.i18n.available_locales` when they have no YAML file.
- Always set `I18N_KEYLESS_LANGUAGES` to the full list the app serves. It is what a new
  string is translated into, and the API stores it as the project's language list (it
  replaces the previous one). Without it, missing strings are never sent: they stay as
  source text and one warning `I18N_KEYLESS_LANGUAGES is required` is logged per process.
- Nothing blocks a request except the very first fetch of a language's dictionary. Misses
  are sent after the response (a Rack middleware) or, with `I18N_KEYLESS_QUEUE=<queue>`, as
  an `I18nKeyless::TranslateMissingKeysJob`.
- Never raises. A failed API call shows the source text and is retried at the next request.
- Every request carries `Authorization: Bearer`, `Version: 3.5.0` and `sdk: rails` (a
  server label: counted by connection, no device id, usage analytics like the node SDK).
- A line in `config/locales/{locale}.yml` wins over the API. Delete it to let the API serve it.
- Usage analytics are on by default, like the node SDK: one `POST
  /translate/last-used-translations` at most every 10 s, after the response, never blocking.
  `I18N_KEYLESS_USAGE=false` turns them off.
- Use a shared cache store in production (Redis, Memcached, the database): the miss guard
  and the usage lock live in `Rails.cache`, and a `:memory_store` is per process.
- If the app sets `I18n.backend` itself after boot, chain again with `I18nKeyless.install!`.
- A source string is capped at 2000 characters (`context` and `namespace` at 200). Long-form
  content is allowed, but a blog post is one translation **per Markdown block** of about 1000
  characters: keep the Markdown inside each block, give every block of the document the same
  `context` — one very short summary of it — and one `namespace` per document.
  https://docs.i18n-keyless.com/docs/guides/long-form-content

## Configuration

`I18nKeyless.configure { |c| ... }` in an initializer, or the environment. Keys: `enabled`,
`api_key`, `api_url`, `primary`, `languages`, `namespace`, `cache`, `cache_ttl`,
`cache_prefix`, `timeout` (10 s), `retry` (`[500, 1500]` ms), `concurrency` (30), `usage`
(true), `queue`, `logger`, `rails_key_pattern`.
Env: `I18N_KEYLESS_ENABLED`, `I18N_KEYLESS_API_KEY`, `I18N_KEYLESS_API_URL`,
`I18N_KEYLESS_PRIMARY_LANG`, `I18N_KEYLESS_LANGUAGES`, `I18N_KEYLESS_NAMESPACE`,
`I18N_KEYLESS_CACHE_TTL`, `I18N_KEYLESS_USAGE`, `I18N_KEYLESS_QUEUE`.

## Debug

- `t()` returns the source text in a non-primary locale: check `I18N_KEYLESS_API_KEY` and
  `I18N_KEYLESS_LANGUAGES`, that the locale maps to a supported code and is in the list, and
  the log for lines starting with `i18n-keyless:`.
- `t()` returns `Translation missing`: the argument matched the Rails-key rule (lowercase
  identifier). Use `i18nk()` or capitalise the source string.
- A translation does not update after a dashboard edit: the dictionary is served for
  `cache_ttl` seconds before revalidation. `Rails.cache.clear` forces a refetch.
- A string is POSTed on every request: the miss guard lives in the cache; make sure the
  cache store is shared between processes (not `:memory_store` or `:null_store`).

## Offline try-out

Run `examples/_mock-server` (`node server.mjs`, port 8787) and set
`I18N_KEYLESS_API_URL=http://localhost:8787`, `I18N_KEYLESS_API_KEY=demo`,
`I18N_KEYLESS_PRIMARY_LANG=fr`. See `examples/rails/README.md`.

## Go deeper

- Gem README: `ports/rails/README.md`
- The whole i18n-keyless documentation as one file: https://docs.i18n-keyless.com/llms.txt
- Dashboard: https://i18n-keyless.com/dashboard

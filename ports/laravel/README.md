# i18n-keyless for Laravel

Keyless translations for Laravel. Your existing `__('Welcome to our app')` calls (Laravel's
JSON "keyless" mode) resolve through the i18n-keyless API: a missing string is translated by
AI once, for every language, and served from your cache from then on. No more `lang/*.json`
files to maintain by hand.

## Quick start

```bash
composer require i18n-keyless/laravel
```

```dotenv
# .env
I18N_KEYLESS_API_KEY=your-key        # https://i18n-keyless.com/#get-api-key
I18N_KEYLESS_LANGUAGES=en,fr,es      # every language your app serves
```

Done. `__('Welcome to our app')` returns the translation for `App::getLocale()`.

That is the whole integration: one `composer require`, two `.env` lines, zero code change.
Laravel 11, 12 and 13, PHP >= 8.2.

## How it works

1. Nothing happens for the primary language: the source string is the translation.
2. The first `__()` call that misses in another locale loads that locale's dictionary from
   your cache. On the very first request ever for that language, it is fetched from the API
   (`GET /translate/{lang}`) and stored. Then it is injected into Laravel's translator with
   Laravel's translator through the missing-key handler (`Lang::handleMissingKeysUsing`), so
   that every served string can be counted; with `I18N_KEYLESS_USAGE=false` it is injected
   with `Lang::addLines()` for the JSON group `*` instead. Laravel's own loader stays in
   place either way: PHP array files, vendor files and `lang/{locale}.json` keep working,
   and a line from `lang/{locale}.json` wins over the API's.
3. A string the dictionary does not have is returned as-is (the source text, with `:name`
   placeholders replaced by Laravel), and recorded. The request is never blocked by a miss.
4. After the response is sent (`app()->terminating`), the recorded strings are sent to
   `POST /translate` with the configured `languages` (plus the primary), deduplicated by key
   and context, at most 30 in flight at once, and the answers are merged into the cache. The
   next request has them. Without `I18N_KEYLESS_LANGUAGES` nothing is sent: the API stores
   the list it receives as the project's languages, so an incomplete list would damage every
   other client on the same key. One warning is logged per process.
5. A dictionary older than `cache.ttl` is still served, then revalidated after the response
   with its `ETag` (`If-None-Match`): an unchanged dictionary costs a bodyless `304`.
6. Usage analytics, like the node SDK: the date each string was last served is recorded and
   the cumulative map is sent to `POST /translate/last-used-translations` after the response,
   at most once every 10 s across all your processes (a lock in the cache). It feeds the
   dashboard's "last used" column so unused strings can be pruned. A failed POST never
   affects the response; the map waits in the cache for a later request.
   `I18N_KEYLESS_USAGE=false` switches it off.

Every API call has a 10 s timeout and is retried twice with backoff (500 ms, 1500 ms) on a
network error, a timeout, a `429` or a `5xx`. Any other `4xx` is not retried. Nothing ever
throws: on failure the page shows the source text, and the failure is remembered for 60 s so
the API is not hammered.

## Configuration

`php artisan vendor:publish --tag=i18n-keyless-config` writes `config/i18n-keyless.php`.
Every value has an `.env` counterpart:

| Config key | Env | Default | What it is |
| --- | --- | --- | --- |
| `enabled` | `I18N_KEYLESS_ENABLED` | `true` | `false` switches the package off: Laravel behaves as without it. |
| `api_key` | `I18N_KEYLESS_API_KEY` | none | Your project's key. Without it the package stays inactive. |
| `api_url` | `I18N_KEYLESS_API_URL` | `https://api.i18n-keyless.com` | The official service, or your own backend / proxy that speaks the same wire format. |
| `primary` | `I18N_KEYLESS_PRIMARY_LANG` | `config('app.locale')` | The language your source strings are written in (`en`, `fr`, `pt-BR`, `zh-Hans`...). A Laravel locale (`pt_BR`) is accepted. |
| `languages` | `I18N_KEYLESS_LANGUAGES` | empty | Required for translation. Every language your app serves, comma separated (`en,fr,es`). A new string is translated into all of them at once, and the API stores the list as the project's languages. When empty, missing strings are served as their source text and never sent; one warning is logged. |
| `namespace` | `I18N_KEYLESS_NAMESPACE` | `default` | The i18n-keyless namespace of the `__()` strings. |
| `cache.store` | `I18N_KEYLESS_CACHE_STORE` | default store | Any store from `config/cache.php` (file, redis, database, memcached, dynamodb...). |
| `cache.ttl` | `I18N_KEYLESS_CACHE_TTL` | `3600` | Seconds a dictionary is served without asking the API. After that it is revalidated with its `ETag` after the response. |
| `cache.prefix` | | `i18n-keyless` | Prefix of every cache key the package writes. |
| `timeout` | | `10` | HTTP timeout in seconds, per attempt. |
| `retry` | | `[500, 1500]` | Backoff in milliseconds between retries: two entries, two retries. |
| `concurrency` | | `30` | Maximum `POST /translate` requests in flight at once. |
| `usage` | `I18N_KEYLESS_USAGE` | `true` | Usage analytics: the date each string was last served, POSTed at most once every 10 s. `false` disables it and injects the dictionary with `Lang::addLines()`. |
| `queue` | `I18N_KEYLESS_QUEUE` | none | A queue name: the misses of a request are dispatched as one `TranslateMissingKeys` job instead of being sent in `terminating`. |

`I18N_KEYLESS_LANGUAGES` is the list the API translates a new string into, and the list it
stores as your project's languages (it replaces the previous one, like the `supported` list
the JavaScript SDKs send). A locale that is not in the list is served, but never translated.

## Locales

Laravel locales are mapped onto the 48 i18n-keyless codes: `fr` is `fr`, `pt_BR` is `pt-BR`,
`zh_CN` is `zh-Hans`, `zh_TW` is `zh-Hant`, `en_US` is `en`, `fr_FR` is `fr`, `es-419` is
`es-MX`. A locale no code matches (`xx`) is left alone: `__()` returns the source text and
nothing is sent. The full list is `I18nKeyless\Laravel\Locale::AVAILABLE_LANGS`.

## Context: one string, two meanings

`8 heures` is "8 hours" in a duration and "8 AM" on a clock. `__()` has one slot per string,
so use the `i18nk()` helper with a `context`:

```php
i18nk('8 heures', context: 'duration')     // "8 hours"
i18nk('8 heures', context: 'clock time')   // "8 AM"
i18nk('Bienvenue :name', ['name' => $user->name], context: 'greeting')
```

The string is stored as `key__context`, exactly like the JavaScript SDKs, so the dashboard
and every other SDK see the same entry. `i18nk()` without a context is `__()`.

Placeholders are Laravel's job: write `:name` in the source string, pass `['name' => ...]`
as the second argument, and Laravel replaces them after the translation. The SDKs' `replace`
option has no equivalent here because Laravel already does it.

`i18nk()` also takes `locale:` and `namespace:` named arguments.

## Cache

Dictionaries live in Laravel's cache under `i18n-keyless:{key-hash}:dict:{namespace}:{lang}`,
stored without expiry. `cache.ttl` is not their lifetime: it is how long they are served
without revalidation, so a stale dictionary is never thrown away before the API has confirmed
a newer one. To force a refetch, `php artisan cache:clear` (or forget those keys).

Under Octane, or in a queue worker, the process keeps the injected lines between requests;
they are refreshed when a revalidation brings a new dictionary, and after each `POST
/translate`. A dashboard edit reaches a running process at the next revalidation, at most
`cache.ttl` seconds later.

## Limitations

- **Plurals.** `trans_choice('Il y a une pomme|Il y a :count pommes', $n)` sends the whole
  pipe string as one source string, and the AI translates the pipe as text. Prefer one
  `i18nk()` per plural form with a `context` (`context: 'one'`, `context: 'other'`), or keep
  plurals in PHP array files (`lang/{locale}/messages.php`), which Laravel keeps loading.
- **Keys with a dot** (`__('Bonjour. Ça va ?')`) are served through the missing-key handler,
  not `addLines` (which splits on dots). Same result, one extra function call.
- **One `handleMissingKeysUsing` callback.** The package registers it. If your application
  registers its own (to log missing keys, say), call the package from it:
  `app(\I18nKeyless\Laravel\KeylessTranslator::class)->handleMissingKey($key, $replace, $locale, $fallback)`.
- **Same string in two namespaces.** The lines of every namespace are injected into Laravel's
  single JSON group per locale; the last one injected wins for `__()`.
- **Usage analytics** count the strings served by this package only. A string served from
  `lang/{locale}.json` never reaches it, so it is not counted.
- **Blade compiled views** are not affected: `__()` runs at render time, not compile time.

## Self-hosted backend or proxy

Point `I18N_KEYLESS_API_URL` at a server that speaks the three-route wire format
(`GET /translate/{lang}`, `POST /translate`, `POST /translate/last-used-translations`).
See https://docs.i18n-keyless.com/docs/guides/proxy-mode. Every request carries
`Authorization: Bearer <api_key>`, `Version: 3.3.0` (the wire dialect: v3 language codes) and
`sdk: laravel` (a server label, counted like `node`: by its connection, not by a device id). The usage
route `POST /translate/last-used-translations` is called too.

## Publishing to Packagist

This directory lives inside the `i18n-keyless` monorepo and is not an npm workspace.
Packagist needs a repository whose root is this directory. Either split it:

```bash
git subtree split --prefix=ports/laravel -b laravel-package
git push git@github.com:arnaudambro/i18n-keyless-laravel.git laravel-package:main
```

or keep a mirror repository in sync from CI, then submit that repository on Packagist as
`i18n-keyless/laravel`. Tag releases on the mirror; the version number follows the SDKs
(`3.x`).

## Development

```bash
cd ports/laravel
composer install
vendor/bin/phpunit
```

```bash
composer test:coverage      # vendor/bin/phpunit --coverage-text
```

The coverage report needs a driver: `pcov` (fast) or Xdebug with `XDEBUG_MODE=coverage`.
With Homebrew's PHP, `pecl install pcov` builds it; if the build cannot find `pcre2.h`,
pass the header path (`CPPFLAGS=-I$(brew --prefix pcre2)/include pecl install pcov`), and
if the install step cannot create the extension directory, create it first
(`mkdir -p $(php -i | sed -n 's/^extension_dir => \([^ ]*\).*/\1/p')`). `php -m | grep pcov`
confirms it. The `<coverage>` block of `phpunit.xml` limits the report to `src/`; every file
there is kept at 95 % of its lines or more.

Tests run on Orchestra Testbench with `Http::fake()`: no network, no key.
`tests/Conformance/VectorsTest.php` replays the monorepo's shared protocol vectors
(`conformance/vectors/*.json`): language codes, locale resolution, storage key, namespace
resolution, retry decisions, backoff scenarios, dictionary and translate requests and
responses. The test is skipped when the vectors directory is absent (standalone checkout).

One deliberate difference from the JavaScript SDKs: misses are deduplicated by key AND
context (the SDK queue ignores the context), so two contexts of one string on one page are
both translated after that page. Usage analytics follow the node SDK (`sdk: laravel` is a server label with the `node` rules).

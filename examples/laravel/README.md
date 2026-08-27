# i18n-keyless · Laravel

Try the `i18n-keyless/laravel` package ([`ports/laravel`](../../ports/laravel)) against the
bundled offline mock backend: no API key, no network. The package is a Composer library, not
an npm workspace, and this folder holds no Laravel application: the five commands below create
a throwaway one next to it.

Primary language is **`fr`**, like every example: the source strings are French, the mock
serves `en` and `es` from [`_mock-server/fixtures.json`](../_mock-server/fixtures.json).

## Five commands

```bash
# 1. the mock backend, in another terminal (http://localhost:8787)
(cd examples/_mock-server && node server.mjs)

# 2. a fresh Laravel app, with the package required from the monorepo path
composer create-project laravel/laravel examples/laravel/demo && cd examples/laravel/demo
composer config repositories.i18n-keyless path ../../../ports/laravel && composer require i18n-keyless/laravel:@dev

# 3. one .env block (the real service needs only I18N_KEYLESS_API_KEY and I18N_KEYLESS_LANGUAGES)
printf 'I18N_KEYLESS_API_KEY=demo\nI18N_KEYLESS_API_URL=http://localhost:8787\nI18N_KEYLESS_PRIMARY_LANG=fr\nI18N_KEYLESS_LANGUAGES=fr,en,es\n' >> .env

# 4. an existing __() call, unchanged, in English
php artisan tinker --execute="App::setLocale('en'); echo __('Changer de langue'), PHP_EOL, i18nk('8 heures', context: 'durée'), PHP_EOL;"

# 5. a string the mock does not know: the source text now, a POST /translate after the response
php artisan tinker --execute="App::setLocale('es'); echo __('Bonjour :name', ['name' => 'Ada']), PHP_EOL;"
```

Expected output of step 4: `Switch language` then `8 hours` (the mock's canned value for
`8 heures__durée`). Step 5 prints `Bonjour Ada` (a miss returns the source text with its
placeholders replaced) and the mock logs a `POST /translate` for `Bonjour :name` once the
command terminates.

`examples/laravel/demo` is a throwaway: delete it when done (it is not part of the repo).

## Real service

Drop `I18N_KEYLESS_API_URL`, put your real key in `I18N_KEYLESS_API_KEY`, and the AI
service translates any new string on demand, once, for every language in
`I18N_KEYLESS_LANGUAGES`.

## What the mock covers

| Method | Path | Package call |
| --- | --- | --- |
| `GET` | `/translate/:lang` | the dictionary of one locale, on its first miss |
| `POST` | `/translate` | the misses, after the response |

The mock sends no `ETag`, so the `304` revalidation path is exercised by the package's test
suite (`cd ports/laravel && vendor/bin/phpunit`), not by this demo.

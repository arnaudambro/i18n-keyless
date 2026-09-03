# i18n-keyless · Ruby on Rails

Try the `i18n-keyless-rails` gem ([`ports/rails`](../../ports/rails)) against the bundled
offline mock backend: no API key, no network. The gem is a RubyGem, not an npm workspace, and
this folder holds no Rails application: the five commands below create a throwaway one next
to it.

Primary language is **`fr`**, like every example: the source strings are French, the mock
serves `en` and `es` from [`_mock-server/fixtures.json`](../_mock-server/fixtures.json).

## Five commands

```bash
# 1. the mock backend, in another terminal (http://localhost:8787)
(cd examples/_mock-server && node server.mjs)

# 2. a fresh Rails app, with the gem required from the monorepo path
rails new examples/rails/demo --minimal && cd examples/rails/demo
bundle add i18n-keyless-rails --path ../../../ports/rails

# 3. one .env block (the real service needs only I18N_KEYLESS_API_KEY and I18N_KEYLESS_LANGUAGES)
export I18N_KEYLESS_API_KEY=demo I18N_KEYLESS_API_URL=http://localhost:8787 I18N_KEYLESS_PRIMARY_LANG=fr I18N_KEYLESS_LANGUAGES=fr,en,es

# 4. a t() call with a source string, in English
bin/rails runner "I18n.enforce_available_locales = false; I18n.locale = :en; puts I18n.t('Changer de langue'); puts I18nKeyless.t('8 heures', context: 'durée')"

# 5. a string the mock does not know: the source text now, a POST /translate at exit
bin/rails runner "I18n.enforce_available_locales = false; I18n.locale = :es; puts I18n.t('Bonjour %{name}', name: 'Ada')"
```

Expected output of step 4: `Switch language` then `8 hours` (the mock's canned value for
`8 heures__durée`). Step 5 prints `Bonjour Ada` (a miss returns the source text with its
placeholders replaced) and the mock logs a `POST /translate` for `Bonjour %{name}` when the
runner exits (the Railtie flushes at exit; in a web request, after the response).

In a view the same calls are `<%= t('Changer de langue') %>` and
`<%= i18nk('8 heures', context: 'durée') %>`; a language switcher is `I18n.locale = params[:locale]`
in an `around_action`, as in any Rails app.

`examples/rails/demo` is a throwaway: delete it when done (it is not part of the repo).

## Real service

Drop `I18N_KEYLESS_API_URL`, put your real key in `I18N_KEYLESS_API_KEY`, and the AI
service translates any new string on demand, once, for every language in
`I18N_KEYLESS_LANGUAGES`.

## What the mock covers

| Method | Path | Gem call |
| --- | --- | --- |
| `GET` | `/translate/:lang` | the dictionary of one locale, on its first miss |
| `POST` | `/translate` | the misses, after the response |
| `POST` | `/translate/last-used-translations` | the usage map, at most every 10 s |

The mock sends no `ETag`, so the `304` revalidation path is exercised by the gem's test
suite (`cd ports/rails && bundle exec rake test`), not by this demo.

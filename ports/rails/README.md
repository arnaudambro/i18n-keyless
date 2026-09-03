# i18n-keyless for Ruby on Rails

Keyless translations for Rails. Write the source string where a key would go,
`t('Welcome to our app')`, and it resolves through the i18n-keyless API: a missing string is
translated by AI once, for every language, and served from `Rails.cache` from then on. No more
`config/locales/*.yml` files to maintain by hand.

## Quick start

```bash
bundle add i18n-keyless-rails
```

```dotenv
# .env
I18N_KEYLESS_API_KEY=your-key        # https://i18n-keyless.com/#get-api-key
I18N_KEYLESS_LANGUAGES=en,fr,es      # every language your app serves
```

```erb
<h1><%= t('Welcome to our app') %></h1>
<p><%= t('Welcome %{name}', name: current_user.name) %></p>
<%= i18nk('8 heures', context: 'duration') %>
```

Done. `t('Welcome to our app')` returns the translation for `I18n.locale`.

That is the whole integration: one gem, two `.env` lines, and your source strings where the
keys used to be. Rails 7.0 to 8.x, Ruby >= 3.1.

## How it works

1. Nothing happens for the primary language: the source string is the translation.
2. The gem is an `I18n` backend chained **after** your own: `I18n::Backend::Chain.new(your
   backend, I18nKeyless::Backend.new)`. A key found in `config/locales/*.yml` wins and never
   reaches the API. The first `t()` call that misses in another locale loads that locale's
   dictionary from `Rails.cache`. On the very first request ever for that language, it is
   fetched from the API (`GET /translate/{lang}`) and stored.
3. A string the dictionary does not have is returned as-is (the source text, with `%{name}`
   placeholders replaced by I18n), and recorded. The request is never blocked by a miss.
4. After the response is sent (a Rack middleware closes the body), the recorded strings are
   sent to `POST /translate` with the configured `languages` (plus the primary), deduplicated
   by key and context, at most 30 in flight at once, and the answers are merged into the
   cache. The next request has them. Without `I18N_KEYLESS_LANGUAGES` nothing is sent: the
   API stores the list it receives as the project's languages, so an incomplete list would
   damage every other client on the same key. One warning is logged per process.
5. A dictionary older than `cache_ttl` is still served, then revalidated after the response
   with its `ETag` (`If-None-Match`): an unchanged dictionary costs a bodyless `304`.
6. Usage analytics, like the node SDK: the date each string was last served is recorded and
   the cumulative map is sent to `POST /translate/last-used-translations` after the response,
   at most once every 10 s across all your processes (a lock in the cache). It feeds the
   dashboard's "last used" column so unused strings can be pruned. A failed POST never
   affects the response; the map waits in the cache for a later request.
   `I18N_KEYLESS_USAGE=false` switches it off.

Every API call has a 10 s timeout and is retried twice with backoff (500 ms, 1500 ms) on a
network error, a timeout, a `429` or a `5xx`. Any other `4xx` is not retried. Nothing ever
raises: on failure the page shows the source text, and the failure is remembered for 60 s so
the API is not hammered.

## Which strings are keyless

Rails keys and source strings share one `t()`. The rule (`I18nKeyless.keyless_key?`):

- a **Rails key** is a Symbol, a key with a `scope:`, or a lowercase identifier path:
  `t(:hello)`, `t('hello')`, `t('users.index.title')`, `t('.title')` (lazy lookup),
  `t('activerecord.errors.models.user')`. Those go to your YAML files, as before, and are
  never sent to the API. A missing one is still a missing translation.
- everything else is a **source string**: a space, an uppercase letter or a punctuation mark
  is enough. `t('Welcome to our app')`, `t('Bonjour')`, `t('Bonjour. Ça va ?')` (a dot in a
  source string is not a separator).

For a lowercase one-word source string (`close`, `cancel`) use the helper, which never
treats its argument as a key: `i18nk('close')`. The rule is `config.rails_key_pattern`
(default `/\A[a-z0-9_]+(\.[a-z0-9_]+)*\z/`); set it to `nil` to make every string keyless.

## Configuration

```ruby
# config/initializers/i18n_keyless.rb (optional: every value has an .env counterpart)
I18nKeyless.configure do |c|
  c.api_key = ENV.fetch("I18N_KEYLESS_API_KEY")
  c.languages = %w[en fr es]
  c.primary = "en"
  c.cache = Rails.cache
end
```

| Config | Env | Default | What it is |
| --- | --- | --- | --- |
| `enabled` | `I18N_KEYLESS_ENABLED` | `true` | `false` switches the gem off: Rails behaves as without it. |
| `api_key` | `I18N_KEYLESS_API_KEY` | none | Your project's key. Without it the gem stays inactive. |
| `api_url` | `I18N_KEYLESS_API_URL` | `https://api.i18n-keyless.com` | The official service, or your own backend / proxy that speaks the same wire format. |
| `primary` | `I18N_KEYLESS_PRIMARY_LANG` | `I18n.default_locale` | The language your source strings are written in (`en`, `fr`, `pt-BR`, `zh-Hans`...). A Rails locale (`pt_BR`, `:"zh-CN"`) is accepted. |
| `languages` | `I18N_KEYLESS_LANGUAGES` | empty | Required for translation. Every language your app serves, comma separated (`en,fr,es`) or an array. A new string is translated into all of them at once, and the API stores the list as the project's languages. When empty, missing strings are served as their source text and never sent; one warning is logged. |
| `namespace` | `I18N_KEYLESS_NAMESPACE` | `default` | The i18n-keyless namespace of the `t()` strings. |
| `cache` | | `Rails.cache` | Any `ActiveSupport::Cache::Store` (memory, file, Redis, Memcached, the database). Outside Rails: a `MemoryStore`. |
| `cache_ttl` | `I18N_KEYLESS_CACHE_TTL` | `3600` | Seconds a dictionary is served without asking the API. After that it is revalidated with its `ETag` after the response. |
| `cache_prefix` | | `i18n-keyless` | Prefix of every cache key the gem writes. |
| `timeout` | | `10` | HTTP timeout in seconds, per attempt. |
| `retry` | | `[500, 1500]` | Backoff in milliseconds between retries: two entries, two retries. |
| `concurrency` | | `30` | Maximum `POST /translate` requests in flight at once. |
| `usage` | `I18N_KEYLESS_USAGE` | `true` | Usage analytics: the date each string was last served, POSTed at most once every 10 s. `false` disables it. |
| `queue` | `I18N_KEYLESS_QUEUE` | none | An ActiveJob queue name: the misses of a request are enqueued as one `I18nKeyless::TranslateMissingKeysJob` instead of being sent after the response. |
| `logger` | | `Rails.logger` | Where the `i18n-keyless:` warnings go. |
| `rails_key_pattern` | | see above | The Rails-key rule. `nil`: every string is keyless. |

`I18N_KEYLESS_LANGUAGES` is the list the API translates a new string into, and the list it
stores as your project's languages (it replaces the previous one, like the `supported` list
the JavaScript SDKs send). A locale that is not in the list is served, but never translated.

Rails validates `I18n.locale` against `I18n.available_locales`, which it derives from the
YAML files present. An app that serves a locale with no YAML file lists it explicitly:
`config.i18n.available_locales = %i[en fr es]`.

## Locales

Rails locales are mapped onto the 48 i18n-keyless codes: `:fr` is `fr`, `:"pt-BR"` and
`pt_BR` are `pt-BR`, `zh_CN` is `zh-Hans`, `zh_TW` is `zh-Hant`, `en_US` is `en`, `fr_FR` is
`fr`, `es-419` is `es-MX`. A locale no code matches (`xx`) is left alone: `t()` returns the
source text and nothing is sent. The full list is `I18nKeyless::Locale::AVAILABLE_LANGS`.

## Context: one string, two meanings

`8 heures` is "8 hours" in a duration and "8 AM" on a clock. Pass a `context`, through `t()`
or through the `i18nk` helper (mixed into views, controllers, mailers and jobs):

```ruby
t('8 heures', context: 'duration')            # "8 hours"
i18nk('8 heures', context: 'clock time')      # "8 AM"
i18nk('Bienvenue %{name}', name: user.name, context: 'greeting')
i18nk('Payer', namespace: 'checkout')         # an i18n-keyless namespace
I18nKeyless.t('Payer', namespace: 'checkout') # the same, outside a view
```

The string is stored as `key__context`, exactly like the JavaScript SDKs, so the dashboard
and every other SDK see the same entry.

Placeholders are I18n's job: write `%{name}` in the source string, pass `name:` as an
option, and I18n replaces it after the translation. The SDKs' `replace` option has no
equivalent here because I18n already does it.

`i18nk(text, values = nil, context: nil, locale: nil, namespace: nil, **values)`.

## Cache

Dictionaries live in `Rails.cache` under `i18n-keyless:{key-hash}:dict:{namespace}:{lang}`
(the same layout as the Laravel port), stored without expiry. `cache_ttl` is not their
lifetime: it is how long they are served without revalidation, so a stale dictionary is
never thrown away before the API has confirmed a newer one. To force a refetch,
`Rails.cache.clear` (or delete those keys). `I18n.reload!` forgets the dictionaries a
process holds and re-reads the cache.

Every process (Puma workers, Sidekiq workers) keeps the loaded dictionaries between
requests; they are refreshed when a revalidation brings a new dictionary, and after each
`POST /translate`. A dashboard edit reaches a running process at the next revalidation, at
most `cache_ttl` seconds later. The miss guard and the usage lock live in the cache too:
with a `:memory_store` they are per process, so use a shared store (Redis, Memcached, the
database, the file store) in production, as Rails recommends anyway.

## Limitations

- **Plurals.** `t('Il y a %{count} pommes', count: n)` sends one source string and I18n
  replaces `%{count}`; the pluralisation rules of YAML (`one:` / `other:`) do not apply to a
  source string. Prefer one `i18nk()` per plural form with a `context` (`context: 'one'`,
  `context: 'other'`), or keep plurals in YAML files, which Rails keeps loading.
- **HTML safety.** A source string is a plain string: ERB escapes it like any `t()` result.
  The `_html` key suffix convention does not apply to a source string.
- **One key space per locale.** The lines of every namespace are looked up by the same `t()`;
  pass `namespace:` on the call, or set `I18N_KEYLESS_NAMESPACE` for the whole app.
- **Misses are deduplicated by key AND context** (the SDK queue ignores the context), so two
  contexts of one string on one page are both translated after that page.
- **Usage analytics** count the strings served by this gem only. A string served from a
  YAML file never reaches it, so it is not counted.
- **Threads.** One translator per process, shared by every thread. The misses of concurrent
  requests are flushed together by whichever response finishes first (the cache guard keeps
  each one from being POSTed twice).

## Outside Rails

The gem needs only `i18n` and `activesupport`. In a plain Ruby, Sinatra or Hanami app:

```ruby
require "i18n_keyless"

I18nKeyless.configure do |c|
  c.api_key = ENV.fetch("I18N_KEYLESS_API_KEY")
  c.languages = %w[en fr]
  c.cache = ActiveSupport::Cache::MemoryStore.new   # or any store
end
I18nKeyless.install!                                # chains the backend after I18n.backend
use I18nKeyless::Middleware                         # Rack: flush after each response
I18nKeyless.t("Bonjour", locale: :en)               # without the helper
I18nKeyless.flush                                   # a script: send the misses before exit
```

## Self-hosted backend or proxy

Point `I18N_KEYLESS_API_URL` at a server that speaks the three-route wire format
(`GET /translate/{lang}`, `POST /translate`, `POST /translate/last-used-translations`).
See https://docs.i18n-keyless.com/docs/guides/proxy-mode. Every request carries
`Authorization: Bearer <api_key>`, `Version: 3.5.0` (the wire dialect: v3 language codes) and
`sdk: rails` (a server label, counted like `node`: by its connection, not by a device id).

## Publishing to RubyGems

This directory lives inside the `i18n-keyless` monorepo and is not an npm workspace. The
gem builds from here:

```bash
cd ports/rails
gem build i18n-keyless-rails.gemspec
gem push i18n-keyless-rails-3.5.0.gem
```

The version number follows the SDKs (`3.x`, `lib/i18n_keyless/version.rb`, written by
`scripts/set-version.mjs`).

## Development

```bash
cd ports/rails
bundle install
bundle exec rake test
```

Tests run on minitest with WebMock: no network, no key. `test/conformance/vectors_test.rb`
replays the monorepo's shared protocol vectors (`conformance/vectors/*.json`): language
codes, locale resolution, storage key, namespace resolution, retry decisions, backoff
scenarios, dictionary and translate requests and responses, usage requests. The test is
skipped when the vectors directory is absent (standalone checkout).
`test/integration/railtie_test.rb` boots a one-file Rails application and drives a request
through the middleware.

One deliberate difference from the JavaScript SDKs: misses are deduplicated by key AND
context (the SDK queue ignores the context). Usage analytics follow the node SDK
(`sdk: rails` is a server label with the `node` rules).

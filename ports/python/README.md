# i18n-keyless for Python

Keyless translations for a Python server, a script or a build step. Write the source string
where a key would go, `t("Welcome to our app", lang)`, and it resolves through the
i18n-keyless API: a missing string is translated by AI once, for every language, and served
from memory from then on. No `.po` files, no message catalogue, no key to name.

## Quick start

```bash
pip install i18n-keyless        # or: uv add i18n-keyless
```

```python
import i18n_keyless as i18n

i18n.init(api_key="your-key", primary="en", supported=["en", "fr", "es"])   # once, at start
print(i18n.t("Welcome to our app", "fr"))       # "Bienvenue dans notre application"
print(i18n.t("Welcome to our app", "es"))       # switch language: pass another code
```

Done. Run it: the first call POSTs the string to the API and returns the translation; every
later call, in any language, is served from memory. Python >= 3.9, no dependency.

Get a key at https://i18n-keyless.com/#get-api-key.

## How it works

1. `init()` validates the config and loads every language of the default namespace in one
   request (`GET /translate/`), like the node SDK. Call it once, at process start. Another
   namespace is loaded after its first miss.
2. `t(key, lang)` in the primary language returns the key: no lookup, no request.
3. In another language, a string the store has is returned at once. A string it does not
   have is POSTed to `/translate` **synchronously** with every language of `supported`; the
   API answers with the whole row, the answer is cached for every language, and the
   translation is returned. The page is complete when it is served: no flash of source
   text, no second render.
4. Concurrent misses of one string (N request handlers rendering the same page) share one
   request; at most 30 requests are in flight at once, process-wide.
5. When the batch drains, the namespaces that missed are refetched on a daemon thread
   (`GET /translate/`, with `If-None-Match`: an unchanged namespace costs a bodyless 304),
   so a cell the AI filled later or a dashboard edit reaches the process.
6. Usage analytics, like the node SDK: the UTC date each string was last served is
   recorded on every call and the cumulative map is POSTed at most once every 10 s from a
   daemon thread that never keeps the process alive. It feeds the dashboard's "last used"
   column so unused strings can be pruned. Call `flush_usage()` before a script exits.

Every request has a 10 s timeout and is retried twice with backoff (500 ms, 1500 ms) on a
network error, a timeout, a `429`, a `5xx` or an unparsable body. Any other `4xx` is not
retried. `t()` never raises: a failed request logs an error and returns the source text.
`t_or_raise()` is the same call for a script or a build step, where a wrong language is
worse than a crash: it raises `TranslationError`.

## Configuration

```python
i18n.init(
    api_key="...",                      # required (sent as `Authorization: Bearer`)
    primary="en",                       # the language the source strings are written in
    supported=["en", "fr", "es"],       # every language the app serves; stored by the API as the project's list
    api_url=None,                       # a self-hosted backend or a proxy, no trailing slash
    default_namespace=None,             # the namespace of every call that passes none
    debug=False,                        # DEBUG lines on the `i18n_keyless` logger
    on_init=None,                       # called once with the primary language
    handle_translate=None,              # custom handlers, see below
    get_all_translations_for_all_languages=None,
    send_translations_usage=None,
)
```

`init()` also takes a `Config` dataclass (`i18n.Config(...)`). For several projects in one
process, build your own client: `client = i18n.I18nKeyless(); client.init(config)`.

### The three network modes, in priority order

1. **Custom handlers.** `handle_translate(key)` replaces `POST /translate` and receives the
   key only; it returns `{"ok": True, "data": {"translation": {"en": "...", "fr": "..."}}}`.
   `get_all_translations_for_all_languages()` replaces `GET /translate/` and returns the
   all-languages envelope. `send_translations_usage(default_bucket)` replaces the usage
   POST and receives the `default` namespace's map only.
2. **Self-hosted**: `api_url="https://your.server"`, a backend or a proxy that speaks the
   wire format (https://docs.i18n-keyless.com/docs/guides/proxy-mode).
3. **The official service**, `https://api.i18n-keyless.com`.

## Per-call options

```python
i18n.t("8 hours", "fr", context="duration")               # one string, two meanings: stored as "8 hours__duration"
i18n.t("Hello {{name}}", "fr", replace={"{{name}}": "Ada"})  # placeholders, replaced after the translation
i18n.t("Pay", "fr", namespace="checkout")                  # an i18n-keyless namespace
i18n.t("Hi", "fr", namespace="chat-42", unpersisted_namespace=True)  # transient: never reported in usage
i18n.t("Hola mundo", "en", origin_language="es")           # user generated content written in Spanish
i18n.t("Hello", "fr", force_temporary={"fr": "Salut"})     # overwrite the stored French cell, permanently
```

`replace`: every placeholder is a literal, all are replaced in one pass, and a placeholder
whose replacement is empty is left in place, exactly like the JavaScript SDKs. The
imperative function never trims the source string.

### Languages

`supported` and `lang` take the 48 codes of the API (`i18n.AVAILABLE_LANGS`):
`ar bn ca zh-Hans zh-Hant hr cs da nl en en-GB fi fr fr-CA de el gu he hi hu id it ja kn ko
ms ml mr no or pl pt pt-BR pa ro ru sk sl es es-MX sv ta te th tr uk ur vi`. To turn an
`Accept-Language` value or a user setting into one of them:

```python
i18n.resolve_lang("pt_BR", supported=["pt", "en"], fallback="en")   # "pt"
i18n.resolve_lang("zh-TW")                                         # "zh-Hant"
i18n.to_app_store_locale("fr")                                     # "fr-FR"
```

## In a web framework

The port is framework-free: call `t()` with the request's language. `init()` runs once at
process start (a module import, an app factory, a `ready()` hook).

**Django**: a template tag in `yourapp/templatetags/keyless.py`, then `{% load keyless %}`
and `{% t "Welcome to our app" %}` in a template. The language comes from Django's own
`translation.get_language()`, so `LocaleMiddleware` and `?lang=` keep working.

```python
from django import template
from django.utils import translation
import i18n_keyless as i18n

register = template.Library()

@register.simple_tag
def t(text, context=None):
    lang = i18n.resolve_lang(translation.get_language(), supported=i18n.get_supported_languages(), fallback="en")
    return i18n.t(text, lang, context=context)
```

**Flask**:

```python
import i18n_keyless as i18n
from flask import Flask, request

app = Flask(__name__)
i18n.init(api_key=..., primary="en", supported=["en", "fr", "es"])

@app.get("/")
def home():
    lang = i18n.resolve_lang(request.args.get("lang") or request.accept_languages.best, supported=["en", "fr", "es"], fallback="en")
    return f"<h1>{i18n.t('Welcome to our app', lang)}</h1>"
```

**FastAPI**: the same, with `i18n.init()` in the lifespan and `t()` in a dependency that
resolves the language from the `Accept-Language` header. `t()` blocks for the request on a
miss (once per string per process): call it in a threadpool (`run_in_threadpool`) in an
async handler if a first render must never wait on the network.

## Self-hosted backend or proxy

Point `api_url` at a server that speaks the four-route wire format (`GET /translate/`,
`GET /translate/{lang}`, `POST /translate`, `POST /translate/last-used-translations`).
Every request carries `Content-Type: application/json`, `Authorization: Bearer <api_key>`,
`Version: 3.6.1` (the wire dialect: v3 language codes) and `sdk: python` (a server label,
counted like `node`: by its connection, never by a device id). Nothing else, no cookie.

## Limitations

- **Plurals.** One source string per form, with a `context` (`context="one"`,
  `context="other"`): the API translates strings, not ICU messages.
- **Misses block the call** (once per string per process), like `awaitForTranslation` in the
  node SDK. A miss costs one round trip, capped at 3 × 10 s.
- **One store per process.** Workers (gunicorn, uvicorn) each fetch the dictionaries at
  boot; a dashboard edit reaches a process at its next refetch, after a miss.
- **`force_temporary` in the primary language sends nothing**, like the client SDKs (the
  node SDK sends it). Pass another language.
- A source string is capped at 2000 characters (`context` and `namespace` at 200).
  Long-form content is one translation per Markdown block:
  https://docs.i18n-keyless.com/docs/guides/long-form-content

## Publishing to PyPI

This directory lives inside the `i18n-keyless` monorepo and is not an npm workspace. The
package builds from here, with the version read from `src/i18n_keyless/version.py`
(written by `scripts/set-version.mjs`, shared by every SDK):

```bash
cd ports/python
uv build
uv publish          # PyPI: https://pypi.org/project/i18n-keyless/
```

## Development

```bash
cd ports/python
uv run pytest
```

Tests run on a scripted transport: no network, no key. `tests/test_vectors.py` replays
every file of the monorepo's shared protocol vectors (`conformance/vectors/*.json`):
language codes, locale resolution, storage key, `replace`, namespace resolution, retry
decisions, backoff scenarios, translate, dictionary and usage requests and responses, the
queue (dedupe and the 30-in-flight cap), the runtime label. `tests/test_integration.py`
drives the client end to end.

Deliberate differences from the JavaScript SDKs: a miss is translated on the spot and
returned (the node rule), not queued and rendered on the next pass (the client rule), so two
contexts of one key in one batch are two requests (the SDK queue makes one); the store has a
namespace dimension (the node store has none); ETags are remembered per (API key, `all`,
namespace). Usage analytics follow the node SDK
(`sdk: python` is a server label with the `node` rules).

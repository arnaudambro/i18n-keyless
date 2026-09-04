# i18n-keyless for Go

Keyless translations for Go servers. Write the source text where a key would go,
`client.T(ctx, "Welcome to our app", lang)`, and it resolves through the i18n-keyless API:
a missing string is translated by AI once, for every language, and served from memory from
then on. No locale files to maintain by hand.

## Quick start

```bash
go get github.com/arnaudambro/i18n-keyless/ports/go/v3
```

```go
import i18nkeyless "github.com/arnaudambro/i18n-keyless/ports/go/v3"

client, err := i18nkeyless.Init(ctx, i18nkeyless.Config{
	APIKey:    os.Getenv("I18N_KEYLESS_API_KEY"),            // https://i18n-keyless.com/#get-api-key
	Languages: i18nkeyless.Languages{Primary: "en", Supported: []string{"en", "fr", "es"}},
})
fmt.Println(client.T(ctx, "Welcome to our app", "fr"))       // "Bienvenue dans notre application"
fmt.Println(client.T(ctx, "Welcome to our app", "es"))       // switching language is passing another code
```

Done. Five lines: install, init with the key and the languages, render one string, render it
in another language, run. Go >= 1.21, standard library only.

## How it works

1. `Init` loads every language's dictionary of the default namespace in one
   `GET /translate/` and keeps them in memory, one flat map per language. A failed boot fetch
   is logged, never returned: the app starts with empty dictionaries and translates on miss.
2. Nothing happens for the primary language: the source text is the translation. `T`
   returns it with no lookup and no request.
3. A hit is served from memory. A miss is sent to `POST /translate` **in the call** (the
   semantics of the node SDK): the API answers with the stored row, every language of it is
   cached, and the caller receives the translation. Concurrent misses of one text collapse
   into one request; at most 30 requests are in flight at once.
4. When a burst of misses settles, the namespaces that missed are fetched again in the
   background (`GET /translate/?namespace=`), so the store also holds what other processes
   translated meanwhile. The previous answer's `ETag` is replayed as `If-None-Match`: an
   unchanged dictionary costs a bodyless `304`.
5. `T` never fails: a failed request is logged and the source text is returned, with the
   `replace` option applied. `Translate` is the same call with the error.
6. Usage analytics, like the node SDK: the UTC date each string was last served is recorded
   and the cumulative map is sent to `POST /translate/last-used-translations` at most once
   every 10 s, from a background timer. `FlushUsage` sends it now (a script that exits);
   `DisableUsage: true` switches it off.

Every API call has a 10 s timeout and is retried twice with backoff (500 ms, 1500 ms) on a
network error, a timeout, a `429` or a `5xx`. Any other `4xx` is not retried. Nothing ever
panics, and a stored translation is never cleared by a failure.

## Configuration

| Field | Default | What it is |
| --- | --- | --- |
| `APIKey` | none | Your project's public key. Required unless `APIURL` names your own backend, or both `HandleTranslate` and `GetAllTranslationsForAllLanguages` are set. |
| `APIURL` | `https://api.i18n-keyless.com` | A self-hosted backend or proxy that speaks the same wire format, without a trailing slash. |
| `Languages.Primary` | required | The language your source texts are written in (`en`, `fr`, `pt-BR`, `zh-Hans`...). Set on the project by its first translation, immutable afterwards. |
| `Languages.Supported` | required | Every language your app serves. A new string is translated into all of them at once, and the API stores the list as the project's languages (it replaces the previous one). |
| `DefaultNamespace` | `default` | The namespace of calls that pass no `WithNamespace`. |
| `HTTPClient` | `http.DefaultClient` | Performs the requests. Timeouts are applied per attempt by the port. |
| `Logger` | `log.Default()` | Receives the `i18n-keyless:` warnings. Any `Printf(format, v...)`. |
| `Debug` | `false` | Logs every lookup and request. |
| `DisableUsage` | `false` | Switches usage analytics off. |
| `HandleTranslate` | none | Replaces `POST /translate`: receives the source text only, returns translations by language code. |
| `GetAllTranslationsForAllLanguages` | none | Replaces `GET /translate/`: every dictionary at once, by language then storage key. |
| `SendTranslationsUsage` | none | Replaces the usage POST: receives the default namespace's bucket. |
| `OnInit` | none | Called once with the primary language, before the boot fetch. |

`New(cfg)` validates the configuration and returns an empty client without touching the
network; `Init(ctx, cfg)` is `New` plus the boot fetch. Both reject an unknown language code
(`cn` and `cz`, the v2 spellings, are not codes: use `zh-Hans` and `cs`).

## Per-call options

```go
client.T(ctx, "8 heures", lang, i18nkeyless.WithContext("duration"))        // one string, two meanings: stored as "8 heures__duration"
client.T(ctx, "Payer", lang, i18nkeyless.WithNamespace("checkout"))         // an i18n-keyless namespace
client.T(ctx, "Hello {{name}}", lang, i18nkeyless.WithReplace(map[string]string{"{{name}}": user.Name}))
client.T(ctx, "Hola mundo", lang, i18nkeyless.WithOriginLanguage("es"))    // user generated content written in Spanish
client.T(ctx, "Bonjour", lang, i18nkeyless.WithForceTemporary(map[string]string{"en": "Hi there"})) // your own text, stored by the API
client.T(ctx, msg, lang, i18nkeyless.WithNamespace("chat-42"), i18nkeyless.WithUnpersistedNamespace()) // transient: no usage recorded
```

`WithReplace` placeholders are literal strings, every occurrence is replaced in one pass, an
empty replacement leaves the placeholder in place. When two placeholders can match at the
same position (`{{a}}` and `{{a}}x`), `WithReplaceOrdered` names the priority.

The text is not trimmed: what you pass is what is stored and looked up. A source text is
capped at 2000 characters (`context` and `namespace` at 200) by the API. Long-form content
is one translation per Markdown block of about 1000 characters, with the same `context` on
every block of a document: https://docs.i18n-keyless.com/docs/guides/long-form-content

## In an HTTP handler

The language of a request comes from wherever you keep it (a `?lang=` parameter, a cookie,
`Accept-Language`); `ResolveLang` maps a BCP-47 tag onto the languages you ship:

```go
func lang(r *http.Request) string {
	return i18nkeyless.ResolveLang(r.URL.Query().Get("lang"), &i18nkeyless.ResolveOptions{
		Supported: client.SupportedLanguages(), Fallback: client.PrimaryLanguage(),
	})
}

http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, client.T(r.Context(), "Welcome to our app", lang(r)))
})
```

With `html/template`, a `t` function in the func map keeps the templates keyless:

```go
tmpl := template.Must(template.New("page").Funcs(template.FuncMap{
	"t": func(lang, text string) string { return client.T(context.Background(), text, lang) },
}).Parse(`<h1>{{t .Lang "Welcome to our app"}}</h1>`))
```

With Gin (or any router), the same call:

```go
r.GET("/", func(c *gin.Context) {
	c.String(200, client.T(c.Request.Context(), "Welcome to our app", c.Query("lang")))
})
```

A miss blocks the handler for one API round trip (about the time of an AI translation, once
per string per process lifetime). Every later request is served from memory. Pass the
request context: a cancelled request stops waiting, and the translation still lands in the
store for the next one.

## Languages

The 48 codes are `i18nkeyless.AvailableLangs`; `ResolveLang("pt_BR")` is `pt-BR`,
`ResolveLang("zh-TW")` is `zh-Hant`, `ResolveLang("es-419")` is `es-MX`, `ResolveLang("fr-CH")`
is `fr`. `ToAppStoreLocale("fr")` is `fr-FR`, the App Store Connect listing slot.

## Self-hosted backend or proxy

Point `APIURL` at a server that speaks the four-route wire format (`GET /translate/`,
`GET /translate/{lang}`, `POST /translate`, `POST /translate/last-used-translations`). See
https://docs.i18n-keyless.com/docs/guides/proxy-mode. Every request carries
`Authorization: Bearer <APIKey>`, `Content-Type: application/json`, `Version: 3.6.1` (the
wire dialect: v3 language codes) and `sdk: go` (a server label, counted like `node`: by its
connection, not by a device id). No `unique_id` is ever sent. Go's `http.Client` adds its own
`User-Agent` and `Accept-Encoding`, which the API ignores.

## Limitations

- **One key space per language.** Dictionaries are flat: two namespaces sharing one source
  text share one entry, like the node SDK.
- **Misses are deduplicated by storage key and origin language**, not by source text alone
  (the SDK queue ignores the context): the caller needs the row of *its* context now.
- **`forceTemporary` in the primary language is sent** (the node rule), where the client
  SDKs send nothing.
- **An unknown language code renders the source text** with no request: the API translates
  into the configured list only, and asking would POST on every call.
- **Usage analytics** count the strings this process served. The map is never cleared, so a
  long-lived process sends a growing body every 10 s window in which something was served.

## Publishing

This directory is a Go module inside the `i18n-keyless` monorepo. Go resolves it from the
repository path and a tag prefixed with the directory:

```bash
git tag ports/go/v3.6.1 && git push origin ports/go/v3.6.1
```

The `/v3` suffix of the module path is Go's rule for a major version >= 2. The version
constant (`version.go`) follows the SDKs and is written by `scripts/set-version.mjs`.

## Development

```bash
cd ports/go
go vet ./... && go test -race ./...
```

Tests run on a scripted `http.RoundTripper` and `httptest`: no network, no key.
`conformance_test.go` replays the monorepo's shared protocol vectors
(`conformance/vectors/*.json`): language codes, tag resolution, storage key, namespace and
origin resolution, replace, retry decisions, backoff scenarios, dictionary and translate
requests and responses, the queue scenarios, the lookup cases, usage requests and the
server-label rule. The file comment lists what is not replayed and why.

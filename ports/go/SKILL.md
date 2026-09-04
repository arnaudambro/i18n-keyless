---
name: i18n-keyless-go
description: Install and use i18n-keyless in a Go server. client.T(ctx, "Welcome to our app", lang) (the source string where a key would go) resolves through the i18n-keyless API with one module and one env var. Use when adding, configuring or debugging translations / localization / multi-language support in a Go project (net/http, Gin, Echo, Fiber, templates), or when the project already imports `github.com/arnaudambro/i18n-keyless/ports/go/v3`.
license: MIT
---

# i18n-keyless for Go

Go has no standard i18n: teams keep maps of keys or `golang.org/x/text` catalogs. This
module makes the source text the key: `client.T(ctx, "Welcome to our app", lang)` is
translated by AI once, for every language, cached in memory, and served from there.

**Version covered: `github.com/arnaudambro/i18n-keyless/ports/go/v3` 3.x, Go >= 1.21,
standard library only.**

## Install in one step

```bash
go get github.com/arnaudambro/i18n-keyless/ports/go/v3
```

```go
import i18nkeyless "github.com/arnaudambro/i18n-keyless/ports/go/v3"

client, err := i18nkeyless.Init(ctx, i18nkeyless.Config{
	APIKey:    os.Getenv("I18N_KEYLESS_API_KEY"),   // required: https://i18n-keyless.com/#get-api-key
	Languages: i18nkeyless.Languages{Primary: "en", Supported: []string{"en", "fr", "es"}},
})
```

Keep one `*Client` for the process (a package variable or a dependency): it holds the
dictionaries. It is safe for concurrent use.

## The two ways to render a string

```go
text := client.T(ctx, "Welcome to our app", lang)               // never fails: the source text on error
text, err := client.Translate(ctx, "Welcome to our app", lang)  // the same, with the error
```

In templates, put `T` in the func map: `{{t .Lang "Welcome to our app"}}`.

## Rules

- Source strings are written in the primary language: `T(ctx, "Bonjour", lang)` in a
  French-first app. Never invent a key name.
- `lang` is one of the 48 codes (`i18nkeyless.AvailableLangs`): `fr`, `pt-BR`, `zh-Hans`,
  `cs`. Never `cn` or `cz` (v2 spellings). Map a request's tag with
  `i18nkeyless.ResolveLang(tag, &i18nkeyless.ResolveOptions{Supported: ..., Fallback: ...})`.
- The language of a request lives in the request (a `?lang=` parameter, a cookie,
  `Accept-Language`), never in a package variable: pass it to every `T`.
- Placeholders: `WithReplace(map[string]string{"{{name}}": name})`. Any literal syntax works;
  every occurrence is replaced; an empty replacement leaves the placeholder.
- Ambiguous strings take a context: `WithContext("duration")`. Stored as
  `8 heures__duration`, the same entry the other SDKs use. `WithNamespace("checkout")`
  travels the same way.
- Plurals: send one string per form with a context (`WithContext("one")`,
  `WithContext("other")`) and pick the form in Go.
- `Languages.Supported` is the full list the app serves. It is what a new string is
  translated into, and the API stores it as the project's language list (it replaces the
  previous one).
- A miss blocks the call for one API round trip, once per string per process. Pass the
  request context. Concurrent misses of one string send one request; 30 are in flight at
  most.
- Never panics. A failed API call returns the source text and logs one line starting with
  `i18n-keyless:`.
- Every request carries `Authorization: Bearer`, `Version: 3.6.1` and `sdk: go` (a server
  label: counted by connection, no device id, usage analytics like the node SDK).
- Usage analytics are on by default: one `POST /translate/last-used-translations` at most
  every 10 s, from a timer. `client.FlushUsage(ctx)` before a script exits;
  `DisableUsage: true` to switch off. `client.Close()` stops the timer and waits for the
  background refetches.
- A source string is capped at 2000 characters (`context` and `namespace` at 200).
  Long-form content is one translation per Markdown block of about 1000 characters, with
  the same `context` on every block. https://docs.i18n-keyless.com/docs/guides/long-form-content

## Configuration

`Config` fields: `APIKey`, `APIURL` (self-hosted backend, no trailing slash), `Languages`
(`Primary`, `Supported`), `DefaultNamespace`, `HTTPClient`, `Logger`, `Debug`,
`DisableUsage`, the custom handlers `HandleTranslate`, `GetAllTranslationsForAllLanguages`,
`SendTranslationsUsage`, and `OnInit`. `New(cfg)` validates without the network; `Init(ctx,
cfg)` also loads the dictionaries (a failed load is logged, not returned).

## Debug

- `T` returns the source text in a non-primary language: check `APIKey`, that `lang` is a
  code of the list and in `Languages.Supported`, and the log for `i18n-keyless:` lines.
- The first call for a string is slow: that is the AI translation, once. Every later call
  is served from memory.
- A translation does not update after a dashboard edit: the process holds its dictionary;
  it refreshes after the next miss in that namespace (an `ETag` revalidation) or at the
  next `Init`.
- Every call POSTs the same string: the API answered without a text for that language
  (an unknown language code, or a code not in `Supported`).

## Offline try-out

Run `examples/_mock-server` (`node server.mjs`, port 8787) and set
`APIURL: "http://localhost:8787"`, `APIKey: "demo"`, primary `fr`. See
`examples/go/README.md`.

## Go deeper

- Module README: `ports/go/README.md`
- The whole i18n-keyless documentation as one file: https://docs.i18n-keyless.com/llms.txt
- Dashboard: https://i18n-keyless.com/dashboard

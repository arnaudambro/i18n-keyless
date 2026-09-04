# i18n-keyless · Go (net/http)

A two-page `net/http` app using the **Go port** ([`ports/go`](../../ports/go)): init, `T()`
in a handler and in an `html/template` func map, `WithContext` (one string, two meanings),
`WithReplace` (a placeholder), and a `?lang=` switcher resolved with `ResolveLang`.

Primary language is **`fr`**, like every example: the source strings are French, the API
serves `en` and `es`.

## Run

```bash
# with the real service
I18N_KEYLESS_API_KEY=your-key go run .          # http://localhost:3000  (try /?lang=en, /about?lang=es)

# offline, against the mock backend (no key, no network)
(cd ../_mock-server && node server.mjs)         # in another terminal, http://localhost:8787
go run .                                        # defaults to the mock when no key is set
```

`Langue : fr` and `8 heures / 8 heures` on the French page become `Language: en` and
`8 AM / 8 hours` on `/?lang=en`. A string the mock does not know is rendered as its French
source and POSTed to `/translate` once (the mock echoes the source).

## Test

```bash
go test ./...
```

Runs the handler against an in-process stand-in for the mock backend (`httptest`) and
asserts the rendered HTML is translated for `en` and `es`, is the French source for the
primary language, and that a miss is POSTed once.

## Notes

- Consumes the port through a `replace` directive in `go.mod` (always the local source).
- The handlers pass the request context to `T`: a cancelled request stops waiting, and the
  translation still lands in the store for the next one.

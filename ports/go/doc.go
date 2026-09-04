// Package i18nkeyless is the Go port of i18n-keyless, the keyless translation service:
// the source text is the translation key, a missing translation is produced by AI on the
// first call, and every later call is served from memory.
//
// It implements protocol v3 (docs/PROTOCOL.md in the repository) with the semantics of
// the node SDK: an in-memory dictionary per language loaded at Init, a blocking
// translate-on-miss (T never fails, Translate returns the error), 30 requests in flight at
// most, deduplicated concurrent misses, ETag replay on the bulk fetch, and usage
// analytics flushed on a 10 s debounce. A Go process is a server: it sends `sdk: go` and
// no device id.
//
//	client, err := i18nkeyless.Init(ctx, i18nkeyless.Config{
//		APIKey:    os.Getenv("I18N_KEYLESS_API_KEY"),
//		Languages: i18nkeyless.Languages{Primary: "en", Supported: []string{"en", "fr", "es"}},
//	})
//	text := client.T(ctx, "Welcome to our app", "fr")
//
// Standard library only.
package i18nkeyless

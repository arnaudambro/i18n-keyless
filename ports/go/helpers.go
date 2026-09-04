package i18nkeyless

import (
	"net/url"
	"regexp"
	"strings"
)

// DefaultAPIURL is the official service. Config.APIURL replaces it for a self-hosted
// backend or a proxy that speaks the same wire format.
const DefaultAPIURL = "https://api.i18n-keyless.com"

// DefaultNamespace is the reserved namespace used when a call and the config name none.
// It never appears on the wire: the API treats "no namespace" as this one.
const DefaultNamespace = "default"

// StorageKeyFor is the key a translation is stored under, looked up by, and reported under
// in usage analytics: the source text, suffixed with `__<context>` when a context is given.
// An empty context is no context. Nothing is escaped: a key containing `__` is ambiguous by
// design, like in every other SDK.
func StorageKeyFor(key, context string) string {
	if context == "" {
		return key
	}
	return key + "__" + context
}

// QueueIDFor is the id the reference SDK deduplicates translate requests under in its
// queue: one per (namespace, source text). The context is deliberately not part of it
// (PROTOCOL.md section 6). This port dedupes in-flight POSTs by storage key instead, see
// Client.Translate; the function is exported so the conformance vectors can be replayed.
func QueueIDFor(namespace, key string) string {
	return namespace + ":" + key
}

// ResolveNamespace is the effective namespace of a call: the per-call namespace, else the
// config's DefaultNamespace, else the literal `default`.
func ResolveNamespace(callNamespace, configDefault string) string {
	if callNamespace != "" {
		return callNamespace
	}
	if configDefault != "" {
		return configDefault
	}
	return DefaultNamespace
}

// ResolveOriginLanguage is the effective origin language of a key (the user generated
// content flow): the per-call origin when it is set and differs from the primary language,
// else "" (the regular flow).
func ResolveOriginLanguage(originLanguage, primary string) string {
	if originLanguage == "" || originLanguage == primary {
		return ""
	}
	return originLanguage
}

// ApplyReplace applies the `replace` map to a text the way every SDK does: every key is a
// literal placeholder (regex metacharacters are escaped), all placeholders are joined into
// one alternation and the text is scanned once, left to right, non-overlapping; each match
// is replaced by its value, and an empty value leaves the placeholder in place. Values are
// inserted verbatim and never re-scanned.
//
// Go maps have no order, so when two placeholders can match at the same position (one is a
// prefix of the other) the winner is unspecified here; ApplyReplaceOrdered takes the
// priority explicitly.
func ApplyReplace(text string, replace map[string]string) string {
	if len(replace) == 0 {
		return text
	}
	placeholders := make([]string, 0, len(replace))
	for k := range replace {
		placeholders = append(placeholders, k)
	}
	return ApplyReplaceOrdered(text, placeholders, replace)
}

// ApplyReplaceOrdered is ApplyReplace with the placeholders' priority made explicit: at a
// given position the first placeholder of the slice that matches wins, as the reference
// SDK's map insertion order does. A placeholder absent from the map is ignored.
func ApplyReplaceOrdered(text string, placeholders []string, replace map[string]string) string {
	quoted := make([]string, 0, len(placeholders))
	for _, k := range placeholders {
		if _, ok := replace[k]; ok {
			quoted = append(quoted, regexp.QuoteMeta(k))
		}
	}
	if len(quoted) == 0 {
		return text
	}
	re := regexp.MustCompile(strings.Join(quoted, "|"))
	return re.ReplaceAllStringFunc(text, func(matched string) string {
		if value := replace[matched]; value != "" {
			return value
		}
		return matched
	})
}

// EtagCacheKey is the key the reference client remembers a dictionary ETag under:
// `apiKey|lang|namespace`, with the default namespace spelled out.
func EtagCacheKey(apiKey, lang, namespace string) string {
	if namespace == "" {
		namespace = DefaultNamespace
	}
	return apiKey + "|" + lang + "|" + namespace
}

// BuildDictionaryURL is the URL of a dictionary fetch: `GET /translate/<lang>` for one
// language, `GET /translate/` (trailing slash) for every language at once when lang is "".
// The default namespace is omitted from the query and any other travels URL-encoded.
// Without a known ETag the delta cursor travels as `last_refresh=<cursor>`, where a nil
// cursor is written literally as `null`; with an ETag the cursor leaves the URL (freshness
// travels in `If-None-Match`), so the URL is stable for shared HTTP caches.
func BuildDictionaryURL(apiURL, lang string, lastRefresh *string, namespace, etag string) string {
	if apiURL == "" {
		apiURL = DefaultAPIURL
	}
	namespaceQuery := ""
	if namespace != "" && namespace != DefaultNamespace {
		namespaceQuery = "&namespace=" + url.QueryEscape(namespace)
	}
	// url.QueryEscape writes a space as `+`; the reference uses encodeURIComponent (`%20`).
	namespaceQuery = strings.ReplaceAll(namespaceQuery, "+", "%20")
	var query string
	switch {
	case etag != "" && namespaceQuery != "":
		query = "?" + namespaceQuery[1:]
	case etag != "":
		query = ""
	default:
		cursor := "null"
		if lastRefresh != nil {
			cursor = *lastRefresh
		}
		query = "?last_refresh=" + cursor + namespaceQuery
	}
	return apiURL + "/translate/" + lang + query
}

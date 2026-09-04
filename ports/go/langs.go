package i18nkeyless

import "strings"

// AvailableLangs is the list of the 48 language codes of protocol v3, in the reference
// order. Any of them can be a project's primary language. Chinese is spelled by script
// (`zh-Hans`, `zh-Hant`; there is no bare `zh`) and Czech is `cs`: the v2 spellings `cn`
// and `cz` are not languages here and are never sent.
var AvailableLangs = []string{
	"ar", "bn", "ca", "zh-Hans", "zh-Hant", "hr", "cs", "da", "nl", "en", "en-GB", "fi",
	"fr", "fr-CA", "de", "el", "gu", "he", "hi", "hu", "id", "it", "ja", "kn", "ko", "ms",
	"ml", "mr", "no", "or", "pl", "pt", "pt-BR", "pa", "ro", "ru", "sk", "sl", "es", "es-MX",
	"sv", "ta", "te", "th", "tr", "uk", "ur", "vi",
}

// langsByLowercase maps the lowercased spelling of every code onto the canonical one, so a
// tag can be matched case-insensitively ("PT-br" is "pt-BR").
var langsByLowercase = func() map[string]string {
	m := make(map[string]string, len(AvailableLangs))
	for _, lang := range AvailableLangs {
		m[strings.ToLower(lang)] = lang
	}
	return m
}()

// IsLang reports whether code is one of the 48 codes, spelled exactly.
func IsLang(code string) bool {
	for _, lang := range AvailableLangs {
		if lang == code {
			return true
		}
	}
	return false
}

// appStoreLocales is the App Store Connect listing slot of each code. Apple qualifies some
// languages with a region even when there is a single variant (`de-DE`, `fr-FR`) and leaves
// others bare (`it`, `ja`); that asymmetry is Apple's, and this map absorbs it.
var appStoreLocales = map[string]string{
	"ar": "ar-SA", "bn": "bn", "ca": "ca", "zh-Hans": "zh-Hans", "zh-Hant": "zh-Hant",
	"hr": "hr", "cs": "cs", "da": "da", "nl": "nl-NL", "en": "en-US", "en-GB": "en-GB",
	"fi": "fi", "fr": "fr-FR", "fr-CA": "fr-CA", "de": "de-DE", "el": "el", "gu": "gu",
	"he": "he", "hi": "hi", "hu": "hu", "id": "id", "it": "it", "ja": "ja", "kn": "kn",
	"ko": "ko", "ms": "ms", "ml": "ml", "mr": "mr", "no": "no", "or": "or", "pl": "pl",
	"pt": "pt-PT", "pt-BR": "pt-BR", "pa": "pa", "ro": "ro", "ru": "ru", "sk": "sk",
	"sl": "sl", "es": "es-ES", "es-MX": "es-MX", "sv": "sv", "ta": "ta", "te": "te",
	"th": "th", "tr": "tr", "uk": "uk", "ur": "ur", "vi": "vi",
}

// ToAppStoreLocale returns the App Store Connect locale slot of a code, to push localised
// metadata or release notes to the right listing: `fr` is `fr-FR`, `pt` is `pt-PT`. An
// unknown code returns "".
func ToAppStoreLocale(lang string) string {
	return appStoreLocales[lang]
}

// chineseRegionScripts: Chinese is selected by script, not by region, and a region does not
// name its script, so the common region tags are spelled out.
var chineseRegionScripts = map[string]string{
	"cn": "zh-Hans", "sg": "zh-Hans", "hans": "zh-Hans",
	"tw": "zh-Hant", "hk": "zh-Hant", "mo": "zh-Hant", "hant": "zh-Hant",
}

// ResolveOptions narrows ResolveLang to the languages an application ships.
type ResolveOptions struct {
	// Supported, when non-nil, is the only set of codes ResolveLang may return: the walk
	// continues to the next, less specific candidate when a more specific one is not in it
	// (a `pt-BR` visitor of an app that ships `pt` gets `pt`).
	Supported []string
	// Fallback is returned when no candidate is usable. Empty means "no language".
	Fallback string
}

// ResolveLang maps a BCP-47 style tag (an `Accept-Language` entry, `pt_BR`, `zh-TW`,
// `es-419`) onto a supported code, most specific first: the whole tag, then the Chinese
// script, then the bare language. It returns "" when nothing matches and no fallback is
// given. Chinese never falls back to another script, and the v2 codes `cn` / `cz` are not
// tags.
func ResolveLang(tag string, opts *ResolveOptions) string {
	usable := func(lang string) bool {
		if opts == nil || opts.Supported == nil {
			return true
		}
		for _, s := range opts.Supported {
			if s == lang {
				return true
			}
		}
		return false
	}
	for _, candidate := range langCandidates(tag) {
		if usable(candidate) {
			return candidate
		}
	}
	if opts != nil {
		return opts.Fallback
	}
	return ""
}

// langCandidates lists the codes a tag could mean, most specific first, without duplicates.
func langCandidates(tag string) []string {
	normalized := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(tag, "_", "-")))
	if normalized == "" {
		return nil
	}
	parts := strings.Split(normalized, "-")
	language, region := parts[0], parts[len(parts)-1]
	var candidates []string
	push := func(lang string) {
		if lang == "" {
			return
		}
		for _, c := range candidates {
			if c == lang {
				return
			}
		}
		candidates = append(candidates, lang)
	}

	// 1. the tag as written ("pt-BR", "zh-Hans")
	push(langsByLowercase[normalized])

	// 2. Chinese resolves by script and never falls back to a bare language
	if language == "zh" {
		if script, ok := chineseRegionScripts[region]; ok {
			push(script)
		} else {
			push("zh-Hans")
		}
		return candidates
	}

	// 3. UN M49 code for Latin America, which is what the es-MX slot really covers
	if normalized == "es-419" {
		push("es-MX")
	}

	// 4. the bare language ("pt-AO" -> "pt")
	push(langsByLowercase[language])
	return candidates
}

// IsServerRuntime reports whether an `sdk` header value names a server runtime: counted by
// its connection, no `unique_id`. It is the rule the API applies (PROTOCOL.md 10.1): `node`,
// `laravel`, `rails`, `python`, `go` and every label ending in `-server`.
func IsServerRuntime(runtime string) bool {
	switch runtime {
	case "node", "laravel", "rails", "python", "go":
		return true
	}
	return strings.HasSuffix(runtime, "-server")
}

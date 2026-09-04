package i18nkeyless

// Replays the shared conformance vectors of the monorepo (conformance/vectors/*.json), read
// at test time from the repository, never retyped.
//
// Not replayed, on purpose:
//   - storage-keys.json: a device storage contract; this port persists nothing (a server
//     keeps its dictionaries in memory, PROTOCOL.md section 13);
//   - the device cases of usage-reporting.json and the id-shape cases of unique-id.json: a
//     server never generates nor sends a `unique_id` (the "no id" rule is asserted);
//   - the two queue scenarios that share one POST between two contexts or two origin
//     languages: this port answers the caller synchronously with the API's row, so it dedupes
//     in-flight POSTs by storage key and origin language, like the node SDK;
//   - the `forceTemporary` cases of translation-lookup.json follow the node rule (section
//     15, item 6): the override is sent even in the primary language, and the text rendered
//     is the API's answer.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

const vectorsDir = "../../conformance/vectors"

func loadVector(t *testing.T, name string) map[string]json.RawMessage {
	t.Helper()
	path := filepath.Join(vectorsDir, name+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("no conformance vector at %s", path)
	}
	var v map[string]json.RawMessage
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	return v
}

func decode[T any](t *testing.T, raw json.RawMessage, into *T) {
	t.Helper()
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("decode: %v\n%s", err, raw)
	}
}

func cases(t *testing.T, v map[string]json.RawMessage, key string) []json.RawMessage {
	t.Helper()
	var list []json.RawMessage
	decode(t, v[key], &list)
	return list
}

// orderedKeys lists the keys of a JSON object in document order (Go maps forget it, the
// replace rule depends on it).
func orderedKeys(t *testing.T, raw json.RawMessage) []string {
	t.Helper()
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	if _, err := dec.Token(); err != nil { // {
		t.Fatal(err)
	}
	var keys []string
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			t.Fatal(err)
		}
		keys = append(keys, tok.(string))
		var skip json.RawMessage
		if err := dec.Decode(&skip); err != nil {
			t.Fatal(err)
		}
	}
	return keys
}

type vectorConfig struct {
	APIKey           string `json:"API_KEY"`
	APIURL           string `json:"API_URL"`
	DefaultNamespace string `json:"defaultNamespace"`
	Languages        struct {
		Primary   string   `json:"primary"`
		Supported []string `json:"supported"`
	} `json:"languages"`
	HandleTranslate       bool `json:"handleTranslate"`
	GetAllTranslations    bool `json:"getAllTranslations"`
	SendTranslationsUsage bool `json:"sendTranslationsUsage"`
}

type vectorOptions struct {
	Context              string            `json:"context"`
	Namespace            string            `json:"namespace"`
	UnpersistedNamespace bool              `json:"unpersistedNamespace"`
	ForceTemporary       map[string]string `json:"forceTemporary"`
	Replace              json.RawMessage   `json:"replace"`
	OriginLanguage       string            `json:"originLanguage"`
}

func (o vectorOptions) options(t *testing.T) []Option {
	var opts []Option
	if o.Context != "" {
		opts = append(opts, WithContext(o.Context))
	}
	if o.Namespace != "" {
		opts = append(opts, WithNamespace(o.Namespace))
	}
	if o.UnpersistedNamespace {
		opts = append(opts, WithUnpersistedNamespace())
	}
	if o.ForceTemporary != nil {
		opts = append(opts, WithForceTemporary(o.ForceTemporary))
	}
	if len(o.Replace) > 0 && string(o.Replace) != "null" {
		var replace map[string]string
		decode(t, o.Replace, &replace)
		opts = append(opts, WithReplaceOrdered(orderedKeys(t, o.Replace), replace))
	}
	if o.OriginLanguage != "" {
		opts = append(opts, WithOriginLanguage(o.OriginLanguage))
	}
	return opts
}

func TestVectorResolveLang(t *testing.T) {
	v := loadVector(t, "resolve-lang")
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Input struct {
				Tag       *string  `json:"tag"`
				Supported []string `json:"supported"`
				Fallback  string   `json:"fallback"`
			} `json:"input"`
			Expected *string `json:"expected"`
		}
		decode(t, raw, &c)
		tag := ""
		if c.Input.Tag != nil {
			tag = *c.Input.Tag
		}
		var opts *ResolveOptions
		if c.Input.Supported != nil || c.Input.Fallback != "" {
			opts = &ResolveOptions{Supported: c.Input.Supported, Fallback: c.Input.Fallback}
		}
		want := ""
		if c.Expected != nil {
			want = *c.Expected
		}
		if got := ResolveLang(tag, opts); got != want {
			t.Errorf("%s: ResolveLang(%q) = %q, want %q", c.Name, tag, got, want)
		}
	}
}

func TestVectorLanguages(t *testing.T) {
	v := loadVector(t, "languages")
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name     string          `json:"name"`
			Check    string          `json:"check"`
			Input    json.RawMessage `json:"input"`
			Expected json.RawMessage `json:"expected"`
		}
		decode(t, raw, &c)
		switch c.Check {
		case "availableLangs":
			var want []string
			decode(t, c.Expected, &want)
			if !reflect.DeepEqual(AvailableLangs, want) {
				t.Errorf("%s: AvailableLangs differ", c.Name)
			}
		case "rename":
			var v2, v3 string
			decode(t, c.Input, &v2)
			decode(t, c.Expected, &v3)
			// No v2 dialect in this port: the v2 code is simply not a language.
			if IsLang(v2) || ResolveLang(v2, nil) != "" || !IsLang(v3) {
				t.Errorf("%s: %q must not be a language, %q must", c.Name, v2, v3)
			}
		case "stillAvailable":
			var codes []string
			decode(t, c.Input, &codes)
			for _, code := range codes {
				if !IsLang(code) {
					t.Errorf("%s: %q missing", c.Name, code)
				}
			}
		case "absent":
			var code string
			decode(t, c.Input, &code)
			if IsLang(code) {
				t.Errorf("%s: %q must be absent", c.Name, code)
			}
		case "regionalized":
			var want []string
			decode(t, c.Expected, &want)
			var got []string
			for _, lang := range AvailableLangs {
				if strings.Contains(lang, "-") {
					got = append(got, lang)
				}
			}
			sort.Strings(got)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%s: %v, want %v", c.Name, got, want)
			}
		default:
			t.Fatalf("unknown check %q", c.Check)
		}
	}
}

func TestVectorAppStoreLocales(t *testing.T) {
	v := loadVector(t, "app-store-locales")
	var distinct int
	decode(t, v["distinctSlots"], &distinct)
	slots := map[string]bool{}
	for _, raw := range cases(t, v, "cases") {
		var c struct{ Input, Expected string }
		decode(t, raw, &c)
		if got := ToAppStoreLocale(c.Input); got != c.Expected {
			t.Errorf("ToAppStoreLocale(%q) = %q, want %q", c.Input, got, c.Expected)
		}
		slots[ToAppStoreLocale(c.Input)] = true
	}
	if len(slots) != distinct || len(appStoreLocales) != len(AvailableLangs) {
		t.Errorf("%d distinct slots, want %d", len(slots), distinct)
	}
}

func TestVectorStorageKey(t *testing.T) {
	v := loadVector(t, "storage-key")
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Input struct {
				Key     string `json:"key"`
				Context string `json:"context"`
			} `json:"input"`
			Expected string `json:"expected"`
		}
		decode(t, raw, &c)
		if got := StorageKeyFor(c.Input.Key, c.Input.Context); got != c.Expected {
			t.Errorf("%s: %q, want %q", c.Name, got, c.Expected)
		}
	}
}

func TestVectorReplace(t *testing.T) {
	v := loadVector(t, "replace")
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Input struct {
				Text    string          `json:"text"`
				Replace json.RawMessage `json:"replace"`
			} `json:"input"`
			Expected string `json:"expected"`
		}
		decode(t, raw, &c)
		var replace map[string]string
		if string(c.Input.Replace) != "null" {
			decode(t, c.Input.Replace, &replace)
		}
		if got := ApplyReplaceOrdered(c.Input.Text, orderedKeys(t, c.Input.Replace), replace); got != c.Expected {
			t.Errorf("%s: %q, want %q", c.Name, got, c.Expected)
		}
		// The unordered form agrees whenever no two placeholders can match at one position.
		if !strings.Contains(c.Name, "map order") {
			if got := ApplyReplace(c.Input.Text, replace); got != c.Expected {
				t.Errorf("%s (unordered): %q, want %q", c.Name, got, c.Expected)
			}
		}
	}
}

func TestVectorNamespace(t *testing.T) {
	v := loadVector(t, "namespace")
	var def string
	decode(t, v["defaultNamespace"], &def)
	if def != DefaultNamespace {
		t.Fatalf("DefaultNamespace = %q, want %q", DefaultNamespace, def)
	}
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Fn    string `json:"fn"`
			Input struct {
				Options *struct {
					Namespace      string `json:"namespace"`
					OriginLanguage string `json:"originLanguage"`
				} `json:"options"`
				Config struct {
					DefaultNamespace string `json:"defaultNamespace"`
				} `json:"config"`
				Primary string `json:"primary"`
			} `json:"input"`
			Expected *string `json:"expected"`
		}
		decode(t, raw, &c)
		want := ""
		if c.Expected != nil {
			want = *c.Expected
		}
		callNamespace, origin := "", ""
		if c.Input.Options != nil {
			callNamespace, origin = c.Input.Options.Namespace, c.Input.Options.OriginLanguage
		}
		var got string
		switch c.Fn {
		case "resolveNamespace":
			got = ResolveNamespace(callNamespace, c.Input.Config.DefaultNamespace)
		case "resolveOriginLanguage":
			got = ResolveOriginLanguage(origin, c.Input.Primary)
		default:
			t.Fatalf("unknown fn %q", c.Fn)
		}
		if got != want {
			t.Errorf("%s: %q, want %q", c.Name, got, want)
		}
	}
}

func TestVectorRetryDecision(t *testing.T) {
	v := loadVector(t, "retry-decision")
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Input struct {
				Status     int    `json:"status"`
				StatusText string `json:"statusText"`
			} `json:"input"`
			Expected struct {
				Action string  `json:"action"`
				Error  *string `json:"error"`
			} `json:"expected"`
		}
		decode(t, raw, &c)
		action, errText := DecideStatus(c.Input.Status, c.Input.StatusText)
		if action != c.Expected.Action {
			t.Errorf("%d: action %q, want %q", c.Input.Status, action, c.Expected.Action)
		}
		if c.Expected.Error != nil && errText != *c.Expected.Error {
			t.Errorf("%d: error %q, want %q", c.Input.Status, errText, *c.Expected.Error)
		}
	}
}

func TestVectorBackoff(t *testing.T) {
	v := loadVector(t, "backoff")
	var timeoutMs, maxAttempts int
	var delaysMs []int
	var timeoutErr string
	decode(t, v["timeoutMs"], &timeoutMs)
	decode(t, v["maxAttempts"], &maxAttempts)
	decode(t, v["delaysMs"], &delaysMs)
	decode(t, v["timeoutErrorString"], &timeoutErr)
	if Timeout != time.Duration(timeoutMs)*time.Millisecond || MaxAttempts != maxAttempts || timeoutErrorString != timeoutErr {
		t.Fatal("constants differ from the vector")
	}
	for i, ms := range delaysMs {
		if RetryDelays[i] != time.Duration(ms)*time.Millisecond {
			t.Fatalf("RetryDelays[%d] = %v", i, RetryDelays[i])
		}
	}
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Input struct {
				FailedAttempt int `json:"failedAttempt"`
			} `json:"input"`
			Expected struct {
				WaitMs *int `json:"waitMs"`
			} `json:"expected"`
		}
		decode(t, raw, &c)
		wait, again := DelayAfter(c.Input.FailedAttempt)
		if (c.Expected.WaitMs == nil) == again {
			t.Errorf("%s: again=%v", c.Name, again)
		}
		if c.Expected.WaitMs != nil && wait != time.Duration(*c.Expected.WaitMs)*time.Millisecond {
			t.Errorf("%s: wait %v", c.Name, wait)
		}
	}

	for _, raw := range cases(t, v, "scenarios") {
		var s struct {
			Name      string `json:"name"`
			Responses []struct {
				Status       int             `json:"status"`
				StatusText   string          `json:"statusText"`
				Body         json.RawMessage `json:"body"`
				NetworkError string          `json:"networkError"`
				Timeout      bool            `json:"timeout"`
				InvalidJSON  bool            `json:"invalidJson"`
			} `json:"responses"`
			Expected struct {
				Attempts int             `json:"attempts"`
				SleepsMs []int           `json:"sleepsMs"`
				Result   json.RawMessage `json:"result"`
			} `json:"expected"`
		}
		decode(t, raw, &s)
		var answers []scriptedAnswer
		for _, r := range s.Responses {
			var body any
			if len(r.Body) > 0 {
				decode(t, r.Body, &body)
			}
			answers = append(answers, scriptedAnswer{Status: r.Status, StatusText: r.StatusText, Body: body, NetworkError: r.NetworkError, Timeout: r.Timeout, InvalidJSON: r.InvalidJSON})
		}
		script := newScripted(answers...)
		c, sleeps, _ := newTestClient(t, Config{APIKey: "k"}, script)
		if strings.Contains(s.Name, "304") {
			c.etags[EtagCacheKey("k", "en", DefaultNamespace)] = `W/"x"`
		}
		res := c.fetchDictionary(context.Background(), "en", DefaultNamespace)

		if got := len(script.requests()); got != s.Expected.Attempts {
			t.Errorf("%s: %d attempts, want %d", s.Name, got, s.Expected.Attempts)
		}
		var wantSleeps []time.Duration
		for _, ms := range s.Expected.SleepsMs {
			wantSleeps = append(wantSleeps, time.Duration(ms)*time.Millisecond)
		}
		if !reflect.DeepEqual(*sleeps, wantSleeps) && !(len(*sleeps) == 0 && len(wantSleeps) == 0) {
			t.Errorf("%s: sleeps %v, want %v", s.Name, *sleeps, wantSleeps)
		}
		var want map[string]any
		decode(t, s.Expected.Result, &want)
		if res.OK != want["ok"].(bool) {
			t.Errorf("%s: ok=%v, want %v", s.Name, res.OK, want["ok"])
		}
		if e, has := want["error"]; has && res.Error != e.(string) {
			t.Errorf("%s: error %q, want %q", s.Name, res.Error, e)
		}
		if nm, has := want["notModified"]; has && res.NotModified != nm.(bool) {
			t.Errorf("%s: notModified=%v", s.Name, res.NotModified)
		}
		if res.OK && !res.NotModified {
			var body map[string]any
			decode(t, res.Body, &body)
			for k, v := range want {
				if !reflect.DeepEqual(body[k], v) {
					t.Errorf("%s: body[%s] = %v, want %v", s.Name, k, body[k], v)
				}
			}
		}
	}
}

func TestVectorDictionaryRequest(t *testing.T) {
	v := loadVector(t, "dictionary-request")
	var rule string
	decode(t, v["etagCacheKeyRule"], &rule)
	if rule != "apiKey + '|' + lang + '|' + (namespace || 'default')" {
		t.Fatalf("unexpected etagCacheKeyRule %q", rule)
	}
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Input struct {
				Config         vectorConfig `json:"config"`
				TargetLanguage string       `json:"targetLanguage"`
				LastRefresh    *string      `json:"lastRefresh"`
				Namespace      string       `json:"namespace"`
				KnownEtag      string       `json:"knownEtag"`
				KnownEtagFor   *struct {
					Lang string `json:"lang"`
					Etag string `json:"etag"`
				} `json:"knownEtagFor"`
			} `json:"input"`
			Expected struct {
				URL          string         `json:"url"`
				Method       string         `json:"method"`
				Headers      map[string]any `json:"headers"`
				EtagCacheKey string         `json:"etagCacheKey"`
				Handler      string         `json:"handler"`
			} `json:"expected"`
		}
		decode(t, raw, &c)
		in := c.Input
		if c.Expected.Handler != "" {
			// The custom dictionary handler of this port is GetAllTranslationsForAllLanguages,
			// called with no argument and replacing the request.
			called := 0
			script := newScripted(okAll(nil, ""))
			cl, _, _ := newTestClient(t, Config{APIKey: in.Config.APIKey, GetAllTranslationsForAllLanguages: func(context.Context) (map[string]map[string]string, error) {
				called++
				return map[string]map[string]string{"en": {"Bonjour": "Hello"}}, nil
			}}, script)
			cl.refetch(context.Background(), ResolveNamespace(in.Namespace, ""))
			if called != 1 || len(script.requests()) != 0 || cl.lookup("en", "Bonjour") != "Hello" {
				t.Errorf("%s: handler called %d times, %d requests", c.Name, called, len(script.requests()))
			}
			continue
		}
		if got := EtagCacheKey(in.Config.APIKey, in.TargetLanguage, in.Namespace); got != c.Expected.EtagCacheKey {
			t.Errorf("%s: EtagCacheKey %q, want %q", c.Name, got, c.Expected.EtagCacheKey)
		}
		if got := BuildDictionaryURL(in.Config.APIURL, in.TargetLanguage, in.LastRefresh, in.Namespace, in.KnownEtag); got != c.Expected.URL {
			t.Errorf("%s: BuildDictionaryURL %q, want %q", c.Name, got, c.Expected.URL)
		}
		// The same request, on the wire. This port never stores a cursor: `last_refresh` is
		// always empty, so the URL is compared with the vector's cursor replaced by "".
		script := newScripted(okAll(nil, ""))
		cl, _, _ := newTestClient(t, Config{APIKey: in.Config.APIKey, APIURL: in.Config.APIURL}, script)
		if in.KnownEtag != "" {
			cl.etags[EtagCacheKey(in.Config.APIKey, in.TargetLanguage, in.Namespace)] = in.KnownEtag
		}
		if in.KnownEtagFor != nil {
			cl.etags[EtagCacheKey(in.Config.APIKey, in.KnownEtagFor.Lang, in.Namespace)] = in.KnownEtagFor.Etag
		}
		cl.fetchDictionary(context.Background(), in.TargetLanguage, ResolveNamespace(in.Namespace, ""))
		reqs := script.requests()
		if len(reqs) != 1 {
			t.Fatalf("%s: %d requests", c.Name, len(reqs))
		}
		empty := ""
		wantURL := BuildDictionaryURL(in.Config.APIURL, in.TargetLanguage, &empty, in.Namespace, in.KnownEtag)
		if reqs[0].Method != c.Expected.Method || reqs[0].URL != wantURL {
			t.Errorf("%s: %s %s, want %s %s", c.Name, reqs[0].Method, reqs[0].URL, c.Expected.Method, wantURL)
		}
		expectHeaders(t, c.Name, reqs[0].Headers, c.Expected.Headers)
	}
}

func TestVectorDictionaryResponse(t *testing.T) {
	v := loadVector(t, "dictionary-response")
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Input struct {
				Config         vectorConfig `json:"config"`
				TargetLanguage string       `json:"targetLanguage"`
				KnownEtag      string       `json:"knownEtag"`
			} `json:"input"`
			Response  *json.RawMessage  `json:"response"`
			Responses []json.RawMessage `json:"responses"`
			Expected  struct {
				Attempts       *int            `json:"attempts"`
				Result         json.RawMessage `json:"result"`
				Warning        string          `json:"warning"`
				EtagRemembered *string         `json:"etagRemembered"`
				NextRequest    struct {
					URL         string  `json:"url"`
					IfNoneMatch *string `json:"ifNoneMatch"`
				} `json:"nextRequest"`
			} `json:"expected"`
		}
		decode(t, raw, &c)
		responses := c.Responses
		if c.Response != nil {
			responses = []json.RawMessage{*c.Response}
		}
		var answers []scriptedAnswer
		for _, r := range responses {
			var a struct {
				Status     int               `json:"status"`
				StatusText string            `json:"statusText"`
				Headers    map[string]string `json:"headers"`
				Body       any               `json:"body"`
			}
			decode(t, r, &a)
			answers = append(answers, scriptedAnswer{Status: a.Status, StatusText: a.StatusText, Headers: a.Headers, Body: a.Body})
		}
		script := newScripted(answers...)
		cl, _, logger := newTestClient(t, Config{APIKey: c.Input.Config.APIKey}, script)
		etagKey := EtagCacheKey(c.Input.Config.APIKey, c.Input.TargetLanguage, DefaultNamespace)
		if c.Input.KnownEtag != "" {
			cl.etags[etagKey] = c.Input.KnownEtag
		}
		res := cl.fetchDictionary(context.Background(), c.Input.TargetLanguage, DefaultNamespace)

		if c.Expected.Attempts != nil && len(script.requests()) != *c.Expected.Attempts {
			t.Errorf("%s: %d attempts, want %d", c.Name, len(script.requests()), *c.Expected.Attempts)
		}
		if string(c.Expected.Result) == "null" {
			if res.OK && !res.NotModified {
				t.Errorf("%s: expected nothing, got a body", c.Name)
			}
		} else {
			var want, got map[string]any
			decode(t, c.Expected.Result, &want)
			if !res.OK || res.NotModified {
				t.Fatalf("%s: expected a body, got ok=%v notModified=%v error=%q", c.Name, res.OK, res.NotModified, res.Error)
			}
			decode(t, res.Body, &got)
			if res.Etag != "" {
				got["etag"] = res.Etag
			}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%s: result %v, want %v", c.Name, got, want)
			}
		}
		if c.Expected.Warning != "" && logger.contains("i18n-keyless: "+c.Expected.Warning) != 1 {
			t.Errorf("%s: warning %q not logged once", c.Name, c.Expected.Warning)
		}
		remembered := cl.etags[etagKey]
		want := ""
		if c.Expected.EtagRemembered != nil {
			want = *c.Expected.EtagRemembered
		}
		if remembered != want {
			t.Errorf("%s: remembered %q, want %q", c.Name, remembered, want)
		}
		cursor := "1700000000"
		if got := BuildDictionaryURL("", c.Input.TargetLanguage, &cursor, DefaultNamespace, remembered); got != c.Expected.NextRequest.URL {
			t.Errorf("%s: next URL %q, want %q", c.Name, got, c.Expected.NextRequest.URL)
		}
	}
}

func TestVectorTranslateRequest(t *testing.T) {
	v := loadVector(t, "translate-request")
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Input struct {
				Config          vectorConfig      `json:"config"`
				CurrentLanguage string            `json:"currentLanguage"`
				Translations    map[string]string `json:"translations"`
				Key             string            `json:"key"`
				Options         vectorOptions     `json:"options"`
			} `json:"input"`
			Expected struct {
				URL         string         `json:"url"`
				Method      string         `json:"method"`
				Headers     map[string]any `json:"headers"`
				Body        map[string]any `json:"body"`
				Handler     string         `json:"handler"`
				HandlerArgs []string       `json:"handlerArgs"`
				HTTP        *bool          `json:"http"`
			} `json:"expected"`
		}
		decode(t, raw, &c)
		in := c.Input
		cfg := Config{APIKey: in.Config.APIKey, APIURL: in.Config.APIURL, DefaultNamespace: in.Config.DefaultNamespace}
		cfg.Languages = Languages{Primary: in.Config.Languages.Primary, Supported: in.Config.Languages.Supported}
		var handlerArgs []string
		if in.Config.HandleTranslate {
			cfg.HandleTranslate = func(_ context.Context, key string) (map[string]string, error) {
				handlerArgs = append(handlerArgs, key)
				return map[string]string{"en": "Hello"}, nil
			}
		}
		script := newScripted(okTranslate(nil), okAll(nil, ""))
		cl, _, _ := newTestClient(t, cfg, script)
		cl.seed(in.CurrentLanguage, in.Translations)
		cl.T(context.Background(), in.Key, in.CurrentLanguage, in.Options.options(t)...)
		cl.bg.Wait()

		if c.Expected.Handler != "" {
			if !reflect.DeepEqual(handlerArgs, c.Expected.HandlerArgs) || script.count("POST", "/translate") != 0 {
				t.Errorf("%s: handler args %v, %d POSTs", c.Name, handlerArgs, script.count("POST", "/translate"))
			}
			continue
		}
		var post *recordedRequest
		for i, r := range script.requests() {
			if r.Method == "POST" {
				post = &script.requests()[i]
			}
		}
		if post == nil {
			t.Fatalf("%s: no POST", c.Name)
		}
		if post.URL != c.Expected.URL || post.Method != c.Expected.Method {
			t.Errorf("%s: %s %s, want %s %s", c.Name, post.Method, post.URL, c.Expected.Method, c.Expected.URL)
		}
		expectHeaders(t, c.Name, post.Headers, c.Expected.Headers)
		if !reflect.DeepEqual(post.Body, c.Expected.Body) {
			t.Errorf("%s: body %v, want %v", c.Name, post.Body, c.Expected.Body)
		}
	}
}

func TestVectorUsageRequest(t *testing.T) {
	v := loadVector(t, "usage-request")
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Input struct {
				Config vectorConfig                 `json:"config"`
				Usage  map[string]map[string]string `json:"usage"`
			} `json:"input"`
			Expected struct {
				URL         string              `json:"url"`
				Method      string              `json:"method"`
				Headers     map[string]any      `json:"headers"`
				Body        map[string]any      `json:"body"`
				Handler     string              `json:"handler"`
				HandlerArgs []map[string]string `json:"handlerArgs"`
				HTTP        *bool               `json:"http"`
			} `json:"expected"`
		}
		decode(t, raw, &c)
		in := c.Input
		cfg := Config{APIKey: in.Config.APIKey, APIURL: in.Config.APIURL}
		if in.Config.APIKey == "" {
			cfg.APIURL = DefaultAPIURL // New() needs one of the two; the usage rule is tested below
		}
		cfg.Languages = Languages{Primary: in.Config.Languages.Primary, Supported: in.Config.Languages.Supported}
		var handlerArgs []map[string]string
		if in.Config.SendTranslationsUsage {
			cfg.SendTranslationsUsage = func(_ context.Context, bucket map[string]string) error {
				handlerArgs = append(handlerArgs, bucket)
				return nil
			}
		}
		script := newScripted(scriptedAnswer{Status: 200, StatusText: "OK", Body: map[string]any{"ok": true, "error": "", "message": ""}})
		cl, _, _ := newTestClient(t, cfg, script)
		cl.usage = in.Usage
		if err := cl.FlushUsage(context.Background()); err != nil {
			t.Errorf("%s: %v", c.Name, err)
		}
		if c.Expected.Handler != "" {
			if !reflect.DeepEqual(handlerArgs, c.Expected.HandlerArgs) || len(script.requests()) != 0 {
				t.Errorf("%s: handler args %v", c.Name, handlerArgs)
			}
			continue
		}
		if c.Expected.HTTP != nil && !*c.Expected.HTTP {
			if len(script.requests()) != 0 {
				t.Errorf("%s: expected no request", c.Name)
			}
			continue
		}
		reqs := script.requests()
		if len(reqs) != 1 || reqs[0].URL != c.Expected.URL || reqs[0].Method != c.Expected.Method {
			t.Fatalf("%s: requests %v", c.Name, reqs)
		}
		expectHeaders(t, c.Name, reqs[0].Headers, c.Expected.Headers)
		if !reflect.DeepEqual(reqs[0].Body, c.Expected.Body) {
			t.Errorf("%s: body %v, want %v", c.Name, reqs[0].Body, c.Expected.Body)
		}
	}
}

func TestVectorUsageReporting(t *testing.T) {
	v := loadVector(t, "usage-reporting")
	var labels struct {
		Cases []struct {
			Label    string `json:"label"`
			Expected bool   `json:"expected"`
		} `json:"cases"`
	}
	decode(t, v["serverLabels"], &labels)
	found := false
	for _, c := range labels.Cases {
		if got := IsServerRuntime(c.Label); got != c.Expected {
			t.Errorf("IsServerRuntime(%q) = %v, want %v", c.Label, got, c.Expected)
		}
		if c.Label == SDK {
			found = true
			if !c.Expected {
				t.Errorf("usage-reporting.json must list %q as a server label", SDK)
			}
		}
	}
	if !found {
		t.Errorf("usage-reporting.json must list %q as a server label", SDK)
	}
	var flush map[string]string
	decode(t, v["usageFlush"], &flush)
	if _, ok := flush[SDK]; !ok {
		t.Errorf("usageFlush has no %q entry", SDK)
	}
	// `go` is registered on the API with the `node` rules: usage recorded and sent, no id.
	var node struct {
		Expected struct {
			Runtime       string `json:"runtime"`
			RecordsUsage  bool   `json:"recordsUsage"`
			SendsUsage    bool   `json:"sendsUsage"`
			SendsUniqueID bool   `json:"sendsUniqueId"`
		} `json:"expected"`
	}
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Input struct {
				Package string `json:"package"`
			} `json:"input"`
		}
		decode(t, raw, &c)
		if c.Input.Package == "node" {
			decode(t, raw, &node)
		}
	}
	if node.Expected.Runtime != "node" || !node.Expected.RecordsUsage || !node.Expected.SendsUsage || node.Expected.SendsUniqueID {
		t.Fatalf("node rules changed: %+v", node.Expected)
	}
	if usageFlushDebounce != 10*time.Second {
		t.Errorf("usage debounce %v", usageFlushDebounce)
	}

	// End to end: a served key is recorded, and the map leaves on the debounce with the
	// `go` label and no device id.
	script := newScripted(scriptedAnswer{Status: 200, StatusText: "OK", Body: map[string]any{"ok": true}})
	cl, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
	cl.seed("en", map[string]string{"Bonjour": "Hello"})
	cl.usageDebounce = 10 * time.Millisecond
	if got := cl.T(context.Background(), "Bonjour", "en"); got != "Hello" {
		t.Fatalf("got %q", got)
	}
	cl.T(context.Background(), "Bonjour", "fr") // the primary language is recorded too
	deadline := time.Now().Add(2 * time.Second)
	for script.count("POST", "/translate/last-used-translations") == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	reqs := script.requests()
	if len(reqs) != 1 {
		t.Fatalf("%d requests, want 1", len(reqs))
	}
	if _, has := applicationHeaders(reqs[0].Headers)["Unique_id"]; has || reqs[0].Headers["Sdk"] != SDK {
		t.Errorf("headers %v", reqs[0].Headers)
	}
	want := map[string]any{"default": map[string]any{"Bonjour": "2026-08-04"}}
	if !reflect.DeepEqual(reqs[0].Body["translationsUsageByNamespace"], want) {
		t.Errorf("usage body %v", reqs[0].Body)
	}
}

func TestVectorUniqueIDServerSendsNone(t *testing.T) {
	v := loadVector(t, "unique-id")
	var description string
	decode(t, v["description"], &description)
	if !strings.Contains(description, "A server runtime sends no id") {
		t.Fatalf("unexpected description: %s", description)
	}
	script := newScripted(okAll(nil, ""), okTranslate(nil))
	cl, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
	cl.refetch(context.Background(), DefaultNamespace)
	cl.T(context.Background(), "Bonjour", "en")
	cl.bg.Wait()
	for _, r := range script.requests() {
		headers := applicationHeaders(r.Headers)
		if _, has := headers["Unique_id"]; has || headers["Sdk"] != SDK {
			t.Errorf("%s %s: headers %v", r.Method, r.URL, headers)
		}
	}
}

func TestVectorQueue(t *testing.T) {
	v := loadVector(t, "queue")
	var concurrency int
	decode(t, v["concurrency"], &concurrency)
	if concurrency != maxConcurrentTranslations {
		t.Fatalf("concurrency %d", maxConcurrentTranslations)
	}
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Input struct {
				Namespace string `json:"namespace"`
				Key       string `json:"key"`
			} `json:"input"`
			Expected string `json:"expected"`
		}
		decode(t, raw, &c)
		if got := QueueIDFor(c.Input.Namespace, c.Input.Key); got != c.Expected {
			t.Errorf("%s: %q, want %q", c.Name, got, c.Expected)
		}
	}
	for _, raw := range cases(t, v, "scenarios") {
		var s struct {
			Name         string            `json:"name"`
			Translations map[string]string `json:"translations"`
			Calls        json.RawMessage   `json:"calls"`
			Expected     struct {
				Requests     int `json:"requests"`
				PeakInFlight int `json:"peakInFlight"`
			} `json:"expected"`
		}
		decode(t, raw, &s)
		if strings.HasPrefix(string(s.Calls), `"`) {
			// "31 distinct keys": at most 30 in flight, 31 requests in total. Every answer is
			// held until the peak is observed, so the 31st request must wait for a slot.
			release := make(chan struct{})
			answer := okTranslate(nil)
			answer.Block = release
			script := newScripted(answer)
			cl, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
			var wg sync.WaitGroup
			for i := 0; i < 31; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					cl.T(context.Background(), fmt.Sprintf("Clé %d", i), "en")
				}(i)
			}
			deadline := time.Now().Add(2 * time.Second)
			for time.Now().Before(deadline) {
				script.mu.Lock()
				active := script.active
				script.mu.Unlock()
				if active == s.Expected.PeakInFlight {
					break
				}
				time.Sleep(time.Millisecond)
			}
			time.Sleep(20 * time.Millisecond) // give a 31st request the chance to leak
			close(release)
			wg.Wait()
			cl.bg.Wait()
			if script.Peak != s.Expected.PeakInFlight || script.count("POST", "/translate") != s.Expected.Requests {
				t.Errorf("%s: peak %d, %d requests", s.Name, script.Peak, script.count("POST", "/translate"))
			}
			continue
		}
		var calls []struct {
			Key     string        `json:"key"`
			Options vectorOptions `json:"options"`
		}
		decode(t, s.Calls, &calls)
		skip := false
		for _, call := range calls {
			if call.Options.Context != "" || call.Options.OriginLanguage != "" {
				skip = true // deduplicated by storage key and origin here, see the file comment
			}
		}
		if skip {
			continue
		}
		release := make(chan struct{})
		answer := okTranslate(nil)
		answer.Block = release
		script := newScripted(answer)
		cl, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
		cl.seed("en", s.Translations)
		var wg sync.WaitGroup
		for _, call := range calls {
			wg.Add(1)
			go func(key string, opts []Option) {
				defer wg.Done()
				cl.T(context.Background(), key, "en", opts...)
			}(call.Key, call.Options.options(t))
		}
		time.Sleep(20 * time.Millisecond) // let every call reach the transport or dedupe
		close(release)
		wg.Wait()
		cl.bg.Wait()
		if got := script.count("POST", "/translate"); got != s.Expected.Requests {
			t.Errorf("%s: %d requests, want %d", s.Name, got, s.Expected.Requests)
		}
	}
}

func TestVectorTranslationLookup(t *testing.T) {
	v := loadVector(t, "translation-lookup")
	for _, raw := range cases(t, v, "cases") {
		var c struct {
			Name  string `json:"name"`
			Input struct {
				Store struct {
					CurrentLanguage  string            `json:"currentLanguage"`
					Primary          string            `json:"primary"`
					Translations     map[string]string `json:"translations"`
					DefaultNamespace string            `json:"defaultNamespace"`
				} `json:"store"`
				Key     string        `json:"key"`
				Options vectorOptions `json:"options"`
			} `json:"input"`
			Expected struct {
				Text   string `json:"text"`
				Queued []struct {
					Namespace   string `json:"namespace"`
					Unpersisted bool   `json:"unpersisted"`
				} `json:"queued"`
			} `json:"expected"`
		}
		decode(t, raw, &c)
		in := c.Input
		// The API answers the miss with no translation, so the text rendered is what the
		// store held or the key, exactly what the synchronous client path renders.
		script := newScripted(okTranslate(nil), okAll(nil, ""))
		cfg := Config{APIKey: "k", DefaultNamespace: in.Store.DefaultNamespace}
		cfg.Languages = Languages{Primary: in.Store.Primary, Supported: []string{"fr", "en", "es"}}
		cl, _, _ := newTestClient(t, cfg, script)
		cl.seed(in.Store.CurrentLanguage, in.Store.Translations)

		got := cl.T(context.Background(), in.Key, in.Store.CurrentLanguage, in.Options.options(t)...)
		cl.bg.Wait()

		var queued []string
		unpersisted := map[string]bool{}
		for _, r := range script.requests() {
			if r.Method != "POST" {
				continue
			}
			ns := DefaultNamespace
			if n, ok := r.Body["namespace"].(string); ok {
				ns = n
			}
			queued = append(queued, ns)
			cl.mu.Lock()
			_, recorded := cl.usage[ns]
			cl.mu.Unlock()
			unpersisted[ns] = !recorded
		}
		var wantQueued []string
		wantUnpersisted := map[string]bool{}
		for _, q := range c.Expected.Queued {
			wantQueued = append(wantQueued, q.Namespace)
			wantUnpersisted[q.Namespace] = q.Unpersisted
		}
		if in.Options.ForceTemporary[in.Store.CurrentLanguage] != "" {
			// Node rule (PROTOCOL.md 15.6, section 13): a forceTemporary call is always sent,
			// the primary language included, and the text is the API's answer or the key.
			if len(queued) != 1 {
				t.Errorf("%s: forceTemporary sent %d POSTs, want 1", c.Name, len(queued))
			}
			continue
		}
		if got != c.Expected.Text {
			t.Errorf("%s: text %q, want %q", c.Name, got, c.Expected.Text)
		}
		if !reflect.DeepEqual(queued, wantQueued) {
			t.Errorf("%s: queued %v, want %v", c.Name, queued, wantQueued)
		}
		for ns, want := range wantUnpersisted {
			if unpersisted[ns] != want {
				t.Errorf("%s: namespace %s unpersisted=%v, want %v", c.Name, ns, unpersisted[ns], want)
			}
		}
	}
}

// The storage-keys vector is a device contract: this port persists nothing.
func TestVectorStorageKeysNotApplicable(t *testing.T) {
	v := loadVector(t, "storage-keys")
	var description string
	decode(t, v["description"], &description)
	if !strings.Contains(description, "device") {
		t.Fatalf("unexpected description: %s", description)
	}
	if _, err := os.Stat(filepath.Join(vectorsDir, "storage-keys.json")); errors.Is(err, os.ErrNotExist) {
		t.Skip()
	}
}

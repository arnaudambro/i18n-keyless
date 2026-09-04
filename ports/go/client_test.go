package i18nkeyless

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewValidatesTheConfig(t *testing.T) {
	if _, err := New(Config{APIKey: "k"}); err == nil || !strings.Contains(err.Error(), "primary is required") {
		t.Errorf("missing primary: %v", err)
	}
	if _, err := New(Config{APIKey: "k", Languages: Languages{Primary: "xx"}}); err == nil {
		t.Error("unknown primary accepted")
	}
	if _, err := New(Config{APIKey: "k", Languages: Languages{Primary: "fr", Supported: []string{"fr", "cn"}}}); err == nil {
		t.Error("v2 code accepted")
	}
	if _, err := New(Config{Languages: Languages{Primary: "fr"}}); err == nil {
		t.Error("no key, no URL, no handlers accepted")
	}
	if _, err := New(Config{APIURL: "http://localhost:8787", Languages: Languages{Primary: "fr"}}); err != nil {
		t.Errorf("APIURL alone refused: %v", err)
	}
	handlers := Config{Languages: Languages{Primary: "fr"},
		HandleTranslate:                   func(context.Context, string) (map[string]string, error) { return nil, nil },
		GetAllTranslationsForAllLanguages: func(context.Context) (map[string]map[string]string, error) { return nil, nil }}
	if _, err := New(handlers); err != nil {
		t.Errorf("handlers alone refused: %v", err)
	}
}

func TestInitLoadsEveryLanguageAndSurvivesAFailure(t *testing.T) {
	script := newScripted(okAll(map[string]map[string]string{
		"fr": {"Bonjour": "Bonjour"}, "en": {"Bonjour": "Hello"}, "xx": {"Bonjour": "??"},
	}, `W/"1"`))
	var inited string
	cfg := Config{APIKey: "k", HTTPClient: &http.Client{Transport: script}, Logger: &testLogger{},
		Languages: Languages{Primary: "fr", Supported: []string{"fr", "en"}}, OnInit: func(p string) { inited = p }}
	c, err := Init(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if inited != "fr" || c.lookup("en", "Bonjour") != "Hello" || len(c.translations["xx"]) != 0 {
		t.Errorf("store after init: %v", c.translations["en"])
	}
	if reqs := script.requests(); len(reqs) != 1 || reqs[0].URL != "https://api.i18n-keyless.com/translate/?last_refresh=" {
		t.Errorf("boot fetch %v", reqs)
	}
	if c.etags[EtagCacheKey("k", "", DefaultNamespace)] != `W/"1"` {
		t.Error("ETag not remembered")
	}

	down := newScripted(scriptedAnswer{NetworkError: "connection refused"})
	logger := &testLogger{}
	cfg.HTTPClient = &http.Client{Transport: down}
	cfg.Logger = logger
	c2, err := Init(context.Background(), cfg)
	if err != nil {
		t.Fatalf("Init must not fail on a network error: %v", err)
	}
	defer c2.Close()
	if logger.contains("connection refused") == 0 {
		t.Error("failure not logged")
	}
	if got := c2.T(context.Background(), "Bonjour", "fr"); got != "Bonjour" {
		t.Errorf("primary after a failed boot: %q", got)
	}
}

func TestInitFetchesTheConfiguredNamespace(t *testing.T) {
	script := newScripted(okAll(nil, ""))
	c, err := Init(context.Background(), Config{APIKey: "k", DefaultNamespace: "app", HTTPClient: &http.Client{Transport: script},
		Languages: Languages{Primary: "fr", Supported: []string{"fr", "en"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if reqs := script.requests(); reqs[0].URL != "https://api.i18n-keyless.com/translate/?last_refresh=&namespace=app" {
		t.Errorf("boot fetch %s", reqs[0].URL)
	}
}

func TestHitMissAndCache(t *testing.T) {
	script := newScripted(okTranslate(map[string]any{"fr": "Bonjour", "en": "Hello", "es": "Hola", "de": nil, "id": nil}), okAll(nil, ""))
	c, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
	ctx := context.Background()

	if got := c.T(ctx, "Bonjour", "fr"); got != "Bonjour" || len(script.requests()) != 0 {
		t.Errorf("primary: %q, %d requests", got, len(script.requests()))
	}
	if got := c.T(ctx, "Bonjour", "en"); got != "Hello" {
		t.Errorf("miss: %q", got)
	}
	c.bg.Wait()
	if got := c.T(ctx, "Bonjour", "es"); got != "Hola" {
		t.Errorf("cached from the same answer: %q", got)
	}
	if n := script.count("POST", "/translate"); n != 1 {
		t.Errorf("%d POSTs, want 1", n)
	}
	// The burst refetched the namespace once it settled.
	if n := script.count("GET", "/translate/?last_refresh="); n != 1 {
		t.Errorf("%d refetches, want 1", n)
	}
	if got := c.T(ctx, "", "en"); got != "" {
		t.Errorf("empty key: %q", got)
	}
}

func TestContextReplaceAndNamespace(t *testing.T) {
	script := newScripted(okTranslate(map[string]any{"en": "8 AM"}), okAll(nil, ""))
	c, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
	c.seed("en", map[string]string{"8 heures": "8 hours", "Bonjour {{name}}": "Hello {{name}}"})
	ctx := context.Background()
	if got := c.T(ctx, "8 heures", "en"); got != "8 hours" {
		t.Errorf("plain: %q", got)
	}
	if got := c.T(ctx, "8 heures", "en", WithContext("time"), WithNamespace("checkout")); got != "8 AM" {
		t.Errorf("context miss answered: %q", got)
	}
	c.bg.Wait()
	post := script.requests()[0]
	if post.Body["context"] != "time" || post.Body["namespace"] != "checkout" {
		t.Errorf("body %v", post.Body)
	}
	if c.lookup("en", "8 heures__time") != "8 AM" {
		t.Error("context entry not cached")
	}
	if got := c.T(ctx, "Bonjour {{name}}", "en", WithReplace(map[string]string{"{{name}}": "Ada"})); got != "Hello Ada" {
		t.Errorf("replace on a hit: %q", got)
	}
	if got := c.T(ctx, "Bonjour {{name}}", "fr", WithReplace(map[string]string{"{{name}}": "Ada"})); got != "Bonjour Ada" {
		t.Errorf("replace in the primary language: %q", got)
	}
}

func TestFallbackAndError(t *testing.T) {
	script := newScripted(scriptedAnswer{Status: 401, StatusText: "Unauthorized"})
	c, sleeps, logger := newTestClient(t, Config{APIKey: "bad"}, script)
	ctx := context.Background()
	text, err := c.Translate(ctx, "Bonjour {{name}}", "en", WithReplace(map[string]string{"{{name}}": "Ada"}))
	if text != "Bonjour Ada" || err == nil || !strings.Contains(err.Error(), `translate failed for key "Bonjour {{name}}"`) || !strings.Contains(err.Error(), "Unauthorized") {
		t.Errorf("Translate: %q, %v", text, err)
	}
	c.bg.Wait()
	if len(*sleeps) != 0 || script.count("POST", "/translate") != 1 {
		t.Errorf("a 401 must not be retried: %v, %d POSTs", *sleeps, script.count("POST", "/translate"))
	}
	if got := c.T(ctx, "Bonjour", "en"); got != "Bonjour" || logger.contains("Unauthorized") == 0 {
		t.Errorf("T: %q, logged %d", got, logger.contains("Unauthorized"))
	}
	c.bg.Wait()

	// A network error is retried three times with the backoff, then the key is returned.
	flaky := newScripted(scriptedAnswer{NetworkError: "offline"})
	c2, sleeps2, _ := newTestClient(t, Config{APIKey: "k"}, flaky)
	if got := c2.T(ctx, "Bonjour", "en"); got != "Bonjour" {
		t.Errorf("offline: %q", got)
	}
	c2.bg.Wait() // the refetch that follows the burst fails and backs off too
	if flaky.count("POST", "/translate") != 3 || len(*sleeps2) < 2 || (*sleeps2)[0] != 500*time.Millisecond || (*sleeps2)[1] != 1500*time.Millisecond {
		t.Errorf("retries: %d POSTs, sleeps %v", flaky.count("POST", "/translate"), *sleeps2)
	}

	// An `ok: false` 200 is a failure too.
	notOK := newScripted(scriptedAnswer{Status: 200, StatusText: "OK", Body: map[string]any{"ok": false, "error": "Invalid primary language", "data": map[string]any{"translation": nil}}})
	c3, _, _ := newTestClient(t, Config{APIKey: "k"}, notOK)
	if _, err := c3.Translate(ctx, "Bonjour", "en"); err == nil || !strings.Contains(err.Error(), "Invalid primary language") {
		t.Errorf("ok:false: %v", err)
	}
}

func TestRetryThenSuccessOverARealServer(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": map[string]any{"translation": map[string]any{"languages": map[string]any{"en": "Hello"}}}})
	}))
	defer server.Close()
	c, err := New(Config{APIKey: "k", APIURL: server.URL, Languages: Languages{Primary: "fr", Supported: []string{"fr", "en"}}, Logger: &testLogger{}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	var sleeps []time.Duration
	c.tr.sleep = func(_ context.Context, d time.Duration) { sleeps = append(sleeps, d) }
	if got := c.T(context.Background(), "Bonjour", "en"); got != "Hello" {
		t.Errorf("got %q", got)
	}
	c.bg.Wait()
	if atomic.LoadInt32(&calls) < 2 || len(sleeps) < 1 || sleeps[0] != 500*time.Millisecond {
		t.Errorf("calls %d, sleeps %v", calls, sleeps)
	}
}

func TestConcurrentMissesAreDeduplicated(t *testing.T) {
	release := make(chan struct{})
	answer := okTranslate(map[string]any{"en": "Hello"})
	answer.Block = release
	script := newScripted(answer)
	c, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
	var wg sync.WaitGroup
	results := make([]string, 20)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = c.T(context.Background(), "Bonjour", "en")
		}(i)
	}
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()
	c.bg.Wait()
	for _, r := range results {
		if r != "Hello" {
			t.Errorf("a follower got %q", r)
		}
	}
	if n := script.count("POST", "/translate"); n != 1 {
		t.Errorf("%d POSTs, want 1", n)
	}
	// forceTemporary calls are never shared.
	script2 := newScripted(okTranslate(map[string]any{"en": "Hi"}), okAll(nil, ""))
	c2, _, _ := newTestClient(t, Config{APIKey: "k"}, script2)
	c2.seed("en", map[string]string{"Bonjour": "Hello"})
	if got := c2.T(context.Background(), "Bonjour", "en", WithForceTemporary(map[string]string{"en": "Hi"})); got != "Hi" {
		t.Errorf("forceTemporary: %q", got)
	}
	c2.bg.Wait()
	if post := script2.requests()[0]; post.Body["forceTemporary"].(map[string]any)["en"] != "Hi" {
		t.Errorf("body %v", post.Body)
	}
}

func TestUserGeneratedContent(t *testing.T) {
	script := newScripted(okTranslate(map[string]any{"fr": "Bonjour le monde", "en": "Hello world", "es": "Hola mundo"}), okAll(nil, ""))
	c, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
	ctx := context.Background()
	if got := c.T(ctx, "Hola mundo", "es", WithOriginLanguage("es")); got != "Hola mundo" || len(script.requests()) != 0 {
		t.Errorf("origin language: %q, %d requests", got, len(script.requests()))
	}
	if got := c.T(ctx, "Hola mundo", "fr", WithOriginLanguage("es")); got != "Bonjour le monde" {
		t.Errorf("UGC in the primary language: %q", got)
	}
	c.bg.Wait()
	if post := script.requests()[0]; post.Body["originLanguage"] != "es" {
		t.Errorf("body %v", post.Body)
	}
}

func TestETag304KeepsTheStore(t *testing.T) {
	script := newScripted(
		okAll(map[string]map[string]string{"en": {"Bonjour": "Hello"}}, `W/"1"`),
		scriptedAnswer{Status: 304, StatusText: "Not Modified"},
	)
	c, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
	c.refetch(context.Background(), DefaultNamespace)
	c.refetch(context.Background(), DefaultNamespace)
	reqs := script.requests()
	if len(reqs) != 2 || reqs[1].Headers["If-None-Match"] != `W/"1"` || reqs[1].URL != "https://api.i18n-keyless.com/translate/" {
		t.Errorf("second fetch %+v", reqs[1])
	}
	if c.lookup("en", "Bonjour") != "Hello" || c.etags[EtagCacheKey("k", "", DefaultNamespace)] != `W/"1"` {
		t.Error("a 304 must keep the store and the ETag")
	}
}

func TestUsageIsRecordedAndFlushedOnce(t *testing.T) {
	script := newScripted(scriptedAnswer{Status: 200, StatusText: "OK", Body: map[string]any{"ok": true}})
	c, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
	c.seed("en", map[string]string{"Bonjour": "Hello", "8 heures__time": "8 AM"})
	c.usageDebounce = 20 * time.Millisecond
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		c.T(ctx, "Bonjour", "en")
		c.T(ctx, "8 heures", "en", WithContext("time"), WithNamespace("checkout"))
		c.T(ctx, "Secret", "en", WithNamespace("chat-1"), WithUnpersistedNamespace())
	}
	deadline := time.Now().Add(2 * time.Second)
	for script.count("POST", "/translate/last-used-translations") == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond)
	usagePosts := 0
	var body map[string]any
	for _, r := range script.requests() {
		if strings.HasSuffix(r.URL, "/last-used-translations") {
			usagePosts++
			body = r.Body
		}
	}
	if usagePosts != 1 {
		t.Fatalf("%d usage POSTs, want 1", usagePosts)
	}
	want := map[string]any{"default": map[string]any{"Bonjour": "2026-08-04"}, "checkout": map[string]any{"8 heures__time": "2026-08-04"}}
	if body["primaryLanguage"] != "fr" || !jsonEqual(body["translationsUsageByNamespace"], want) {
		t.Errorf("usage body %v", body)
	}
	// Cumulative: the map is never cleared, and a same-day call schedules nothing new.
	c.T(ctx, "Bonjour", "en")
	c.mu.Lock()
	timer := c.usageTimer
	c.mu.Unlock()
	if timer != nil {
		t.Error("a same-day use must not reschedule a flush")
	}
	if err := c.FlushUsage(ctx); err != nil {
		t.Fatal(err)
	}
	if got := script.count("POST", "/translate/last-used-translations"); got != 2 {
		t.Errorf("FlushUsage sent %d", got)
	}

	off, _, _ := newTestClient(t, Config{APIKey: "k", DisableUsage: true}, newScripted(okAll(nil, "")))
	off.seed("en", map[string]string{"Bonjour": "Hello"})
	off.T(ctx, "Bonjour", "en")
	if len(off.usage) != 0 {
		t.Error("DisableUsage must record nothing")
	}
}

func TestCustomHandlers(t *testing.T) {
	var translated, fetched, usage int
	c, _, _ := newTestClient(t, Config{
		HandleTranslate: func(_ context.Context, key string) (map[string]string, error) {
			translated++
			if key == "Cassé" {
				return nil, errors.New("handler down")
			}
			return map[string]string{"en": "Hello", "id": "Halo", "xx": "nope", "de": ""}, nil
		},
		GetAllTranslationsForAllLanguages: func(context.Context) (map[string]map[string]string, error) {
			fetched++
			return map[string]map[string]string{"es": {"Bonjour": "Hola"}}, nil
		},
		SendTranslationsUsage: func(_ context.Context, bucket map[string]string) error { usage++; return nil },
	}, newScripted(okAll(nil, "")))
	ctx := context.Background()
	c.refetch(ctx, DefaultNamespace)
	if got := c.T(ctx, "Bonjour", "es"); got != "Hola" || fetched != 1 {
		t.Errorf("custom fetch: %q", got)
	}
	if got := c.T(ctx, "Bonjour", "en"); got != "Hello" || translated != 1 {
		t.Errorf("custom translate: %q", got)
	}
	if got := c.T(ctx, "Bonjour", "id"); got != "Halo" || translated != 1 || c.lookup("xx", "Bonjour") != "" || c.lookup("de", "Bonjour") != "" {
		t.Errorf("cached from the handler: %q, %d calls", got, translated)
	}
	text, err := c.Translate(ctx, "Cassé", "en")
	if text != "Cassé" || err == nil || !strings.Contains(err.Error(), "handler down") {
		t.Errorf("handler failure: %q %v", text, err)
	}
	// No API key: the usage handler is not reached either (the node rule logs and returns).
	if err := c.FlushUsage(ctx); err != nil || usage != 0 {
		t.Errorf("usage without a key: %v, %d", err, usage)
	}
}

func TestUnknownLanguageRendersTheKey(t *testing.T) {
	script := newScripted(okTranslate(nil))
	c, _, _ := newTestClient(t, Config{APIKey: "k"}, script)
	if got := c.T(context.Background(), "Bonjour", "cn"); got != "Bonjour" || len(script.requests()) != 0 {
		t.Errorf("v2 code: %q, %d requests", got, len(script.requests()))
	}
}

func TestContextCancellation(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	answer := okTranslate(nil)
	answer.Block = release
	c, _, _ := newTestClient(t, Config{APIKey: "k"}, newScripted(answer))
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	text, err := c.Translate(ctx, "Bonjour", "en")
	if text != "Bonjour" || !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("%q %v", text, err)
	}
}

func jsonEqual(a, b any) bool {
	ra, _ := json.Marshal(a)
	rb, _ := json.Marshal(b)
	return string(ra) == string(rb)
}

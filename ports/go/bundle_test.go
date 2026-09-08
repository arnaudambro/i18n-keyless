package i18nkeyless

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// The boot behaviour with Config.BundlePath (PROTOCOL.md 7.4, the node model): a covered
// namespace is read from the files and never fetched, an uncovered one is fetched as before,
// a miss still POSTs. The API is an httptest server that counts what the client asks.

var bundleManifest = map[string]any{
	"primaryLanguage": "fr",
	"languages":       []string{"en", "es", "fr"},
	"exportedAt":      "1757000000000",
	"namespaces": map[string]any{
		"default":  map[string]any{"lastRefresh": "1757000000000", "languages": []string{"en", "es", "fr"}},
		"checkout": map[string]any{"lastRefresh": "1757000000000", "languages": []string{"en"}},
	},
}

var bundleFiles = map[string]map[string]string{
	"default/en.json":  {"Bonjour": "Hello from the bundle", "Merci": "Thanks"},
	"default/es.json":  {"Bonjour": "Hola", "Merci": ""},
	"default/fr.json":  {"Bonjour": "Bonjour", "Merci": "Merci"},
	"checkout/en.json": {"Panier": "Cart"},
}

// writeBundle writes the file layout of PROTOCOL.md 4.5 into a temp dir: manifest.json plus
// one <namespace>/<lang>.json.
func writeBundle(t *testing.T, manifest any, files map[string]map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	raw, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	for name, dictionary := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(dictionary)
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// bundleAPI is a real HTTP server answering the dictionary GET and the translate POST, and
// counting each.
type bundleAPI struct {
	*httptest.Server
	gets, posts int32
	getURLs     []string
}

func newBundleAPI(t *testing.T) *bundleAPI {
	t.Helper()
	api := &bundleAPI{}
	api.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet:
			atomic.AddInt32(&api.gets, 1)
			api.getURLs = append(api.getURLs, r.URL.String())
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "error": "", "message": "", "data": map[string]any{
				"translations": map[string]map[string]string{"en": {"Bonjour": "Hello from the API"}, "es": {"Bonjour": "Hola"}},
				"uniqueId":     nil, "lastRefresh": "1757000000000",
			}})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/translate"):
			atomic.AddInt32(&api.posts, 1)
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			key, _ := body["key"].(string)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "error": "", "message": "", "data": map[string]any{
				"translation": map[string]any{"languages": map[string]string{"fr": key, "en": "Goodbye", "es": "Adiós"}, "id": 1},
			}})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "error": "", "message": ""})
		}
	}))
	t.Cleanup(api.Close)
	return api
}

func bundleConfig(api *bundleAPI, dir string) Config {
	return Config{APIKey: "k", APIURL: api.URL, BundlePath: dir, Logger: &testLogger{}, DisableUsage: true,
		Languages: Languages{Primary: "fr", Supported: []string{"fr", "en", "es"}}}
}

func TestBundleSeedsTheStoreAndSkipsTheBootFetch(t *testing.T) {
	api := newBundleAPI(t)
	c, err := Init(context.Background(), bundleConfig(api, writeBundle(t, bundleManifest, bundleFiles)))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx := context.Background()
	if got := atomic.LoadInt32(&api.gets); got != 0 {
		t.Errorf("the default namespace is covered: %d dictionary requests at boot, want 0", got)
	}
	if got := c.T(ctx, "Bonjour", "en"); got != "Hello from the bundle" {
		t.Errorf("en: %q", got)
	}
	if got := c.T(ctx, "Bonjour", "es"); got != "Hola" {
		t.Errorf("es: %q", got)
	}
	if got := c.T(ctx, "Panier", "en", WithNamespace("checkout")); got != "Cart" {
		t.Errorf("checkout: %q", got)
	}
	// The primary dictionary is seeded too; an empty cell is not a translation.
	if c.lookup("fr", "Merci") != "Merci" || c.lookup("es", "Merci") != "" {
		t.Errorf("fr/es Merci: %q %q", c.lookup("fr", "Merci"), c.lookup("es", "Merci"))
	}
	if atomic.LoadInt32(&api.gets) != 0 || atomic.LoadInt32(&api.posts) != 0 {
		t.Errorf("requests after three hits: %d GET, %d POST", api.gets, api.posts)
	}
}

func TestBundleLeavesAnUncoveredNamespaceFetched(t *testing.T) {
	api := newBundleAPI(t)
	manifest := map[string]any{"primaryLanguage": "fr", "languages": []string{"en"}, "exportedAt": "1",
		"namespaces": map[string]any{"checkout": map[string]any{"lastRefresh": "1757000000000", "languages": []string{"en"}}}}
	dir := writeBundle(t, manifest, map[string]map[string]string{"checkout/en.json": bundleFiles["checkout/en.json"]})
	c, err := Init(context.Background(), bundleConfig(api, dir))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if atomic.LoadInt32(&api.gets) != 1 || api.getURLs[0] != "/translate/?last_refresh=" {
		t.Errorf("the default namespace is not covered: boot fetch %v", api.getURLs)
	}
	if got := c.T(context.Background(), "Bonjour", "en"); got != "Hello from the API" {
		t.Errorf("en: %q", got)
	}
	if got := c.T(context.Background(), "Panier", "en", WithNamespace("checkout")); got != "Cart" {
		t.Errorf("checkout: %q", got)
	}

	// A covered, configured DefaultNamespace skips its boot fetch instead.
	api2 := newBundleAPI(t)
	cfg := bundleConfig(api2, dir)
	cfg.DefaultNamespace = "checkout"
	c2, err := Init(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer c2.Close()
	if atomic.LoadInt32(&api2.gets) != 0 {
		t.Errorf("configured namespace covered: %d GET", api2.gets)
	}
}

func TestBundleMissStillPosts(t *testing.T) {
	api := newBundleAPI(t)
	c, err := Init(context.Background(), bundleConfig(api, writeBundle(t, bundleManifest, bundleFiles)))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if got := c.T(context.Background(), "Au revoir", "en"); got != "Goodbye" {
		t.Errorf("miss: %q", got)
	}
	c.bg.Wait()
	// One POST, then the refetch that follows the burst, exactly as without a bundle.
	if atomic.LoadInt32(&api.posts) != 1 || atomic.LoadInt32(&api.gets) != 1 {
		t.Errorf("after a miss: %d POST, %d GET", api.posts, api.gets)
	}
	if got := c.T(context.Background(), "Au revoir", "en"); got != "Goodbye" || atomic.LoadInt32(&api.posts) != 1 {
		t.Errorf("second call: %q, %d POST", got, api.posts)
	}
}

func TestBundleMissingFileIsLoggedAndNotCovered(t *testing.T) {
	api := newBundleAPI(t)
	files := map[string]map[string]string{}
	for name, dictionary := range bundleFiles {
		if name != "default/es.json" {
			files[name] = dictionary
		}
	}
	logger := &testLogger{}
	cfg := bundleConfig(api, writeBundle(t, bundleManifest, files))
	cfg.Logger = logger
	c, err := Init(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if logger.contains("default/es") == 0 {
		t.Errorf("missing file not logged: %v", logger.lines)
	}
	if atomic.LoadInt32(&api.gets) != 0 {
		t.Error("coverage is the manifest's: the boot fetch is still skipped")
	}
	if got := c.T(context.Background(), "Bonjour", "es"); got != "Adiós" || atomic.LoadInt32(&api.posts) != 1 {
		t.Errorf("es miss: %q, %d POST", got, api.posts)
	}
}

func TestBundleManifestErrorsAreConfigurationErrors(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{APIKey: "k", BundlePath: dir, Languages: Languages{Primary: "fr"}}
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "manifest.json") {
		t.Errorf("missing manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte("[]"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(cfg); err == nil {
		t.Error("a JSON array accepted as a manifest")
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"primaryLanguage":"fr"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "namespaces") {
		t.Errorf("no namespaces: %v", err)
	}
}

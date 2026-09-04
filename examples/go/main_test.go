package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	i18nkeyless "github.com/arnaudambro/i18n-keyless/ports/go/v3"
)

// fixtures mirrors examples/_mock-server/fixtures.json for the strings this app renders.
var fixtures = map[string]map[string]string{
	"en": {
		"Langue : {{current_lang}}": "Language: {{current_lang}}",
		"Changer de langue":         "Switch language",
		"Accueil":                   "Home",
		"À propos":                  "About",
		"À propos de cette démo":    "About this demo",
		"8 heures__heure":           "8 AM",
		"8 heures__durée":           "8 hours",
	},
	"es": {
		"Changer de langue": "Cambiar de idioma",
		"À propos":          "Acerca de",
		"8 heures__durée":   "8 horas",
	},
}

// mockAPI is an in-process stand-in for examples/_mock-server: the same three routes, the
// same canned answers, so the test needs no Node and no network.
func mockAPI(t *testing.T) (*httptest.Server, *int) {
	t.Helper()
	posts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && r.URL.Path == "/translate/":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": map[string]any{"translations": fixtures}})
		case r.Method == "POST" && r.URL.Path == "/translate":
			posts++
			var body struct{ Key, Context string }
			_ = json.NewDecoder(r.Body).Decode(&body)
			key := i18nkeyless.StorageKeyFor(body.Key, body.Context)
			languages := map[string]any{"fr": body.Key}
			for lang, dict := range fixtures {
				if text, ok := dict[key]; ok {
					languages[lang] = text
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": map[string]any{"translation": map[string]any{"languages": languages}}})
		case r.Method == "POST" && r.URL.Path == "/translate/last-used-translations":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server, &posts
}

func get(t *testing.T, app http.Handler, path string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	app.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
	if rec.Code != 200 {
		t.Fatalf("%s: %d", path, rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	return string(body)
}

func TestPagesAreTranslated(t *testing.T) {
	api, posts := mockAPI(t)
	client, err := i18nkeyless.Init(context.Background(), i18nkeyless.Config{
		APIKey: "demo", APIURL: api.URL, DisableUsage: true,
		Languages: i18nkeyless.Languages{Primary: "fr", Supported: supported},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	app := newHandler(client)

	fr := get(t, app, "/")
	for _, want := range []string{`<html lang="fr">`, "Langue : fr", "Changer de langue", "8 heures / 8 heures"} {
		if !strings.Contains(fr, want) {
			t.Errorf("French page lacks %q:\n%s", want, fr)
		}
	}
	en := get(t, app, "/?lang=en")
	for _, want := range []string{`<html lang="en">`, "Language: en", "Switch language", "8 AM / 8 hours", ">Home<", ">About<"} {
		if !strings.Contains(en, want) {
			t.Errorf("English page lacks %q:\n%s", want, en)
		}
	}
	es := get(t, app, "/about?lang=es")
	for _, want := range []string{`<html lang="es">`, "Cambiar de idioma", ">Acerca de<"} {
		if !strings.Contains(es, want) {
			t.Errorf("Spanish page lacks %q:\n%s", want, es)
		}
	}
	// A string the mock does not know is rendered as its French source and POSTed once.
	if !strings.Contains(es, "À propos de cette démo") || *posts == 0 {
		t.Errorf("miss handling: %d POSTs\n%s", *posts, es)
	}
	// An unsupported tag falls back to French; a regional tag resolves.
	if !strings.Contains(get(t, app, "/?lang=xx"), `<html lang="fr">`) || !strings.Contains(get(t, app, "/?lang=en-GB"), `<html lang="en">`) {
		t.Error("language resolution")
	}
}

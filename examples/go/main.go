// A two-page net/http app translated with the i18n-keyless Go port.
//
// Primary language is French, like every example: the source strings are written in
// French and the API (or the offline mock backend) serves English and Spanish.
//
//	I18N_KEYLESS_API_KEY=... go run .              # the real service
//	I18N_KEYLESS_API_URL=http://localhost:8787 go run .   # the mock in ../_mock-server
package main

import (
	"context"
	"html/template"
	"log"
	"net/http"
	"os"

	i18nkeyless "github.com/arnaudambro/i18n-keyless/ports/go/v3"
)

var supported = []string{"fr", "en", "es"}

func main() {
	cfg := i18nkeyless.Config{
		APIKey:    os.Getenv("I18N_KEYLESS_API_KEY"),
		APIURL:    os.Getenv("I18N_KEYLESS_API_URL"),
		Languages: i18nkeyless.Languages{Primary: "fr", Supported: supported},
	}
	if cfg.APIKey == "" && cfg.APIURL == "" {
		// Offline mode: the mock backend of examples/_mock-server, with a dummy key.
		cfg.APIKey, cfg.APIURL = "demo", "http://localhost:8787"
	}
	client, err := i18nkeyless.Init(context.Background(), cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	addr := ":3000"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	}
	log.Printf("http://localhost%s  (try /?lang=en, /about?lang=es)", addr)
	log.Fatal(http.ListenAndServe(addr, newHandler(client)))
}

// page is the data of one render: the language, and the translated strings that need an
// option (a context, a replacement) and so are resolved in Go rather than in the template.
type page struct {
	Lang      string
	Languages []string
	Path      string
}

// layout is shared by both pages; each page adds its "body". The `t` function is bound to
// the client in newHandler, which is why the templates are parsed there.
const layout = `
{{define "layout"}}<!doctype html>
<html lang="{{.Lang}}"><meta charset="utf-8">
<nav>
  <a href="/?lang={{.Lang}}">{{t .Lang "Accueil"}}</a> ·
  <a href="/about?lang={{.Lang}}">{{t .Lang "À propos"}}</a>
  <p>{{t .Lang "Changer de langue"}} :
  {{range .Languages}}<a href="{{$.Path}}?lang={{.}}">{{.}}</a> {{end}}</p>
</nav>
{{template "body" .}}
</html>{{end}}
`

const homeBody = `
{{define "body"}}
<h1>{{.Greeting}}</h1>
<p>{{t .Lang "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez."}}</p>
<p>{{.Clock}} / {{.Duration}}</p>
{{end}}`

const aboutBody = `
{{define "body"}}
<h1>{{t .Lang "À propos de cette démo"}}</h1>
<p>{{t .Lang "Cette page utilise des chaînes différentes de la page d'accueil — en SSR, chaque page ne sérialise que ses propres clés."}}</p>
{{end}}`

// newHandler builds the two pages. The `t` template function calls the client with the
// page's language; the strings that take an option are resolved in the handlers.
func newHandler(client *i18nkeyless.Client) http.Handler {
	funcs := template.FuncMap{
		"t": func(lang, text string) string { return client.T(context.Background(), text, lang) },
	}
	home := template.Must(template.New("home").Funcs(funcs).Parse(layout + homeBody))
	about := template.Must(template.New("about").Funcs(funcs).Parse(layout + aboutBody))

	lang := func(r *http.Request) string {
		return i18nkeyless.ResolveLang(r.URL.Query().Get("lang"), &i18nkeyless.ResolveOptions{
			Supported: supported, Fallback: "fr",
		})
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		l := lang(r)
		ctx := r.Context()
		data := struct {
			page
			Greeting, Clock, Duration string
		}{
			page: page{Lang: l, Languages: supported, Path: "/"},
			// A placeholder: WithReplace substitutes it after the translation.
			Greeting: client.T(ctx, "Langue : {{current_lang}}", l, i18nkeyless.WithReplace(map[string]string{"{{current_lang}}": l})),
			// One string, two meanings: the context picks the entry.
			Clock:    client.T(ctx, "8 heures", l, i18nkeyless.WithContext("heure")),
			Duration: client.T(ctx, "8 heures", l, i18nkeyless.WithContext("durée")),
		}
		render(w, home, "layout", data)
	})
	mux.HandleFunc("/about", func(w http.ResponseWriter, r *http.Request) {
		render(w, about, "layout", page{Lang: lang(r), Languages: supported, Path: "/about"})
	})
	return mux
}

func render(w http.ResponseWriter, tmpl *template.Template, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := tmpl.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

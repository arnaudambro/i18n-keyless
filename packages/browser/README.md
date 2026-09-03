# i18n-keyless-browser

Translate any web page without translation keys: the string you write is the key. No
framework required: this package is the base layer for Svelte, Alpine, htmx, jQuery,
plain HTML and legacy sites. It wraps [`i18n-keyless-core`](https://www.npmjs.com/package/i18n-keyless-core)
in a plain store, a DOM helper and one web component, `<i18n-t>`.

Get an API key at https://i18n-keyless.com/#get-api-key

## Quick start: one script tag

```html
<script async type="module" src="https://esm.sh/i18n-keyless-browser/auto"
        data-api-key="YOUR_API_KEY" data-primary="fr" data-supported="fr,en,es"></script>
<h1 data-i18n>Bonjour le monde</h1>
<p><i18n-t context="durée">8 heures</i18n-t></p>
<button onclick="i18nKeyless.setCurrentLanguage('en')">English</button>
```

That is all. On load the script reads its own `data-*` attributes, initializes the store,
translates every `data-i18n` element and every `<i18n-t>`, and exposes the JS API as
`window.i18nKeyless`. Translations are cached in `localStorage`.

### Script tag attributes

| Attribute | Config | Notes |
| --- | --- | --- |
| `data-api-key` | `API_KEY` | required |
| `data-primary` | `languages.primary` | required: the language the page is written in |
| `data-supported` | `languages.supported` | comma separated, the primary is always added |
| `data-lang` | `languages.initWithDefault` | language of the first visit |
| `data-fallback` | `languages.fallback` | when the requested language is not supported |
| `data-skip-language-hydration` | `languages.skipCurrentLanguageHydration` | ignore the stored language: the page decides (URL) |
| `data-api-url` | `API_URL` | self-hosted backend |
| `data-namespace` | `defaultNamespace` | project-wide namespace |
| `data-storage` | `storage` | `local` (default), `session` or `memory` |
| `data-debug` | `debug` | log every step |

`window.i18nKeyless` holds the whole JS API below, plus `ready`, a promise that resolves
once the store is hydrated.

The `async` attribute prevents the script from blocking page rendering if the CDN is slow.

The package is plain ESM and imports its dependency by name (`i18n-keyless-core`), so the
URL must come from a CDN that resolves bare specifiers (esm.sh, or unpkg with `?module`).

**For maximum reliability**, pin the exact version in the URL. The bare path
(`esm.sh/i18n-keyless-browser/auto`) re-resolves every 10 minutes and can time out when
esm.sh rebuilds the module. A pinned path gets an immutable cache:

```html
<script async type="module" src="https://esm.sh/i18n-keyless-browser@3.5.0/auto"
        data-api-key="YOUR_API_KEY" data-primary="fr" data-supported="fr,en,es"></script>
```

To serve the files yourself, add an import map before the script tag:

```html
<script type="importmap">
  { "imports": { "i18n-keyless-core": "/vendor/i18n-keyless-core/dist/index.js" } }
</script>
```

## JS API

```bash
npm install i18n-keyless-browser
```

```ts
import { init, getTranslation, setCurrentLanguage, subscribe, translateDom, defineI18nT } from "i18n-keyless-browser";

init({
  API_KEY: "YOUR_API_KEY",
  languages: { primary: "fr", supported: ["fr", "en", "es"] },
  // storage: window.localStorage (default), sessionStorage, or any getItem/setItem/removeItem object
});

defineI18nT();          // registers <i18n-t>
translateDom();         // binds every [data-i18n] element under document.body

const label = getTranslation("Votre email");            // cached translation, or the source
await setCurrentLanguage("en");                          // persists, refetches, notifies
const stop = subscribe((state) => console.log(state.currentLanguage));
```

| Function | What it does |
| --- | --- |
| `init(config)` | Same options as `i18n-keyless-react`. Hydrates from storage, fetches the current language, sends the usage report once. |
| `getTranslation(text, options)` | The cached translation, or `text` when it is not there yet (it is then requested). Records usage. Plain function: no subscription. |
| `resolveTranslation(text, options, state?)` | Same lookup, no side effect. For use inside a `subscribe` listener. |
| `watchTranslation(text, options, onText)` | Calls `onText(translated, lang)` now and on every change of that string. Returns the stop function. The building block for Svelte, Alpine, jQuery bindings. |
| `translateDom(root = document.body)` | Binds every `[data-i18n]` element under `root`. Returns the stop function. |
| `defineI18nT(name = "i18n-t")` | Registers the web component. |
| `setCurrentLanguage(lang)` / `getCurrentLanguage()` | Switch and read the language. |
| `getSupportedLanguages()` | The `supported` list, for a picker. |
| `subscribe(listener)` / `getState()` | The plain store. `listener(state, previous)`. |
| `clearI18nKeylessStorageAndStore()` | Wipes the cache. The device id stays. |

## `<i18n-t>`

```html
<i18n-t>Bonjour</i18n-t>
<i18n-t context="durée" namespace="shop">8 heures</i18n-t>
```

The initial text content is the source (trimmed). Light DOM, no shadow root: your CSS
applies. The element subscribes on connect and unsubscribes on disconnect.

Attributes: `context`, `namespace`, `origin-language`, `unpersisted-namespace`, `debug`.
Properties, from JS: `replace` (an object) and `text` (the source).

```js
const el = document.querySelector("i18n-t");
el.replace = { "{name}": user.name };   // <i18n-t>Bonjour {name}</i18n-t>
```

## `data-i18n`

```html
<h1 data-i18n>Bonjour</h1>
<span data-i18n data-i18n-context="durée" data-i18n-namespace="shop">8 heures</span>
<span data-i18n="Bonjour">Hello (already rendered by the server)</span>
```

The source is the value of `data-i18n` when it is not empty, else the element's text. The
whole text content of the element is replaced by the translation. Other attributes:
`data-i18n-context`, `data-i18n-namespace`, `data-i18n-origin-language`,
`data-i18n-unpersisted-namespace`, `data-i18n-debug`. Content added later needs a new
`translateDom(newNode)` call; calling it twice on the same element is safe.

## Per-translation options

Same as the React package: `context`, `replace`, `namespace`, `unpersistedNamespace`,
`forceTemporary`, `originLanguage`, `debug`. See the
[main README](https://github.com/arnaudambro/i18n-keyless#readme) for the details.

## Languages

`AVAILABLE_LANGS`, the `Lang` type, `resolveLang` and `toAppStoreLocale` are re-exported
from `i18n-keyless-core`.

```ts
import { AVAILABLE_LANGS, resolveLang } from "i18n-keyless-browser";
setCurrentLanguage(resolveLang(navigator.language, { supported: ["fr", "en"], fallback: "en" }));
```

## Example

[`examples/browser`](https://github.com/arnaudambro/i18n-keyless/tree/main/examples/browser):
one HTML file, the auto entry, an offline mock backend.

## Docs

https://docs.i18n-keyless.com

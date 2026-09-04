# i18n-keyless-vue

Translate a Vue 3 app without translation keys. Write the string in your primary language,
wrap it, and the SDK resolves it at runtime: cache hit, instant; cache miss, the server
generates the translation with AI, stores it, and pushes it to the client cache.

```ts
// main.ts
import { createApp } from "vue";
import { init, I18nKeyless } from "i18n-keyless-vue";
init({ API_KEY: "YOUR_API_KEY", storage: window.localStorage, languages: { primary: "fr", supported: ["fr", "en"] } });
createApp(App).use(I18nKeyless).mount("#app"); // registers <T> globally
```

```vue
<h1><T>Bonjour le monde</T></h1>
```

Get an API key: https://i18n-keyless.com/#get-api-key

## Install

```bash
npm install i18n-keyless-vue
```

Peer dependency: `vue >= 3.3`.

## Quick start

1. Call `init` once, before the app mounts. `storage` is required in the browser
   (`window.localStorage`, or any object with `getItem` / `setItem` / `removeItem`, sync or
   async: `idb-keyval`, Capacitor Preferences...).
2. Install the `I18nKeyless` plugin. It registers `<T>` (alias `<I18nKeylessText>`) and
   `<I18nKeylessProvider>` globally. Pass `registerComponents: false` to import them yourself.
3. Wrap your strings: `<T>Bonjour</T>`.
4. Switch language: `setCurrentLanguage("en")`.
5. Done. Translations are fetched once per string, cached in `storage`, and every `<T>`
   re-renders when they land. A component instance asks for a missing translation once per
   language, however often it re-renders (React does the same, once per mount).

## API

### Three ways to translate

```vue
<script setup lang="ts">
import { useI18nKeyless, useTranslation, getTranslation } from "i18n-keyless-vue";

// 2. t(): for template expressions and attributes. Reactive where it is read.
const { t, currentLanguage, setCurrentLanguage } = useI18nKeyless();

// 3. useTranslation(): a computed string, follows a ref or a getter.
const placeholder = useTranslation("Votre email");
const greeting = useTranslation(() => `Bonjour {name}`, () => ({ replace: { "{name}": props.name } }));
</script>

<template>
  <!-- 1. The component: the default. A bare text node, no wrapper element. -->
  <h1><T>Bonjour le monde</T></h1>
  <input :placeholder="t('Votre email')" />
  <p :title="t('8 heures', { context: 'heure' })">{{ t("8 heures", { context: "durée" }) }}</p>
</template>
```

`getTranslation(text, options)` is the plain function for code that runs outside a
component (a router guard, a utility, a store). The store is a Vue reactive object, so a
call made inside a template or a `computed` is tracked too; but it does not see the
`<I18nKeylessProvider>` / plugin scope. Inside a component prefer `t()`.

Translate-on-miss and usage recording are memoized per component instance: `<T>`, `t()`
and `useTranslation()` request a key at most once per (language, namespace, key) for the
instance's lifetime, like the React package's effect (once per mount), and `forceTemporary`
follows the same rule. A language switch re-requests once, for the new language.
`getTranslation()` has no instance: each call on a miss is its own request.

### Per-translation options

Props of `<T>` and the options argument of `t()`, `useTranslation()` and `getTranslation()`:

| Option | What it does |
| --- | --- |
| `context` | Disambiguates meaning. `<T context="heure">8 heures</T>` and `<T context="durée">8 heures</T>` are two translations, stored as `8 heures__heure` and `8 heures__durée`. |
| `replace` | Interpolation. The keys include the delimiters: `<T :replace="{ '{name}': user.name }">Bonjour {name}</T>`. |
| `namespace` | A fetch / storage partition. Splits a large project so a client downloads and persists only the slice it renders. Default `"default"`; set a project-wide one with `defaultNamespace` in `init`. |
| `unpersistedNamespace` | Memory-only namespace, for high-cardinality transient content. |
| `forceTemporary` | Override the AI translation from code: `{ en: "My own wording" }`. |
| `originLanguage` | User generated content: the language *that string* is written in. |
| `debug` | Logs the resolution of that one string. |

The slot of `<T>` is trimmed: a multi-line slot and an inline one are the same key. In
development, leading or trailing whitespace logs a warning.

### `init(config)`

| Key | |
| --- | --- |
| `API_KEY` | required |
| `API_URL` | your own backend instead of `https://api.i18n-keyless.com` |
| `languages.primary` | the language the source code is written in |
| `languages.supported` | what the user can switch to |
| `languages.fallback` | used when `setCurrentLanguage` gets an unsupported code (default: primary) |
| `languages.initWithDefault` | the language on first launch (default: primary) |
| `languages.skipCurrentLanguageHydration` | do not restore the language from storage (the URL drives it) |
| `storage` | required in the browser; defaults to an in-memory store on the server |
| `defaultNamespace` | project-wide namespace |
| `addMissingTranslations` | default `true`: a miss POSTs the key for translation |
| `ssr` | force the read-only server behavior (no usage analytics) |
| `onInit(lang)`, `onSetLanguage(lang)` | hooks |
| `handleTranslate`, `getAllTranslations`, `sendTranslationsUsage` | custom handlers instead of the HTTP API |
| `debug` | verbose logs |

### Store and language

```ts
import {
  setCurrentLanguage,      // switch and fetch; persists the choice
  useCurrentLanguage,      // computed<Lang>, provider-aware
  getSupportedLanguages,   // the configured list
  useI18nKeyless,          // composable: { t, currentLanguage, translations, store, setCurrentLanguage, getSupportedLanguages }
  clearI18nKeylessStorageAndStore,
  AVAILABLE_LANGS, type Lang,
} from "i18n-keyless-vue";

useI18nKeyless.getState().translations; // the live reactive store, from plain script code
useI18nKeyless.setState({ currentLanguage: "en" }); // tests
```

## SSR (Nuxt, Vite SSR)

Two modes, both read-only on the server: no usage analytics leave a server render, and
`storage` is optional there (an in-memory store is used).

### 1. Primary-language SSR

Zero extra code: `init` on the server and on the client, the HTML renders in the primary
language, the client switches after hydration.

### 2. Localized SSR: render `?lang=en` or `/en/...` on the server

One Vue app instance per request means one scope per request. Give the plugin the
request's language and translations; every `<T>`, `t()` and `useTranslation()` in the app
resolves against them, with no shared mutable state between concurrent requests.

```ts
// server (per request)
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { init, I18nKeyless, getServerTranslations, runWithI18nKeyless, getUsedTranslationsSnapshot } from "i18n-keyless-vue";

await init({ API_KEY, languages: { primary: "fr", supported: ["fr", "en"] } }); // once per process

export async function render(lang: Lang) {
  const translations = await getServerTranslations(lang); // cached per process, per language
  return runWithI18nKeyless({ lang, translations }, async () => {
    const app = createSSRApp(App).use(I18nKeyless, { lang, translations });
    const html = await renderToString(app);
    // Serialize only the keys this page used, for the client:
    const snapshot = getUsedTranslationsSnapshot(); // { lang, translations }
    return { html, snapshot };
  });
}
```

```ts
// client entry
import { createSSRApp } from "vue";
import { init, I18nKeyless } from "i18n-keyless-vue";

init({ API_KEY, storage: window.localStorage, languages: { primary: "fr", supported: ["fr", "en"] } });
const snapshot = window.__I18N__; // what the server serialized
createSSRApp(App).use(I18nKeyless, snapshot).mount("#app"); // seeds the store before the first render: no flash
```

`runWithI18nKeyless` is what makes the plain `getTranslation()` function resolve in the
request's language too (through `AsyncLocalStorage`). Under the plugin alone, `<T>`, `t()`
and `useTranslation()` are already correct.

`<I18nKeylessProvider :lang :translations>` does the same job as the plugin for one
subtree, when you cannot install the plugin per request.

Both accept `primary`, the language the source strings are written in (≥ 3.6.1). It is
optional when `init()` runs in the same module graph as the components: the scope then
defaults to the store's primary. Pass it when that is not guaranteed (a framework that
server-renders the components in a second module graph, where the store never ran `init()`).
Without it, on such a store, the resolution would compare the request language with the
default primary and a request in the app's real primary language would render the
dictionary instead of the source strings.

### Nuxt

Nuxt creates one app per request and runs plugins in both environments. A dedicated Nuxt
module is out of scope; this plugin file is the whole integration:

```ts
// plugins/i18n-keyless.ts
import { init, I18nKeyless, getServerTranslations, type Lang } from "i18n-keyless-vue";

export default defineNuxtPlugin(async (nuxtApp) => {
  const config = useRuntimeConfig();
  // Server: once per process. Client: once per page load. Storage defaults to memory on the server.
  init({
    API_KEY: config.public.i18nKeylessApiKey,
    storage: import.meta.client ? window.localStorage : undefined,
    languages: { primary: "fr", supported: ["fr", "en"] },
  });

  const lang = (useRoute().params.lang as Lang) ?? "fr";
  // Server: fetch (cached per process) and hand the map to the client through the payload.
  // Client: read it back from the payload, so the first render matches the HTML.
  const translations = useState("i18n-keyless", () => ({}));
  if (import.meta.server) {
    translations.value = await getServerTranslations(lang);
  }

  // A ref is accepted (and tracked), so a later payload update reaches every <T>.
  nuxtApp.vueApp.use(I18nKeyless, { lang, translations });
});
```

With `routes` like `/:lang/...`, the language lives in the URL and the plugin scope follows
it; `setCurrentLanguage` is for the SPA mode without a scope.

## Languages

48 supported codes, the App Store localizations. Exported at runtime as `AVAILABLE_LANGS`
and as the `Lang` type. Never hardcode the list.

## License

MIT

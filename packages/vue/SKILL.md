---
name: i18n-keyless-vue
description: Install and use i18n-keyless-vue, the keyless i18n SDK for Vue 3 where the source string itself is the translation key. No JSON files, no key names, AI translations at runtime. Use when adding, configuring or debugging internationalization / translations / multi-language support in a Vue 3, Nuxt or Vite SSR project, or when the project already depends on `i18n-keyless-vue` or `i18n-keyless-core`.
license: MIT
---

# i18n-keyless-vue

Translate a Vue app without translation keys. You write the string in your primary language,
wrap it, and the SDK resolves it at runtime: cache hit, instant; cache miss, the server
generates the translation with AI, stores it, and pushes it to the client cache. One API
call per string, ever, for all users worldwide.

**Version covered: v3 (`i18n-keyless-vue@3.x`).** Same feature set and semantics as
`i18n-keyless-react`; the React skill (`skills/i18n-keyless/SKILL.md`) covers React,
React Native and Node.

## Decide first

| Target | Package | Notes |
| --- | --- | --- |
| Vue 3 SPA (Vite) | `i18n-keyless-vue` | `storage` required in the browser |
| Nuxt, Vite SSR | `i18n-keyless-vue` | see [SSR](#ssr) |
| Node backend (emails, push, cron) | `i18n-keyless-node` | no storage, `await` every call |

An API key is required: https://i18n-keyless.com/#get-api-key

## Install in one step

```bash
npm install i18n-keyless-vue
```

Call `init` once in the entry file, **before** the app mounts, and install the plugin:

```ts
import { createApp } from "vue";
import { init, I18nKeyless } from "i18n-keyless-vue";

init({
  API_KEY: "YOUR_API_KEY",
  storage: window.localStorage,
  languages: {
    primary: "fr",            // the language the source code is written in
    supported: ["en", "fr"],  // what the user can switch to
    fallback: "en",           // optional
  },
});

createApp(App).use(I18nKeyless).mount("#app"); // registers <T> / <I18nKeylessText> globally
```

Any object with `getItem` / `setItem` / `removeItem` (sync or async) is a valid storage
adapter: `window.localStorage`, `idb-keyval`'s `get` / `set` / `del`, Capacitor Preferences.

## Use it

### Three paths, pick per site

```vue
<script setup lang="ts">
import { useI18nKeyless, useTranslation, getTranslation } from "i18n-keyless-vue";

// 2. t(): inside a component, for template expressions and props that need a plain
//    string (placeholder, title, aria). Same options as <T>, same resolution, reactive.
const { t } = useI18nKeyless();

// 3. useTranslation(): a computed string that follows a ref or a getter.
const placeholder = useTranslation("Votre email");
</script>

<template>
  <!-- 1. Component: the default. Re-renders on its own when the translation lands. -->
  <h1><T>Bonjour le monde</T></h1>
  <input :placeholder="t('Votre email')" />
</template>
```

`getTranslation(text, options)` is the plain function for code OUTSIDE a component (a
router guard, a Pinia store, a utility). It reads the reactive store, so it is tracked
when called from a template or a `computed`, but it does not see the provider / plugin
scope under SSR. In a component, use `t()` or `useTranslation()`.

### Switch language

```ts
import { setCurrentLanguage, useCurrentLanguage, getSupportedLanguages } from "i18n-keyless-vue";

setCurrentLanguage("en");
const currentLanguage = useCurrentLanguage(); // computed<Lang>, unwraps in templates
getSupportedLanguages();                      // the configured list, for a picker
```

## Per-translation options

Props on `<T>` and the options argument of `t(text, options)`, `useTranslation(text, options)`
and `getTranslation(text, options)`:

- `context`: disambiguates meaning. `<T context="heure">8 heures</T>` vs
  `<T context="durée">8 heures</T>` become two distinct translations (`key__context`).
- `replace`: interpolation. **The keys include the literal delimiters**:
  `<T :replace="{ '{name}': user.name }">Bonjour {name}</T>`. Single braces: Vue's template
  compiler owns `{{ }}`.
- `namespace`: a fetch/storage partition, not a semantic key. Splits a large project so a
  client downloads and persists only the slice it renders. Fixes the localStorage quota
  error. Reserved default: `"default"`. Set a project-wide one with `defaultNamespace` in
  `init`.
- `unpersistedNamespace`: memory-only namespace, for high-cardinality transient content.
- `forceTemporary`: override the AI translation from code, without touching the dashboard.
- `originLanguage`: for user generated content, the language *that string* is written in
  when it is not the primary one.
- `debug`: logs the resolution of that one string.

## SSR

Works under Nuxt and Vite SSR, on Node and modern edge runtimes. Two modes:

1. **Primary-language SSR**: the default, zero extra code. `storage` is optional on the
   server (an in-memory store is used). The server render is read-only: it sends no usage
   analytics, so SSR adds no API traffic.
2. **Localized SSR**: render any language on the server, for indexable `?lang=xx` or
   `/{lang}/…` URLs. One app instance per request is one scope per request:

```ts
import { getServerTranslations, runWithI18nKeyless, getUsedTranslationsSnapshot, I18nKeyless } from "i18n-keyless-vue";

const translations = await getServerTranslations(lang);            // cached per process
const { html, snapshot } = await runWithI18nKeyless({ lang, translations }, async () => {
  const app = createSSRApp(App).use(I18nKeyless, { lang, translations });
  return { html: await renderToString(app), snapshot: getUsedTranslationsSnapshot() };
});
// client entry: createSSRApp(App).use(I18nKeyless, snapshot).mount("#app")
// (the plugin calls hydrateFromServer(snapshot) in the browser: no flash)
```

Both the plugin and `<I18nKeylessProvider>` accept `primary` (≥ 3.6.1), the source
language. Pass it when the components may render on a store that never ran `init()` (a
second module graph): the resolution then never reads the store's primary.

**The trap:** the paths resolve the language differently. `<T>`, `t()` and
`useTranslation()` read the plugin / `<I18nKeylessProvider>` scope through `inject`;
`getTranslation()` is a plain function and reads the `AsyncLocalStorage` scope set by
`runWithI18nKeyless`. Use the plugin (or the provider) for the component tree, and wrap the
render in `runWithI18nKeyless` only when server code outside components calls
`getTranslation()`.

**Nuxt:** a `plugins/i18n-keyless.ts` that calls `init`, then
`nuxtApp.vueApp.use(I18nKeyless, { lang, translations })` with `translations` fetched by
`getServerTranslations(lang)` on the server and carried to the client through `useState`.
The package README has the full file. A dedicated Nuxt module does not exist.

## Languages

48 supported codes, the App Store localizations. Exported at runtime as `AVAILABLE_LANGS`
and as the `Lang` type from `i18n-keyless-vue`. Never hardcode the list:

```ts
import { AVAILABLE_LANGS, type Lang } from "i18n-keyless-vue";
const isLang = (l: string): l is Lang => (AVAILABLE_LANGS as readonly string[]).includes(l);
```

## Gotchas

- `init` must run before any translation call.
- Source strings must be written in the `primary` language.
- A storage adapter must expose all three of `getItem` / `setItem` / `removeItem`.
- The slot of `<T>` is trimmed, so a multi-line slot is fine; but do not put elements
  inside `<T>`: only their text survives. In development, leading or trailing whitespace
  logs a warning.
- `useI18nKeyless()`, `useTranslation()` and `useCurrentLanguage()` must be called in
  `setup()` / `<script setup>`: that is where they read the provider scope.
- `useCurrentLanguage()` and `useTranslation()` return computed refs: `.value` in script,
  bare in templates.
- `<T>`, `t()` and `useTranslation()` request a missing translation (and record usage) once
  per component instance per (language, namespace, key), whatever the number of re-renders;
  a language switch re-requests once; `forceTemporary` follows the same rule. Same as
  React (once per mount). `getTranslation()` has no instance: each call on a miss is its
  own request.
- Translations are cached on-device. A dashboard edit reaches cached clients at the next
  refresh, not instantly.
- The component is `I18nKeylessText` (aliased `T`), not `I18nKeyless` (that is the plugin).
- In tests, seed the store with `useI18nKeyless.setState({ currentLanguage, translations, config })`
  and mock `fetch`; the store is a process-wide reactive object.
- A source string is capped at 2000 characters (`context` and `namespace` at 200). Long-form
  content is allowed, but a blog post is one translation **per Markdown block** of about 1000
  characters: keep the Markdown inside each block, give every block of the document the same
  `context` — one very short summary of it — and one `namespace` per document.
  https://docs.i18n-keyless.com/docs/guides/long-form-content

## Operate it from your agent (MCP)

Anything a human can do in the dashboard, you can do through the MCP server:

```bash
claude mcp add --transport http i18n-keyless https://api.i18n-keyless.com/mcp
```

Other clients: an HTTP MCP server at `https://api.i18n-keyless.com/mcp`
(`{ "mcpServers": { "i18n-keyless": { "type": "http", "url": "https://api.i18n-keyless.com/mcp" } } }`).

On the first call the browser opens once: sign in or sign up, pick the project, approve.
Then call `get_started` first: it returns the install steps with the project's key and
languages already filled in.

- `i18n:read`: `get_started`, `search_docs`, `list_languages`, `get_project`,
  `list_projects`, `list_translations`, `get_translation`
- `i18n:write`: `translate`, `migrate_translation`, `override_translation`, `delete_translation`,
  `set_project_languages`
- `i18n:account`: `create_project`, `invite_member`, `remove_member`

Guide: https://docs.i18n-keyless.com/docs/guides/mcp

## Go deeper

The entire documentation is one pasteable Markdown file: **https://docs.i18n-keyless.com/llms.txt**
Fetch it when this file does not answer the question.

- Docs: https://docs.i18n-keyless.com
- Runnable examples, one per framework: https://github.com/arnaudambro/i18n-keyless/tree/main/examples
  (`examples/vue-vite` for Vue)
- Dashboard: https://i18n-keyless.com/dashboard
- Get an API key: https://i18n-keyless.com/#get-api-key

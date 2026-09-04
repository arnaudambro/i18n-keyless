---
name: i18n-keyless-browser
description: Install and use i18n-keyless-browser, the framework-free browser SDK of i18n-keyless where the source string itself is the translation key. No JSON files, no key names, AI translations at runtime. Use when adding, configuring or debugging internationalization / translations / multi-language support in a plain HTML, Svelte, Alpine.js, htmx, jQuery, Web Components or legacy website, or when the project already depends on `i18n-keyless-browser`.
license: MIT
---

# i18n-keyless-browser

Translate a web page without translation keys. You write the string in your primary
language, mark it, and the SDK resolves it at runtime: cache hit, instant; cache miss, the
server generates the translation with AI, stores it and pushes it to the client cache. One
API call per string, ever, for all users worldwide.

**Version covered: v3 (`i18n-keyless-browser@3.x`).**

## Decide first

| Target | Path | Notes |
| --- | --- | --- |
| Static HTML, legacy site, CMS theme, no build step | script tag (`auto`) | zero code, `window.i18nKeyless` for inline scripts |
| Svelte, Alpine, htmx, jQuery, Lit, vanilla with a bundler | JS API | `watchTranslation` is the binding primitive |
| React, React Native, Next.js, Remix, TanStack Start, Astro | `i18n-keyless-react` | not this package |
| Node backend (emails, push, cron) | `i18n-keyless-node` | not this package |

An API key is required: https://i18n-keyless.com/#get-api-key

## Install in one step

### Script tag (no build)

```html
<script async type="module" src="https://esm.sh/i18n-keyless-browser/auto"
        data-api-key="YOUR_API_KEY"
        data-primary="fr"
        data-supported="fr,en,es"></script>
```

Place it in `<head>` or at the end of `<body>`; a module script runs after the document is
parsed. The package is plain ESM that imports `i18n-keyless-core` by name: use a CDN that
resolves bare specifiers (esm.sh, or unpkg with `?module`), or add an import map that
points `i18n-keyless-core` at your own copy of its `dist/index.js`.

The entry calls `init`, defines `<i18n-t>`, runs `translateDom()` on the whole body and
sets `window.i18nKeyless` (the full JS API plus `ready`, a promise).

Attributes: `data-api-key` (required), `data-primary` (required), `data-supported`
(comma separated), `data-lang` (first-visit language), `data-fallback`,
`data-skip-language-hydration`, `data-api-url`, `data-namespace`, `data-storage`
(`local` default, `session`, `memory`), `data-debug`.

### npm (with a bundler)

```bash
npm install i18n-keyless-browser
```

```ts
import { init, defineI18nT, translateDom } from "i18n-keyless-browser";

init({
  API_KEY: "YOUR_API_KEY",
  languages: {
    primary: "fr",            // the language the source strings are written in
    supported: ["en", "fr"],  // what the user can switch to
    fallback: "en",           // optional
  },
  // storage defaults to window.localStorage
});
defineI18nT();     // only if the page uses <i18n-t>
translateDom();    // only if the page uses data-i18n
```

`init` must run before any translation call. It validates and stores the config
synchronously, so `defineI18nT()` right after it is safe.

## Use it

### Mark the text: three paths, pick per site

```html
<!-- 1. data-i18n attribute: the element text is the source, the whole text is replaced -->
<h1 data-i18n>Bonjour le monde</h1>
<span data-i18n data-i18n-context="durée" data-i18n-namespace="shop">8 heures</span>

<!-- 2. <i18n-t> web component: light DOM, subscribes on connect, unsubscribes on disconnect -->
<p><i18n-t>Bonjour le monde</i18n-t></p>
<p><i18n-t context="heure">8 heures</i18n-t></p>
```

```ts
// 3. JS: a placeholder, a title, a string handed to another library
import { getTranslation, watchTranslation } from "i18n-keyless-browser";

input.placeholder = getTranslation("Votre email");             // one shot, not reactive
const stop = watchTranslation("Votre email", {}, (text) => {   // reactive
  input.placeholder = text;
});
```

`getTranslation` is a plain function: it returns the cached translation or the source text
(and requests the missing one), and it never re-runs on its own. For text that must follow
the language, use `watchTranslation` or `<i18n-t>`.

### Bind in a framework

```svelte
<!-- Svelte: a readable store from watchTranslation -->
<script>
  import { readable } from "svelte/store";
  import { watchTranslation } from "i18n-keyless-browser";
  export const t = (text, options) => readable(text, (set) => watchTranslation(text, options, set));
</script>
<h1>{$t("Bonjour le monde")}</h1>
```

```js
// Alpine.js: a magic helper
Alpine.magic("t", () => (text, options) => i18nKeyless.getTranslation(text, options));
i18nKeyless.subscribe(() => Alpine.store("i18n").tick++); // re-evaluate on change
```

```js
// htmx: translate swapped fragments
document.body.addEventListener("htmx:afterSwap", (event) => i18nKeyless.translateDom(event.target));
```

### Switch language

```ts
import { setCurrentLanguage, getCurrentLanguage, getSupportedLanguages } from "i18n-keyless-browser";

await setCurrentLanguage("en");   // persists, refetches every known namespace, updates every binding
getCurrentLanguage();             // "en"
getSupportedLanguages();          // ["fr", "en"] for a picker
```

From an inline script in auto mode: `i18nKeyless.setCurrentLanguage('en')`.

### React to the store

```ts
import { subscribe, getState, resolveTranslation } from "i18n-keyless-browser";

const stop = subscribe((state, previous) => {
  if (state.currentLanguage !== previous.currentLanguage) document.documentElement.lang = state.currentLanguage;
});
```

`resolveTranslation(text, options)` is the lookup with no side effect: safe inside a listener.

## Per-translation options

Attributes on `<i18n-t>` (`context`, `namespace`, `origin-language`,
`unpersisted-namespace`, `debug`), `data-i18n-*` attributes on `data-i18n` elements, and the
options argument of `getTranslation(text, options)` / `watchTranslation(text, options, cb)`:

- `context`: disambiguates meaning. `<i18n-t context="heure">8 heures</i18n-t>` vs
  `<i18n-t context="durée">8 heures</i18n-t>` become two distinct translations.
- `replace`: interpolation. **The keys include the literal delimiters**:
  `getTranslation("Bonjour {name}", { replace: { "{name}": user.name } })`. On `<i18n-t>`
  it is a property, not an attribute: `el.replace = { "{name}": user.name }`.
- `namespace`: a fetch/storage partition, not a semantic key. Splits a large site so a page
  downloads and persists only the slice it renders. Fixes the localStorage quota error.
  Reserved default: `"default"`. Set a site-wide one with `defaultNamespace` in `init`
  (`data-namespace` on the script tag).
- `unpersistedNamespace`: memory-only namespace, for high-cardinality transient content.
- `forceTemporary`: override the AI translation from code (JS only).
- `originLanguage`: for user generated content, the language *that string* is written in
  when it is not the primary one.
- `debug`: logs the resolution of that one string.

## Languages

48 supported codes, the App Store localizations. Exported at runtime as `AVAILABLE_LANGS`
and as the `Lang` type. `resolveLang(navigator.language, { supported, fallback })` maps a
browser tag onto a supported code.

**v3 renamed two codes: `cn` to `zh-Hans`, `cz` to `cs`.** Since v3 the primary language can
be *any* supported language. Upgrade guide: https://docs.i18n-keyless.com/docs/guides/upgrade-v3

Never hardcode the list: import it.

```ts
import { AVAILABLE_LANGS, type Lang } from "i18n-keyless-browser";
const isLang = (l: string): l is Lang => (AVAILABLE_LANGS as readonly string[]).includes(l);
```

## Gotchas

- `init` must run before any translation call. In auto mode this is done for you.
- Source strings must be written in the `primary` language.
- Do not leave leading or trailing whitespace inside `<i18n-t>` or a `data-i18n` element:
  the SDK trims it, and warns about it in development (`process.env.NODE_ENV`) or with `debug`.
- `data-i18n` replaces the **whole** text content of the element: keep child elements
  out of it, mark the leaf elements instead.
- `translateDom()` binds what exists at call time. Content inserted later (htmx swap,
  `innerHTML`, a modal) needs `translateDom(newNode)`. `<i18n-t>` needs nothing: it binds
  itself on connect.
- A module script has no `document.currentScript`; the auto entry finds its tag by `src`,
  then by `data-api-key`. Keep the attributes on the tag that loads `auto.js`.
- Self-hosted files fail with "Failed to resolve module specifier i18n-keyless-core" until
  an import map maps that name to the core `dist/index.js`.
- Storage keys are the same as `i18n-keyless-react`: a page can mix the two, or migrate,
  and keep its cache and its device id.
- Translations are cached on-device. A dashboard edit reaches cached clients at the next
  refresh, not instantly.
- The storage adapter must expose `getItem` / `setItem` / `removeItem` (or `get` / `set` /
  `remove`), sync or async.
- A source string is capped at 2000 characters (`context` and `namespace` at 200). Long-form
  content is allowed, but a blog post is one translation **per Markdown block** of about 1000
  characters: keep the Markdown inside each block, give every block of the document the same
  `context` — one very short summary of it — and one `namespace` per document.
  https://docs.i18n-keyless.com/docs/guides/long-form-content

## Operate it from your agent (MCP)

Anything a human can do in the dashboard, you can do through the MCP server: no key to
paste, OAuth gives you your own login:

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
- Runnable example: https://github.com/arnaudambro/i18n-keyless/tree/main/examples/browser
- Dashboard: https://i18n-keyless.com/dashboard
- Get an API key: https://i18n-keyless.com/#get-api-key

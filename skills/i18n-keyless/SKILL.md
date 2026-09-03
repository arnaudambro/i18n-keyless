---
name: i18n-keyless
description: Install and use i18n-keyless, the keyless i18n SDK where the source string itself is the translation key — no JSON files, no key names, AI translations at runtime. Use when adding, configuring or debugging internationalization / translations / multi-language support in a React, React Native, Expo, Next.js, Remix, TanStack Start, Astro or Node.js project, or when the project already depends on `i18n-keyless-react`, `i18n-keyless-node` or `i18n-keyless-core`.
license: MIT
---

# i18n-keyless

Translate an app without translation keys. You write the string in your primary language,
wrap it, and the SDK resolves it at runtime: cache hit → instant, cache miss → the server
generates the translation with AI, stores it, and pushes it to the client cache. One API
call per string, ever, for all users worldwide.

**Version covered: v3 (`i18n-keyless-*@3.x`).**

## Decide first

| Target | Package | Notes |
| --- | --- | --- |
| React web (Vite, CRA, SPA) | `i18n-keyless-react` | `storage` required in the browser |
| React Native / Expo | `i18n-keyless-react` | `storage` = MMKV or AsyncStorage |
| Next.js, Remix / RR7, TanStack Start, Astro | `i18n-keyless-react` | see [SSR](#ssr) |
| Node backend (emails, push, cron) | `i18n-keyless-node` | no storage, `await` every call |

An API key is required: https://i18n-keyless.com/#get-api-key

## Install in one step

### React (web)

```bash
npm install i18n-keyless-react
```

Call `init` once in the entry file, **before** rendering:

```ts
import * as I18nKeyless from "i18n-keyless-react";

I18nKeyless.init({
  API_KEY: "YOUR_API_KEY",
  storage: window.localStorage,
  languages: {
    primary: "fr",            // the language the source code is written in
    supported: ["en", "fr"],  // what the user can switch to
    fallback: "en",           // optional
  },
});
```

### React Native / Expo

```bash
npx expo install i18n-keyless-react react-native-mmkv
npx expo prebuild
```

```ts
import * as I18nKeyless from "i18n-keyless-react";
import { MMKV } from "react-native-mmkv";

I18nKeyless.init({
  API_KEY: "YOUR_API_KEY",
  storage: new MMKV(),
  languages: { primary: "fr", supported: ["en", "fr"] },
});
```

`@react-native-async-storage/async-storage` works too. Any object with `getItem` /
`setItem` / `removeItem` (sync or async) is a valid adapter — for IndexedDB, wrap
`idb-keyval`'s `get` / `set` / `del`.

### Node.js

```bash
npm install i18n-keyless-node
```

```ts
import * as I18nKeyless from "i18n-keyless-node";

I18nKeyless.init({
  API_KEY: "YOUR_API_KEY",
  languages: { primary: "fr", supported: ["en", "fr"] },
});
```

## Use it

### React — three paths, pick per site

```tsx
import { I18nKeylessText as T, useTranslation, getTranslation } from "i18n-keyless-react";

// 1. Component — the default. Re-renders on its own when the translation lands.
<h1><T>Bonjour le monde</T></h1>

// 2. Hook — inside a component, for props that need a plain string (labels, placeholders,
//    aria, a markdown source). Same options as <T>, same resolution, reactive.
const placeholder = useTranslation("Votre email");
<input placeholder={placeholder} />

// 3. Function — OUTSIDE a component: a route loader, head(), a utility.
export const loader = () => ({ title: getTranslation("Premier onglet") });
```

`getTranslation` is a plain function, **not a hook**. A component that only calls it will
not re-render when translations refresh, and under TanStack Start it renders the primary
language on the server. In a component, use `useTranslation`. If you must keep
`getTranslation` in a component, subscribe explicitly:

```tsx
import { useCurrentLanguage, useI18nKeyless } from "i18n-keyless-react";

useCurrentLanguage();                        // re-render on language change
useI18nKeyless((s) => s.translations);       // re-render on translations refresh
```

### Switch language

```ts
import { setCurrentLanguage, getSupportedLanguages } from "i18n-keyless-react";

setCurrentLanguage("en");
getSupportedLanguages(); // [{ label: "English", value: "en" }, …] for a picker
```

### Node

```ts
import { awaitForTranslationOrFallbackToOriginal, awaitForTranslationOrThrow, type Lang } from "i18n-keyless-node";

// MUST be awaited — fire-and-forget calls hit the rate limit (429).
const title = await awaitForTranslationOrFallbackToOriginal("Viens voir l'application", user.lang as Lang);
const title2 = await awaitForTranslationOrThrow("Viens voir l'application", user.lang as Lang); // rejects on failure; for scripts and build steps
```

## Per-translation options

Available as props on `<T>` and as the options argument of `useTranslation(text, options)` and
`getTranslation(text, options)`:

- `context` — disambiguates meaning. `<T context="clock time">8 heures</T>` vs
  `<T context="duration">8 heures</T>` become two distinct translations.
- `replace` — interpolation. **The keys include the literal delimiters**:
  `<T replace={{ "{name}": user.name }}>Bonjour {name}</T>`.
- `namespace` — a fetch/storage partition, not a semantic key. Splits a large project so a
  client downloads and persists only the slice it renders. Fixes the localStorage quota
  error. Reserved default: `"default"`. Set a project-wide one with `defaultNamespace` in
  `init`.
- `unpersistedNamespace` — memory-only namespace, for high-cardinality transient content
  (one per discussion, per document…).
- `forceTemporary` — override the AI translation from code, without touching the dashboard.
- `originLanguage` — for user generated content: the language *that string* is written in
  when it is not the primary one. The server translates it to the primary language, keeps
  the raw text verbatim for viewers of that language, and AI-translates the rest.
- `debug` — logs the resolution of that one string.

## Long content (blog posts, articles, docs)

Long-form content is **allowed**, but a post is not one translation — it is **one translation
per block**. A source string is capped at **2000 characters** (`context` and `namespace` at
200); a longer key is a `400`. That cap is a quality rule, not a storage one: the row is keyed
by a sha256 of the source text. **Target 1000 characters per block**, 2000 is the reject.

1. **Split the document into Markdown blocks** — a heading, a paragraph, a whole list, a
   quote, a table row. Never split inside a sentence. Cut a paragraph over 1000 characters at
   a sentence break, but keep a table or a list whole whatever its length.
2. **Keep the Markdown inside the block** (`**bold**`, `[link](url)`, `` `code` ``, list
   markers). The translation preserves the syntax, so the formatting survives; render each
   block with `react-markdown` (or `react-native-markdown-display`).
3. **Give every block of the post the same `context`: a very short summary of the post.**
   One sentence, 200 characters maximum. A lone paragraph does not say what the article is
   about — the summary is what makes that paragraph translate correctly.
4. **One `namespace` per post** (`blog:<slug>`), so a reader downloads only the post they open.
5. **Never send a code fence, a URL or a front-matter key** to be translated.
6. **Never rewrite the summary after publication.** `context` is part of the row identity, so
   a new summary makes every block a new row — translated and billed again.

The title, the description, the excerpt and every image `alt` are blocks too: same `context`,
same `namespace`.

```ts
import { awaitForTranslationOrFallbackToOriginal, type Lang } from "i18n-keyless-node";

const SUMMARY = "Guide: cache API responses at the edge with a Cloudflare Worker.";

async function translatePost(blocks: string[], slug: string, lang: Lang): Promise<string> {
  const out: string[] = [];
  for (const block of blocks) {
    out.push(
      await awaitForTranslationOrFallbackToOriginal(block, lang, {
        context: SUMMARY,
        namespace: `blog:${slug}`,
      }),
    );
  }
  return out.join("\n\n");
}
```

In React the shape is the same, one `useTranslation(block, { context, namespace })` per block.
Full guide: https://docs.i18n-keyless.com/docs/guides/long-form-content

## SSR

Works under TanStack Start, Next.js, Remix / React Router 7, Astro and any Node or modern
edge runtime. Two modes:

1. **Primary-language SSR** — the default, zero extra code. `storage` is optional on the
   server (an in-memory store is used). The server render is read-only: it sends no usage
   analytics, so SSR adds no API traffic.
2. **Localized SSR** — render any language on the server, for indexable `?lang=xx` or
   `/{lang}/…` URLs:

```ts
import {
  getServerTranslations,
  runWithI18nKeyless,
  getUsedTranslationsSnapshot,
  I18nKeylessProvider,
  hydrateFromServer,
} from "i18n-keyless-react";

const translations = await getServerTranslations(lang);
// wrap the server handler so the imperative path resolves:
await runWithI18nKeyless({ lang, translations }, async () => { /* render */ });
// then hand the used subset to the client and call hydrateFromServer(snapshot).
```

**The trap:** the paths resolve the language differently. `<T>` and `useTranslation`
read React context (`<I18nKeylessProvider lang translations>`); `getTranslation()` is a
plain function and reads the `AsyncLocalStorage` scope set by `runWithI18nKeyless`.
Which pieces you need depends on the framework:

- **Remix / RR7** — the tree renders inside the ALS, so both paths work from
  `runWithI18nKeyless` alone; the Provider is optional.
- **TanStack Start** — the tree renders *outside* the ALS. You need **both** the Provider
  (fed by the root loader) and `runWithI18nKeyless`. Call `getTranslation()` only in
  loaders and `head()`, never in a component body — a component that needs a string calls
  `useTranslation()` (≥ 3.3.0). Requires ≥ 2.3.2.
- **Next.js App Router / Astro islands** — use the Provider and prefer `<T>`; imperative
  `getTranslation()` in a server component renders the primary language until the client
  effect runs.

Read https://docs.i18n-keyless.com/docs/ssr before wiring any of it.

## Languages

48 supported codes, the App Store localizations. Exported at runtime as `AVAILABLE_LANGS`
and as the `Lang` type from both `i18n-keyless-react` and `i18n-keyless-node`.

**v3 renamed two codes: `cn` → `zh-Hans`, `cz` → `cs`.** The other 17 v2 codes are
unchanged. Since v3 the primary language can be *any* supported language; before v3 it had
to be `fr` or `en`. Upgrade guide: https://docs.i18n-keyless.com/docs/guides/upgrade-v3

Never hardcode the list — import it:

```ts
import { AVAILABLE_LANGS, type Lang } from "i18n-keyless-react";
const isLang = (l: string): l is Lang => (AVAILABLE_LANGS as readonly string[]).includes(l);
```

## Gotchas

- `init` must run before any translation call.
- Source strings must be written in the `primary` language.
- `awaitForTranslationOrThrow` / `awaitForTranslationOrFallbackToOriginal` must be awaited, always. `awaitForTranslation` is a deprecated alias of the `OrThrow` one.
- A storage adapter must expose all three of `getItem` / `setItem` / `removeItem`.
- Do not leave leading or trailing whitespace inside `<T>` — it changes the key. The SDK
  warns about it in development.
- Translations are cached on-device. A dashboard edit reaches cached clients at the next
  refresh, not instantly.
- For `react-markdown` and other renderers that block re-renders, key the renderer by the
  resolved translated text.
- The component is `I18nKeylessText` (aliased `T`) — not `I18nKeyless`.
- A source string is capped at 2000 characters, `context` and `namespace` at 200. Long-form
  content is fine, but send it block by block, around 1000 characters each — see "Long
  content" above.

## Operate it from your agent (MCP)

Anything a human can do in the dashboard, you can do through the MCP server — no key to
paste, OAuth gives you your own login:

```bash
claude mcp add --transport http i18n-keyless https://api.i18n-keyless.com/mcp
```

Other clients: an HTTP MCP server at `https://api.i18n-keyless.com/mcp`
(`{ "mcpServers": { "i18n-keyless": { "type": "http", "url": "https://api.i18n-keyless.com/mcp" } } }`).

On the first call the browser opens once: sign in or sign up (plan and payment included),
pick the project, approve. The token is bound to that one project — add the server once per
app. Then call `get_started` first: it returns the install steps with the project's key and
languages already filled in.

- `i18n:read` — `get_started`, `search_docs`, `list_languages`, `get_project`,
  `list_projects`, `list_translations`, `get_translation`
- `i18n:write` — `translate`, `migrate_translation`, `override_translation`,
  `delete_translation`, `set_project_languages`
- `i18n:account` — `create_project`, `invite_member`, `remove_member`,
  `cancel_subscription` (at period end), `resume_subscription`

Guide: https://docs.i18n-keyless.com/docs/guides/mcp

## Other frameworks

This skill covers React, React Native, Expo, the React SSR frameworks and Node. The other
SDKs speak the same protocol, take the same per-translation options and share the same
dashboard, but each has its own skill. Read the one for the project's stack instead of
adapting this file:

| Stack | Package | Skill |
| --- | --- | --- |
| Vue 3, Nuxt, Vite SSR | `i18n-keyless-vue` | `packages/vue/SKILL.md` |
| Angular >= 17.1 | `i18n-keyless-angular` | `packages/angular/SKILL.md` |
| Plain HTML, Svelte, Alpine, htmx, jQuery, legacy sites | `i18n-keyless-browser` | `packages/browser/SKILL.md` |
| Laravel 11, 12, 13 | `i18n-keyless/laravel` (Composer) | `ports/laravel/SKILL.md` |
| Ruby on Rails 7, 8 | `i18n-keyless-rails` (RubyGems) | `ports/rails/SKILL.md` |
| Flutter, Dart | `i18n_keyless` (pub.dev) | `ports/flutter/SKILL.md` |

Paths are relative to the repository root (https://github.com/arnaudambro/i18n-keyless).
The wire protocol they all implement is `docs/PROTOCOL.md`.

## Go deeper

The entire documentation is one pasteable Markdown file: **https://docs.i18n-keyless.com/llms.txt**
Fetch it when this file does not answer the question.

- Docs: https://docs.i18n-keyless.com
- Runnable examples, one per framework: https://github.com/arnaudambro/i18n-keyless/tree/main/examples
- Dashboard: https://i18n-keyless.com/dashboard
- Get an API key: https://i18n-keyless.com/#get-api-key

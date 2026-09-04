---
name: i18n-keyless-angular
description: Install and use i18n-keyless-angular, the keyless i18n SDK for Angular where the source string itself is the translation key: no JSON files, no key names, AI translations at runtime. Use when adding, configuring or debugging internationalization / translations / multi-language support in an Angular (>= 17.1, standalone, signals, Angular SSR) project, or when the project already depends on `i18n-keyless-angular` or `i18n-keyless-core`.
license: MIT
---

# i18n-keyless-angular

Translate an Angular app without translation keys. You write the string in your primary
language, wrap it, and the SDK resolves it at runtime: cache hit, instant; cache miss, the
server generates the translation with AI, stores it, and pushes it to the client cache. One
API call per string, ever, for all users worldwide.

**Version covered: v3 (`i18n-keyless-angular@3.x`). Angular >= 17.1, standalone APIs, signals.**

For React, React Native, Next.js, Remix, TanStack Start, Astro or Node, use the
`i18n-keyless` skill (`skills/i18n-keyless/SKILL.md`) instead.

An API key is required: https://i18n-keyless.com/#get-api-key

## Install in one step

```bash
npm install i18n-keyless-angular
```

Add the provider once, in `app.config.ts` (or `bootstrapApplication`):

```ts
import { ApplicationConfig } from "@angular/core";
import { provideI18nKeyless } from "i18n-keyless-angular";

export const appConfig: ApplicationConfig = {
  providers: [
    provideI18nKeyless({
      API_KEY: "YOUR_API_KEY",
      languages: {
        primary: "fr",            // the language the templates are written in
        supported: ["en", "fr"],  // what the user can switch to
        fallback: "en",           // optional
      },
      // storage defaults to window.localStorage in the browser, in-memory on the server
    }),
  ],
};
```

Nothing to await: the app renders in the primary language and re-renders into the current
language as the cache, then the network, answers.

## Use it

Import `I18nKeylessTextComponent` and `I18nKeylessTranslatePipe` in the `imports` of each
standalone component that uses them.

```ts
import { Component, inject } from "@angular/core";
import { I18nKeylessTextComponent, I18nKeylessTranslatePipe, I18nKeylessService } from "i18n-keyless-angular";

@Component({
  standalone: true,
  imports: [I18nKeylessTextComponent, I18nKeylessTranslatePipe],
  template: `
    <!-- 1. Component: the default. Re-renders on its own when the translation lands. -->
    <h1><i18n-t>Bonjour le monde</i18n-t></h1>

    <!-- 2. Pipe: attributes, <option>, <title>, anywhere an element cannot go. -->
    <input [placeholder]="'Votre email' | t" />

    <!-- 3. Service signal: a string built in the class. -->
    <button>{{ submitLabel() }}</button>
  `,
})
export class SignupComponent {
  private readonly i18n = inject(I18nKeylessService);
  readonly submitLabel = this.i18n.translation("Envoyer");
}
```

`I18nKeylessService.translate(text, options)` returns a reactive string: it reads signals, so
a template, a `computed` or an `effect` calling it re-evaluates. `getTranslation(text,
options)` (service method or bare export) is a one-shot, non-reactive read for code outside
change detection (a route title resolver, a toast). A value computed with it does not update
on a language switch.

### Switch language

```ts
const i18n = inject(I18nKeylessService);
i18n.currentLanguage();        // Signal<Lang>
i18n.setCurrentLanguage("en"); // persists, fetches, signals update
i18n.getSupportedLanguages();  // ["en", "fr"], for a picker
```

## Per-translation options

Inputs of `<i18n-t>`, and the options argument of the pipe, `translate()`, `translation()`
and `getTranslation()`:

- `context`: disambiguates meaning. `<i18n-t context="heure">8 heures</i18n-t>` vs
  `<i18n-t context="durée">8 heures</i18n-t>` become two distinct translations
  (`key__context`).
- `replace`: interpolation. **The keys include the literal delimiters**:
  `<i18n-t [replace]="{ '{name}': user.name }">{{ 'Bonjour {name}' }}</i18n-t>`. Wrap the
  source in `{{ '...' }}` when it contains `{`: Angular reads a bare `{` as an ICU block.
- `namespace`: a fetch/storage partition, not a semantic key. Splits a large project so a
  client downloads and persists only the slice it renders. Set a project-wide one with
  `defaultNamespace` in the config. `unpersistedNamespace`: memory-only namespace for
  high-cardinality transient content.
- `forceTemporary`: override the AI translation from code, without touching the dashboard.
- `originLanguage`: for user generated content: the language *that string* is written in
  when it is not the primary one.
- `debug`: logs the resolution of that one string.

## SSR (Angular SSR / `@angular/ssr`)

1. **Primary-language SSR**: the default, zero extra code. `provideI18nKeyless` works on the
   server (in-memory storage, `init` once per process, usage analytics never sent from a
   server). The client re-translates after hydration.
2. **Localized SSR**: render any language on the server, for indexable `?lang=xx` or
   `/{lang}/…` URLs. `provideI18nKeylessServer` is the counterpart of React's
   `<I18nKeylessProvider>`: `<i18n-t>`, the pipe and the service read its
   `{ lang, translations }` first, and fall back to the store when it is absent.

```ts
// app.config.server.ts
import { inject, REQUEST } from "@angular/core";
import { provideI18nKeylessServer, getServerTranslations, resolveLang } from "i18n-keyless-angular";

providers: [
  provideServerRendering(),
  provideI18nKeylessServer(async () => {           // runs in injection context, awaited
    const url = new URL(inject(REQUEST)?.url ?? "http://localhost/");
    const lang = resolveLang(url.searchParams.get("lang"), { supported: ["fr", "en"], fallback: "fr" })!;
    return { lang, translations: await getServerTranslations(lang), primary: "fr" };  // cached per process
  }),
]
```

Transfer the same `{ lang, translations }` to the client (`TransferState` or a JSON script
tag) and provide it there as well: in the browser `provideI18nKeylessServer` seeds the store
synchronously, so the first client render matches the server HTML. In provider mode the
language is the scope's `lang` (drive it from the URL); `setCurrentLanguage` is for SPA mode.
`primary` (≥ 3.6.1, optional) is the source language: with it in the scope the resolution
never reads the store's primary.

`runWithI18nKeyless`, `getRequestScope`, `getUsedTranslationsSnapshot` and
`hydrateFromServer` are exported for the imperative path, as in the React package. Read
https://docs.i18n-keyless.com/docs/ssr before wiring any of it.

## Languages

48 supported codes, the App Store localizations. Exported at runtime as `AVAILABLE_LANGS`
and as the `Lang` type. Never hardcode the list:

```ts
import { AVAILABLE_LANGS, resolveLang, type Lang } from "i18n-keyless-angular";
const lang = resolveLang(navigator.language, { supported: ["fr", "en"], fallback: "fr" });
```

## Gotchas

- `provideI18nKeyless` must be in the root providers, before any component renders.
- Source strings must be written in the `primary` language.
- The `t` pipe is impure on purpose (a pure pipe would never see the translation land). It
  reads signals, so it updates under `OnPush` and zoneless; do not add
  `markForCheck` calls around it.
- `<i18n-t>` keeps the source in a hidden `<span>` next to the rendered translation: read
  the rendered text with `element.lastChild.textContent` in a test, not `textContent`.
- `<i18n-t>` cannot live inside `<option>`, `<title>` or an attribute: use the pipe there.
- Whitespace around the text inside `<i18n-t>` is trimmed (the key is the trimmed text). In
  the pipe, `'Bonjour '` and `'Bonjour'` are the same key too, with a dev-mode warning.
- Translations are cached on-device. A dashboard edit reaches cached clients at the next
  refresh, not instantly.
- The published package is built with `ngc` (Ivy partial format), so the default AOT
  `ng build` works. Only a source checkout with no build needs JIT (`"aot": false` in
  `angular.json`), or run `npx ngc -p tsconfig.json` in `packages/angular`.
- A source string is capped at 2000 characters (`context` and `namespace` at 200). Long-form
  content is allowed, but a blog post is one translation **per Markdown block** of about 1000
  characters: keep the Markdown inside each block, give every block of the document the same
  `context` — one very short summary of it — and one `namespace` per document.
  https://docs.i18n-keyless.com/docs/guides/long-form-content

## Operate it from your agent (MCP)

```bash
claude mcp add --transport http i18n-keyless https://api.i18n-keyless.com/mcp
```

Other clients: `{ "mcpServers": { "i18n-keyless": { "type": "http", "url": "https://api.i18n-keyless.com/mcp" } } }`.
On the first call the browser opens once: sign in or sign up, pick the project, approve. Then
call `get_started` first: it returns the install steps with the project's key and languages
already filled in. Tools: `get_started`, `search_docs`, `list_languages`, `get_project`,
`list_translations`, `get_translation`, `translate`, `migrate_translation`,
`override_translation`, `delete_translation`, `set_project_languages`, `create_project`,
`invite_member`, `remove_member`.

## Go deeper

The entire documentation is one pasteable Markdown file: **https://docs.i18n-keyless.com/llms.txt**

- Docs: https://docs.i18n-keyless.com
- Runnable example: https://github.com/arnaudambro/i18n-keyless/tree/main/examples/angular
- Dashboard: https://i18n-keyless.com/dashboard
- Get an API key: https://i18n-keyless.com/#get-api-key

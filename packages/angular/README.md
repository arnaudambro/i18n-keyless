# i18n-keyless-angular

```bash
npm install i18n-keyless-angular
```

```ts
// app.config.ts
import { provideI18nKeyless } from "i18n-keyless-angular";
export const appConfig = { providers: [provideI18nKeyless({ API_KEY: "YOUR_API_KEY", languages: { primary: "fr", supported: ["fr", "en"] } })] };
```

```html
<!-- any template: import I18nKeylessTextComponent / I18nKeylessTranslatePipe in the component -->
<h1><i18n-t>Bonjour le monde</i18n-t></h1>   <input [placeholder]="'Votre email' | t" />
```

That is the whole setup: write your strings in your primary language, the SDK translates
them at runtime (once per string, then cached on the device). No keys, no JSON files. Get an
API key at [i18n-keyless.com](https://i18n-keyless.com/#get-api-key).

The Angular package wraps [`i18n-keyless-core`](../core) with the same feature set and the
same semantics as [`i18n-keyless-react`](../react): same storage keys (an app migrating from
React keeps its cache and its device id), same namespaces, same `context` / `replace` /
`forceTemporary` / `originLanguage` options, same SSR model. Angular >= 17.1, standalone APIs,
signals.

## Table of contents

- [Setup](#setup)
- [Three ways to translate](#three-ways-to-translate)
- [Switch language](#switch-language)
- [Per-translation options](#per-translation-options)
- [The service](#the-service)
- [SSR](#ssr)
- [Storage](#storage)
- [Change detection: why the pipe is impure](#change-detection-why-the-pipe-is-impure)
- [Differences from the React package](#differences-from-the-react-package)
- [Building and publishing](#building-and-publishing)

## Setup

`provideI18nKeyless(config)` returns `EnvironmentProviders`. Put it in `bootstrapApplication`
(or in `app.config.ts`). The config is the `init` config of `i18n-keyless-react`:

```ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideI18nKeyless } from "i18n-keyless-angular";

bootstrapApplication(AppComponent, {
  providers: [
    provideI18nKeyless({
      API_KEY: "YOUR_API_KEY",
      languages: {
        primary: "fr",           // the language your templates are written in
        supported: ["fr", "en"], // what the user can switch to
        fallback: "en",          // optional
      },
      // storage: window.localStorage  <- the browser default; see Storage below
      // onInit: (lang) => {}, onSetLanguage: (lang) => {}, defaultNamespace, debug, ssr,
      // API_URL, handleTranslate, getAllTranslations, sendTranslationsUsage
    }),
  ],
});
```

`init` runs when the injector is created, before the first component renders, and does not
block bootstrap: the app renders in the primary language and re-renders into the current
language as the cache (then the network) answers. Read `I18nKeylessService.hydrated()` or
await `whenHydrated()` if you need that moment (a splash screen, for instance).

## Three ways to translate

```ts
import { Component, inject } from "@angular/core";
import { I18nKeylessTextComponent, I18nKeylessTranslatePipe, I18nKeylessService } from "i18n-keyless-angular";

@Component({
  standalone: true,
  imports: [I18nKeylessTextComponent, I18nKeylessTranslatePipe],
  template: `
    <!-- 1. Component: the default. Re-renders on its own when the translation lands. -->
    <h1><i18n-t>Bonjour le monde</i18n-t></h1>

    <!-- 2. Pipe: where an element cannot go (attributes, <option>, <title>, a string). -->
    <input [placeholder]="'Votre email' | t" />
    <p>{{ "8 heures" | t: { context: "durée" } }}</p>

    <!-- 3. Service signal: a string computed in the class. -->
    <button>{{ label() }}</button>
  `,
})
export class HelloComponent {
  private readonly i18n = inject(I18nKeylessService);
  readonly label = this.i18n.translation("Envoyer");
}
```

`<i18n-t>` reads its projected text as the source (trimmed, so wrapped lines in a template
are fine). It keeps the source in a hidden `<span>` and renders the translation next to it:
that is what lets SSR hydration find the key again in the server HTML. A projected
interpolation (`<i18n-t>{{ user.firstName }}</i18n-t>`) is followed too.

For a one-shot string outside change detection (a route title resolver, a toast, a file
name), use `I18nKeylessService.getTranslation(text, options)` or the bare `getTranslation`
export. Both are plain, non-reactive reads: the value does not update when the language
changes.

## Switch language

```ts
readonly i18n = inject(I18nKeylessService);

this.i18n.currentLanguage();        // Signal<Lang>
this.i18n.setCurrentLanguage("en"); // persists it, fetches its translations, signals update
this.i18n.getSupportedLanguages();  // ["fr", "en"]
```

`AVAILABLE_LANGS` and the `Lang` type are re-exported; `resolveLang(navigator.language, {
supported, fallback })` maps a BCP-47 tag onto a supported language.

## Per-translation options

Inputs of `<i18n-t>` and the second argument of the pipe, `translate()`, `translation()` and
`getTranslation()`:

- `context`: disambiguates meaning. `<i18n-t context="heure">8 heures</i18n-t>` and
  `<i18n-t context="durée">8 heures</i18n-t>` are two translations, stored as `key__context`.
- `replace`: interpolation. The keys include the delimiters:
  `<i18n-t [replace]="{ '{name}': user.name }">{{ 'Bonjour {name}' }}</i18n-t>`.
  (Wrap a literal `{` in an interpolation: Angular reads a bare `{` as an ICU block.)
- `namespace`: a fetch/storage partition for large projects. `unpersistedNamespace`: memory only.
- `forceTemporary`: override the AI translation from code, per language.
- `originLanguage`: user generated content written in another language than the primary one.
- `debug`: logs the resolution of that one string.

## The service

`I18nKeylessService` is `providedIn: "root"`:

| Member | Type | Notes |
| --- | --- | --- |
| `currentLanguage` | `Signal<Lang>` | the request scope's language under SSR, else the store's |
| `translations` | `Signal<Translations>` | flat map for `currentLanguage` |
| `hydrated` | `Signal<boolean>` | true once storage has been read |
| `config` | `Signal<I18nConfig>` | |
| `currentLanguage$`, `translations$` | `Observable` | rxjs bridges (`toObservable`) |
| `translate(text, options)` | `string` | reactive: call it in a template, `computed` or `effect` |
| `translation(text, options)` | `Signal<string>` | `computed(() => translate(...))` |
| `getTranslation(text, options)` | `string` | one-shot, non-reactive |
| `setCurrentLanguage(lang)` | `Promise<void>` | |
| `whenHydrated()` | `Promise<void>` | |
| `clearStorageAndStore()` | `Promise<void>` | wipes the cache, keeps the device id |

The store behind it is module-scoped (one per process) and exported as `i18nKeylessStore`
(`currentLanguage`, `translations`, `config`, `hydrated` signals plus `getState()` /
`setState()`), for tests and advanced use.

## SSR

Two modes, as in the React package (see [`docs/SSR.md`](../../docs/SSR.md)):

1. **Primary-language SSR**: nothing to do. `provideI18nKeyless` works on the server
   (`storage` defaults to an in-memory adapter, `init` runs once per process, usage
   analytics are never sent from a server). The server renders the primary language and the
   client re-translates after hydration.
2. **Localized SSR**: render any language on the server, for indexable `?lang=xx` or
   `/{lang}/…` URLs. `provideI18nKeylessServer` is the counterpart of
   `<I18nKeylessProvider>`: `<i18n-t>`, the pipe and the service read its `{ lang, translations }`
   first and fall back to the store when it is absent.

```ts
// app.config.server.ts
import { inject, REQUEST } from "@angular/core";
import { provideI18nKeylessServer, getServerTranslations, resolveLang } from "i18n-keyless-angular";

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    // A factory runs in injection context as an APP_INITIALIZER: Angular waits for it.
    provideI18nKeylessServer(async () => {
      const url = new URL(inject(REQUEST)?.url ?? "http://localhost/");
      const lang = resolveLang(url.searchParams.get("lang"), { supported: ["fr", "en"], fallback: "fr" })!;
      return { lang, translations: await getServerTranslations(lang), primary: "fr" }; // cached per process
    }),
  ],
};
```

Hand the same `{ lang, translations }` to the client (`TransferState`, or a JSON script tag
you serialize) and provide it there too: in the browser `provideI18nKeylessServer` seeds the
store synchronously (`hydrateFromServer`), so the first client render matches the server HTML
and later reads agree with it. In provider mode the language is the scope's `lang`: drive it
from the URL, `setCurrentLanguage` is for SPA mode. `primary` (≥ 3.6.1) is the language the
source strings are written in: when the scope carries it, the resolution never reads the
store's primary, so a store that has not run `provideI18nKeyless` yet cannot make a request
in the real primary language look like a request for the source strings. Optional: it
defaults to the store's primary.

`runWithI18nKeyless({ lang, translations }, () => renderApplication(...))`, `getRequestScope()`
and `getUsedTranslationsSnapshot()` are exported as well, for the imperative `getTranslation`
path inside a server render (AsyncLocalStorage, Node >= 20.10).

Translate-on-miss never runs from `<i18n-t>` or the pipe on the server (a server render is
read-only, like `<I18nKeylessText>`); the imperative `getTranslation` still queues a miss,
outside Angular's zone so the response is never delayed by it.

## Storage

Browser default: `window.localStorage`. Server default: an in-memory adapter. Any object with
`getItem` / `setItem` / `removeItem` (sync or async) is a valid `storage`: `sessionStorage`,
an `idb-keyval` wrapper, Capacitor Preferences, Ionic Storage. The keys are the ones of the
React package (`i18n-keyless-translations`, `i18n-keyless-current-language`,
`i18n-keyless-user-id`, ...).

## Change detection: why the pipe is impure

A pure pipe is memoized by Angular on its input values, and `'Bonjour'` never changes; the
translation does (it lands asynchronously, the language switches). So `t` is `pure: false`:
its `transform` runs on every check of its template, where it reads the store signals. That
read is tracked by the template's reactive consumer, so a signal change marks the view for
refresh even under `OnPush` and under zoneless change detection, with no
`ChangeDetectorRef.markForCheck()` and no subscription. The cost per check is one map read
and a string compare; the side effects (translate-on-miss, usage) are memoized per
`(language, key)` in the pipe instance.

`<i18n-t>` is `OnPush` with a `computed` text; it only re-renders when its own string changes.
Signals also make both work without `zone.js` (`provideZonelessChangeDetection`).

## Differences from the React package

- `storage` is optional in the browser (defaults to `localStorage`); React throws.
- `I18nKeylessService.getTranslation` reads the DI request scope, which a plain function in
  React cannot; the bare `getTranslation` export behaves like React's (store, then ALS scope).
- Translate-on-miss and usage recording from `translate()` / the pipe are memoized per
  `(language, key)` for the life of the instance, where React's `<T>` fires once per mount.
- The `sdk` header says `angular-client` in a browser and `angular-server` on the server: the
  API bills a `*-server` label by its connection and every other label by its device id.

## Building and publishing

The package compiles with `ngc` from `@angular/compiler-cli` (a devDependency) in
`prepublishOnly`, with `angularCompilerOptions.compilationMode: "partial"` in
`tsconfig.json`. The published `dist` is therefore in Ivy *partial* format
(`ɵɵngDeclareComponent`), which is what an Angular CLI application built with AOT (the
default) links at build time: install from npm and `ng build` works as is.

Building from source: `rm -rf dist && npx ngc -p tsconfig.json` (after `i18n-keyless-core`).
A consumer that installs from a source checkout without that build has no `dist` in partial
format and needs JIT (`"aot": false` in `angular.json`).

Tests: `npx vitest run` (vitest + jsdom + Angular JIT; see `__tests__/setup.ts`).

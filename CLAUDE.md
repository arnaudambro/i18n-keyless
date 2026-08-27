# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

i18n-keyless is a translation library that eliminates manual key management. Developers write text in their primary language directly, and translations are handled automatically via AI-powered APIs. One wire protocol (`docs/PROTOCOL.md`), several SDKs: React and React Native, Node.js, Vue, Angular, a framework-free browser package (npm workspaces under `packages/`), plus a Laravel port and a Flutter port under `ports/`.

## Generated files — do not edit here

`llms.txt` at the root is **a mirror, not a source**. It is written by
`npm run docs:sync` in the *other* repository (`i18n-keyless-saas/docs`), whose
`static/llms.txt` decides the content. Edit it there; a `mirrors.test.ts` in that repo
fails the moment the two differ.

It lives here because this is the only public repository of the two: it is the copy
Context7 indexes (see `context7.json`) and the copy an agent reaches after cloning the SDK.

`skills/i18n-keyless/SKILL.md` **is** a source and is edited here. It is copied into
`packages/react/` and `packages/node/` by `prepublishOnly`, removed by `postpublish`, and
`packages/.gitignore` keeps the copies out of git. Its prose is held to the SDK by the
documentation suite in the other repository, so run that suite after changing it.

## Commands

Release procedure: `PUBLISH.md`, automated by `node scripts/publish.mjs [--dry-run]` (one shared version, `node scripts/set-version.mjs x.y.z`,
core `dist` built before `npm publish`, then pub.dev and the Packagist mirror).

```bash
# Build: there are no `build` npm scripts; build each package directly.
# core must build before every other package. Clean dist first, otherwise tsc errors with
# TS5055 ("would overwrite input file") because stale dist .d.ts files get picked up as input.
(cd packages/core    && rm -rf dist && npx tsc --project tsconfig.json)   # core first
(cd packages/react   && rm -rf dist && npx tsc --project tsconfig.json)   # then any of these
(cd packages/node    && rm -rf dist && npx tsc --project tsconfig.json)
(cd packages/vue     && rm -rf dist && npx tsc --project tsconfig.json)
(cd packages/browser && rm -rf dist && npx tsc --project tsconfig.json)
(cd packages/angular && rm -rf dist && npx ngc -p tsconfig.json)          # ngc: Ivy partial, AOT-ready

# Test: every npm package has a real vitest suite. `.npmrc` sets workspaces=true, so a bare
# `npm run test` from the root fans out to core, react, node, vue, angular and browser, and
# exits non-zero if any one of them fails. Run a single package with
# `cd packages/<pkg> && npx vitest run`.
npm run test               # Single run, every npm package
npm run test:watch         # Watch mode
npm run test:coverage      # With V8 coverage
(cd packages/vue     && npx vitest run)   # happy-dom
(cd packages/angular && npx vitest run)   # jsdom + Angular JIT
(cd packages/browser && npx vitest run)   # happy-dom

# The ports are not npm workspaces: test them with their own toolchains.
(cd ports/laravel && composer install && vendor/bin/phpunit)   # PHP >= 8.2, Composer
(cd ports/flutter && flutter test)                              # Flutter >= 3.27
```

The npm packages build with `tsc` directly (no bundler), except `packages/angular`, which
builds with `ngc` from `@angular/compiler-cli` (a devDependency) so the published `dist` is
in Ivy partial format and AOT-ready. Output goes to `dist/` in each package. The build
invocation lives in each package's `prepublishOnly` script: there is no standalone `build`
script.

NOTE: the root `.npmrc` sets `workspaces=true`, so a bare `npm run <script>` from the repo
root runs that script in **every** workspace (and fails on any workspace missing it). That
is why `npm run test` works (it fans out to all three real suites) but there is no usable
root `npm run build` (no package defines the `build:lib` script the root scripts call). To
target one package use `cd packages/<pkg>` as shown above.

## Package Structure

Monorepo with npm workspaces (`packages/*`). Every npm package depends on core:

```
packages/core     → i18n-keyless-core     (zero deps, pure TypeScript)
packages/react    → i18n-keyless-react    (depends on core + zustand, peer: react>=18)
packages/node     → i18n-keyless-node     (depends on core)
packages/vue      → i18n-keyless-vue      (depends on core, peer: vue>=3.3)
packages/angular  → i18n-keyless-angular  (depends on core, peer: @angular/core>=17.1; built with ngc)
packages/browser  → i18n-keyless-browser  (depends on core; plus the <i18n-t> web component and the ./auto script-tag entry)
packages/web-component                    (experimental/WIP, superseded by packages/browser)

ports/laravel     → i18n-keyless/laravel  (Composer, PHPUnit; not an npm workspace)
ports/flutter     → i18n_keyless          (pub.dev, flutter test; not an npm workspace)
```

The ports under `ports/` are rewrites of the protocol in another language, not wrappers of
core. They are not npm workspaces, so the root `npm run test` never reaches them: test them
with `cd ports/laravel && vendor/bin/phpunit` and `cd ports/flutter && flutter test`. Both
replay the shared conformance vectors from `conformance/vectors/`.

All packages and ports share the same version (currently in root `package.json`). When bumping versions, update root + every `packages/*/package.json` (core, react, node, vue, angular, browser) + the `i18n-keyless-core` dependency references in react, node, vue, angular and browser + the ports: `version` in `ports/flutter/pubspec.yaml`, the `Version` header constants the two ports send (`VERSION` in `ports/laravel/src/ApiClient.php`, `ports/flutter/lib/src/core/version.dart`), and `ports/laravel/composer.json` if it ever declares a `version` (today it does not: Packagist reads the git tag of the mirror repository).

## Architecture

### Translation Flow

Text goes through this pipeline:

1. **Lookup**: `getTranslationCore()` checks the local store for existing translation
2. **Queue**: If missing, `translateKey()` adds to a priority queue (max 30 concurrent, deduplicates by key)
3. **API**: Queue workers POST to `/translate` endpoint
4. **Bulk fetch**: When queue empties, `getAllTranslationsFromLanguage()` fetches all translations for the current language
5. **Store update**: Zustand store updates → React components re-render

### Key Files

- `core/service.ts` — Translation engine: `getTranslationCore`, `translateKey`, `getAllTranslationsFromLanguage`, `sendTranslationsUsageToI18nKeyless`
- `core/my-pqueue.ts` — Custom priority queue (lightweight p-queue replacement)
- `core/types.ts` — All shared types (`Lang`, `Translations`, `TranslationOptions`, API request/response types)
- `react/store.ts` — Zustand store, `init()`, `setCurrentLanguage`, hydration logic
- `react/I18nKeylessText.tsx` — The `<T>` / `<I18nKeylessText>` component
- `react/utils.ts` — Storage adapter (supports localStorage, AsyncStorage, MMKV, etc.)
- `node/service.ts` — Node-specific init and `awaitForTranslationOrThrow` / `awaitForTranslationOrFallbackToOriginal` (`awaitForTranslation` is a deprecated alias of `awaitForTranslationOrThrow`), with Proxy-based error enforcement on the `OrThrow` variant

### SSR / Server Rendering

See `docs/SSR.md` for the full reference. Key points: the translate-on-miss design is
SSR-safe; usage POSTs fire once per `init`, so SSR is *less* traffic than SPA on a
long-lived server (no "spam"). SSR support is **implemented**: (1) `dist` emits explicit
`.js` import extensions (valid native Node ESM), (2) `init` defaults to an in-memory
storage (`createMemoryStorage`) on the server, (3) usage analytics are suppressed on the
server / under `ssr: true`, (4) `<I18nKeylessProvider lang translations>` +
`getServerTranslations(lang)` render per-request non-primary HTML. `<T>` reads provider
context first and falls back to the store, so SPA mode is unchanged (non-breaking).

### Protocol and conformance

`docs/PROTOCOL.md` is the language-neutral wire protocol every SDK and port implements
(headers, endpoints, retry, queue, ETag, usage analytics, identity, storage keys, the 48
codes), verified against the API source. `conformance/vectors/*.json` are its executable
half: `packages/core/__tests__/conformance.test.ts` replays them against the pure helpers
core exports for that purpose (`storageKeyFor`, `queueIdFor`, `applyReplace`,
`buildDictionaryUrl`, `etagCacheKey`, `resolveSdkRuntime`, `isServerRuntime`,
`isRetryableStatus`, ...), and the Laravel and Flutter suites replay the same files. A
behaviour change in core is a change to the vectors, the spec and every port together;
`docs/PORT_CHECKLIST.md` lists what a new port must ship.

The `sdk` header names the runtime: `react-client` / `react-server`, `vue-client` /
`vue-server`, `angular-client` / `angular-server`, `browser`, `node`, and `laravel` /
`flutter` for the ports. Rule (`isServerRuntime`): `node`, `laravel` and every `*-server`
label are servers (no `unique_id`, counted by connection); everything else is a device.

### Translation Key Format

Keys with context are stored as `"key__context"` in the translations map. The `context` option disambiguates translations (e.g., "8 heures" → time vs duration).

### Storage Adapter Pattern

The react package uses a flexible storage adapter that normalizes different storage APIs (localStorage's `getItem`/`setItem`, MMKV's `getString`/`set`, AsyncStorage's async `getItem`). See `utils.ts` for the method resolution logic.

### Three API Configuration Modes (priority order)

1. Custom handler functions (`handleTranslate`, `getAllTranslations`, `sendTranslationsUsage`)
2. Self-hosted backend (`API_URL`)
3. Official service (`API_KEY` with default `https://api.i18n-keyless.com`)

## Testing

Every npm package has a Vitest suite, and every one runs it in `prepublishOnly`. The
react package uses the happy-dom environment and `@testing-library/react`, with zustand
mocked in `__tests__/setup.ts`; vue and browser use happy-dom; angular uses jsdom with
Angular JIT (`__tests__/setup.ts`); core and node run in the default node environment.
The Laravel port runs PHPUnit on Orchestra Testbench with `Http::fake()`; the Flutter port
runs `flutter test` with a `MockClient`. Neither needs a network or a key.

A stale assertion in core survived a whole release because only react ran its tests on
publish — so keep the root `npm run test` green, not just the package you touched.

## Type System

`Lang` is a union of 48 language codes (`AVAILABLE_LANGS` in `core/types.ts`). Since v3 any of them can be a project's primary language — `PrimaryLang` is no longer `"fr" | "en"`. v2 spelled Chinese `cn` and Czech `cz`; v3 spells them `zh-Hans` and `cs`, and the API answers each client in its own dialect based on the `Version` header the SDK sends. The `replace` option in `TranslationOptions` does regex-safe string replacement on translated text.

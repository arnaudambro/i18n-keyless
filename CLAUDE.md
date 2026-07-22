# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

i18n-keyless is a translation library that eliminates manual key management. Developers write text in their primary language directly, and translations are handled automatically via AI-powered APIs. The library supports React (browser), Node.js, and an experimental web component.

## Commands

```bash
# Build — there are no `build` npm scripts; build each package with tsc directly.
# core must build before react. Clean dist first, otherwise tsc errors with TS5055
# ("would overwrite input file") because stale dist .d.ts files get picked up as input.
(cd packages/core  && rm -rf dist && npx tsc --project tsconfig.json)   # core first
(cd packages/react && rm -rf dist && npx tsc --project tsconfig.json)   # then react

# Test (only the react package has real tests)
npm run test               # Single run
npm run test:watch         # Watch mode
npm run test:coverage      # With V8 coverage
```

Build uses `tsc` directly (no bundler). Output goes to `dist/` in each package. The
`tsc` invocation lives in each package's `prepublishOnly` script — there is no standalone
`build` script.

NOTE: the root `.npmrc` sets `workspaces=true`, so a bare `npm run <script>` from the repo
root runs that script in **every** workspace (and fails on any workspace missing it). That
is why `npm run test` works (it fans out; core/node just echo) but there is no usable root
`npm run build`. To target one package use `cd packages/<pkg>` as shown above.

## Package Structure

Monorepo with npm workspaces. Three packages with a dependency chain:

```
packages/core   → i18n-keyless-core    (zero deps, pure TypeScript)
packages/react  → i18n-keyless-react   (depends on core + zustand, peer: react>=18)
packages/node   → i18n-keyless-node    (depends on core)
packages/web-component                  (experimental/WIP)
```

All packages share the same version (currently in root `package.json`). When bumping versions, update root + all three package.json files + the dependency references in react and node packages.

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
- `node/service.ts` — Node-specific init and `awaitForTranslation` with Proxy-based error enforcement

### SSR / Server Rendering

See `docs/SSR.md` for the full reference. Key points: the translate-on-miss design is
SSR-safe; usage POSTs fire once per `init`, so SSR is *less* traffic than SPA on a
long-lived server (no "spam"). SSR support is **implemented**: (1) `dist` emits explicit
`.js` import extensions (valid native Node ESM), (2) `init` defaults to an in-memory
storage (`createMemoryStorage`) on the server, (3) usage analytics are suppressed on the
server / under `ssr: true`, (4) `<I18nKeylessProvider lang translations>` +
`getServerTranslations(lang)` render per-request non-primary HTML. `<T>` reads provider
context first and falls back to the store, so SPA mode is unchanged (non-breaking).

### Translation Key Format

Keys with context are stored as `"key__context"` in the translations map. The `context` option disambiguates translations (e.g., "8 heures" → time vs duration).

### Storage Adapter Pattern

The react package uses a flexible storage adapter that normalizes different storage APIs (localStorage's `getItem`/`setItem`, MMKV's `getString`/`set`, AsyncStorage's async `getItem`). See `utils.ts` for the method resolution logic.

### Three API Configuration Modes (priority order)

1. Custom handler functions (`handleTranslate`, `getAllTranslations`, `sendTranslationsUsage`)
2. Self-hosted backend (`API_URL`)
3. Official service (`API_KEY` with default `https://api.i18n-keyless.com`)

## Testing

Tests use Vitest with happy-dom environment and `@testing-library/react`. Zustand is mocked in `__tests__/setup.ts`. Only the react package has tests — core and node have no test suites.

## Type System

`Lang` is a union of 19 language codes. `PrimaryLang` is restricted to `"fr" | "en"`. The `replace` option in `TranslationOptions` does regex-safe string replacement on translated text.

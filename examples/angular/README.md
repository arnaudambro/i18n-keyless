# i18n-keyless · Angular (SPA)

The Angular counterpart of [`vite-react`](../vite-react): a single-page app, no SSR. Shows
the core of `i18n-keyless-angular`:

- `provideI18nKeyless()` in the root providers, `localStorage` by default ([`src/i18n.ts`](./src/i18n.ts))
- the `<i18n-t>` component ([`src/pages/home.component.ts`](./src/pages/home.component.ts))
- the `t` pipe, the service's `translation()` signal and the `context` option: the canonical
  `8 heures` → "8 AM" / "8 hours" example ([`src/pages/about.component.ts`](./src/pages/about.component.ts))
- the `replace` option (Home)
- a language switcher with `I18nKeylessService.currentLanguage()` / `setCurrentLanguage()`
  ([`src/components/language-switcher.component.ts`](./src/components/language-switcher.component.ts))
- two pages, so you can see navigation stay translated

Primary language is **`fr`**: you write your strings in French and i18n-keyless translates
them to `en`/`es` (and any other supported language).

## Create the workspace

This folder holds the source files only (no `angular.json`), so you generate the workspace
with the Angular CLI and copy them in:

```bash
npx @angular/cli@20 new i18n-keyless-angular-demo --standalone --style=css --routing=false --ssr=false --skip-tests
cd i18n-keyless-angular-demo
cp -r ../examples/angular/src/* src/            # app, pages, components, i18n, styles
cp ../examples/angular/index.html src/index.html
npm install file:../packages/angular file:../packages/core
```

The library is consumed from source here, so build it once before `ng serve`:
`(cd ../packages/core && rm -rf dist && npx tsc -p tsconfig.json)` then
`(cd ../packages/angular && rm -rf dist && npx ngc -p tsconfig.json)`. `ngc` emits the Ivy
partial format the default AOT build links; a source checkout without that build needs JIT
(`"aot": false` under `projects.<name>.architect.build.options` in `angular.json`). The
published npm package is AOT-ready as is (see
[the package README](../../packages/angular/README.md#building-and-publishing)).

## Run (real service)

1. Get an API key at [i18n-keyless.com](https://i18n-keyless.com), then put it in
   [`src/environment.ts`](./src/environment.ts) (`I18N_KEYLESS_API_KEY`).
2. `npm run dev` (that is `ng serve`).

That's the real-life setup: the app calls the live i18n-keyless service, which translates
your French strings on demand (once per string, then cached).

## Run (offline, no key)

Leave `I18N_KEYLESS_API_KEY` empty and start the bundled mock backend instead:

```bash
cd ../_mock-server && node server.mjs    # http://localhost:8787, in another terminal
npm run dev                              # in the workspace
```

## Test

This example has no test suite of its own yet: the component, the pipe, the service and the
SSR provider are covered by the library's suite (`cd packages/angular && npx vitest run`).

## Notes

- The example consumes the library via **`file:../../packages/*`**, so it builds against the
  local source. To pin a published version instead, set `"i18n-keyless-angular": "^3.3.0"`
  (and remove the core `file:` entry).
- Add languages in `SUPPORTED_LANGUAGES` (`src/i18n.ts`): the real service translates them
  automatically; for the offline mock, also add them to `examples/_mock-server/fixtures.json`.
- `<i18n-t>` keeps its source text in a hidden `<span>` next to the rendered translation.
  That is what lets Angular SSR hydration find the key again in the server HTML.

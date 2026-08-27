# i18n-keyless browser example (no framework)

One HTML file, no build step for the page: the whole integration is the `auto` script tag of
[`i18n-keyless-browser`](../../packages/browser). It demonstrates the same feature set as the
other examples:

- `init()` through the `data-*` attributes of the script tag, plus a **language switcher**
  (`i18nKeyless.setCurrentLanguage`)
- text via **three** paths: the `data-i18n` attribute, the `<i18n-t>` web component, and the
  `watchTranslation` JS API
- the `replace` and `context` options

Primary language is **`fr`**: the strings are written in French and translated to `en` / `es`.

## Run it

The page loads the SDK from `/packages/browser/dist/auto.js`, so the package must be built
once (there is no bundler: `tsc` writes `dist/`; `i18n-keyless-core` must be built first, see
the root `CLAUDE.md`):

```bash
npm run build     # builds packages/browser/dist with tsc
npm run dev       # http://localhost:5173/examples/browser/
```

`serve.mjs` is a dependency-free static server rooted at the repo root, because a module
script cannot be loaded from `file://`. The page also carries an import map that points the
bare `i18n-keyless-core` specifier at `/packages/core/dist/index.js`: a CDN such as esm.sh
does that for you, a local build does not.

### Offline mode (no API key)

`index.html` points `data-api-url` at the bundled mock backend with a dummy key. Start it
in another terminal:

```bash
cd examples/_mock-server && node server.mjs   # http://localhost:8787
```

See [`_mock-server`](../_mock-server) for what it serves.

### Real service

Remove `data-api-url` from the script tag and set your real `data-api-key` (get one at
https://i18n-keyless.com). The service then translates every string on demand, once, and
caches it.

## What to look at

- the `<script type="module" src=".../auto.js" data-api-key data-primary data-supported data-lang>`
  tag in `<head>`: every attribute is documented in the package README
- `<p data-i18n>`: the element text is the source, the whole text is replaced
- `<i18n-t context="heure">8 heures</i18n-t>` vs `<i18n-t context="durée">`: two translations
  for one source
- the inline module at the bottom: `watchTranslation` with `replace`, re-bound on language
  change through `subscribe`

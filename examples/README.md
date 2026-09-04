# i18n-keyless examples

Runnable example apps showing i18n-keyless in each major framework. Every app demonstrates
the same feature set so you can compare integrations side by side:

- `init()` + a **language switcher** (`useCurrentLanguage` / `setCurrentLanguage`)
- text via **both** paths: the `<I18nKeylessText>` (`<T>`) component **and** the
  `getTranslation(key)` function
- the `replace` and `context` options
- **two pages**, so you can see client-side navigation stay translated
- for SSR apps: server-rendered translated HTML (`?lang=en`) and flash-free hydration
  (per-framework wiring — see each app's README for the exact mechanism)

## Examples

| Example | Framework | Mode | Demonstrates |
|---|---|---|---|
| [`vite-react`](./vite-react) | Vite + React | SPA | the baseline: init, storage, `<T>`, `getTranslation`, switcher |
| [`tanstack-start`](./tanstack-start) | TanStack Start | SSR + SPA | both paths: `<I18nKeylessProvider>` (component) via root loader + `runWithI18nKeyless` (function path in loaders/`head()`) |
| [`remix-rr7`](./remix-rr7) | Remix / React Router 7 | SSR | same SSR pattern in `entry.server`/`entry.client` |
| [`nextjs`](./nextjs) | Next.js (App Router) | SSR | client-boundary pattern (`<I18nKeylessProvider>` + `hydrateFromServer`) |
| [`astro`](./astro) | Astro + React islands | SSR | island + `<I18nKeylessProvider>` (serialized props) |
| [`react-native`](./react-native) | React Native (CLI) | native | MMKV / AsyncStorage adapter |
| [`expo`](./expo) | Expo Router | native | Expo storage + router |
| [`node`](./node) | Node.js (no React) | server | `i18n-keyless-node` + `awaitForTranslationOrFallbackToOriginal` |
| [`vue-vite`](./vue-vite) | Vite + Vue 3 | SPA | `i18n-keyless-vue`: the `I18nKeyless` plugin, `<T>`, `t()` from `useI18nKeyless()`, switcher |
| [`angular`](./angular) | Angular (standalone, signals) | SPA | `i18n-keyless-angular`: `provideI18nKeyless()`, `<i18n-t>`, the `t` pipe, `translation()` signal (source files only: generate the workspace with the CLI) |
| [`browser`](./browser) | plain HTML, no framework | script tag | `i18n-keyless-browser`: the `auto` script tag, `data-i18n`, `<i18n-t>`, `watchTranslation` |
| [`laravel`](./laravel) | Laravel | server (PHP) | `i18n-keyless/laravel`: `__()` unchanged, `i18nk()` with `context`, five commands against the mock backend |
| [`rails`](./rails) | Ruby on Rails | server (Ruby) | `i18n-keyless-rails`: `t('source string')`, `i18nk()` with `context`, five commands against the mock backend |
| [`python`](./python) | Python (`http.server`, no framework) | server (Python) | `i18n-keyless`: `init()`, `t()` in a handler, `context`, `replace`, a `?lang=` switcher, against the mock backend |
| [`go`](./go) | Go (`net/http`, `html/template`) | server (Go) | the Go module: `Init()`, `T()` in a template func map, `WithContext`, `WithReplace`, a `?lang=` switcher via `ResolveLang`, against the mock backend |
| [`swift`](./swift) | SwiftUI (two screens) + a CLI target | native (Swift) | `I18nKeyless`: `configure`, `I18nKeylessText`, `t()` with `context` and `replace`, a language picker; the CLI runs the same store headless against the mock backend |
| [`kotlin`](./kotlin) | Kotlin (JVM, `com.sun.net.httpserver`) | server (Kotlin) | `i18n-keyless-kotlin`: one client per language with `server = true`, `t()` with `context` and `replace`, a `?lang=` switcher via `resolveLang`, against the mock backend |

Primary language is **`fr`** across all examples — you write strings in French and
i18n-keyless translates them to `en`/`es` (and any other supported language).

## Running any example (real service)

```bash
cd examples/<name>
cp .env.example .env     # add your API key (get one at https://i18n-keyless.com)
npm install
npm run dev
```

This is the real-life setup: the app talks to the live i18n-keyless service, which
translates your strings on demand (once per string, then cached). `npm test` for tests.

### Offline mode (no API key)

Each example also runs without a key against a tiny bundled mock backend — handy for
trying it out, CI, or screenshots. Leave the API key empty and:

```bash
cd examples/_mock-server && node server.mjs   # http://localhost:8787, in another terminal
```

See [`_mock-server`](./_mock-server) for what it does.

## Consuming the library

The examples reference the packages via **`file:../../packages/*`**, so they always build
against the local source in this repo (no publish step needed). To pin a published version
instead, set e.g. `"i18n-keyless-react": "^2.3.2"` in the example's `package.json` (≥ 2.3.2
is required for correct TanStack Start / Vite SSR — see the tanstack-start README).

## Automated tests

**Every example has a passing test suite** (`npm test`), each run against the local library
build via `file:../../packages/*`:

| Example | Runner | Tests | Notably checks |
|---|---|---|---|
| vite-react | Vitest | 3 | component + function paths, switcher |
| tanstack-start | Vitest | 3 | **both SSR paths**: provider component path + ALS function path render English |
| remix-rr7 | Vitest | 2 | same SSR assertion |
| nextjs | Vitest | 2 | `<T>` via provider, `getTranslation` after seed |
| astro | Vitest | 2 | island provider + `getTranslation` |
| node | Vitest | 2 | `awaitForTranslationOrFallbackToOriginal` renders translated HTML |
| react-native | Jest (RN preset) | 2 | translation + `context` in the RN runtime |
| expo | Jest (jest-expo) | 3 | translation + `context` + primary fallback |
| vue-vite | (library suite) | | `cd packages/vue && npx vitest run` covers the plugin, `<T>`, `t()` and SSR |
| angular | (library suite) | | `cd packages/angular && npx vitest run` covers the component, the pipe, the service and the SSR provider |
| browser | (library suite) | | `cd packages/browser && npx vitest run` covers the store, `data-i18n`, `<i18n-t>` and the `auto` entry |
| laravel | (port suite) | | `cd ports/laravel && vendor/bin/phpunit`; the example itself is a throwaway app driven by `artisan tinker` |
| rails | (port suite) | | `cd ports/rails && bundle exec rake test`; the example itself is a throwaway app driven by `rails runner` |
| python | pytest (uv) | 4 | `cd examples/python && uv run pytest`: both pages, `context`, `replace`, the switcher, against a stubbed API |
| go | `go test` | | `cd examples/go && go test ./...`: both pages against an in-process `httptest` stand-in for the mock server |
| swift | XCTest | | `cd examples/swift && swift test`; `swift run` drives the CLI against the mock backend |
| kotlin | JUnit 5 (Gradle) | 6 | `cd examples/kotlin && ./gradlew test`: HTML in three languages, `?lang=en-US`, one POST per missing string, `kotlin-server` headers |

Notes:
- The web/Vitest configs `dedupe` React and inline the linked lib + zustand so the
  symlinked `file:` package shares one React instance.
- **react-native / expo** install with `npm install --legacy-peer-deps` (Expo/RN's strict
  peer matrix), pin React 18.3, and their tests assert the translation **logic** in the
  native runtime — the visual `<I18nKeylessText>` render is the same component the web
  examples cover, so it isn't re-rendered through `react-test-renderer`.
- **browser** has no bundler: `npm run build` runs `tsc` on `packages/browser` (build
  `packages/core` first) and `npm run dev` serves the repo root, because a module script
  cannot load from `file://`.
- **laravel** is a Composer package, not an npm workspace: the example README creates a
  throwaway Laravel app next to it with `composer create-project` and requires the port by
  path. **rails** is a RubyGem: the example README creates a throwaway Rails app with
  `rails new` and adds the gem by path. The Flutter port carries its own example in
  `ports/flutter/example`.

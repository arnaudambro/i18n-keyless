# i18n-keyless - Ultimate DX for i18n implementation. No key, use your natural language.

> **Version 3.8.1** — September 2026

Welcome to **i18n-keyless**! 🚀 This package provides a seamless way to handle translations without the need for cumbersome key management. This README will guide you through the setup and usage of the library.

[Try it by yourself in this Stackblitz](https://stackblitz.com/edit/vitejs-vite-ttaib9fx?file=src%2FApp.tsx)

**The short version, for anyone evaluating it:**

- **Open.** Every SDK in this repository is MIT. The server behind i18n-keyless.com — API, dashboard, MCP server — is public under the Elastic License 2.0 ([ambroselli-io/i18n-keyless-server](https://github.com/ambroselli-io/i18n-keyless-server)) and runs as one Docker image on your own machine: [self-hosting](#-self-hosting-the-server). The wire protocol is [documented](./docs/PROTOCOL.md).
- **Price.** Hosted: one flat price per project per month, by monthly active users, from €4 ([pricing](https://i18n-keyless.com/#pricing)). Self-hosted: free for one project, €30 once for unlimited ([details](https://i18n-keyless.com/self-hosted)). Your own AI key in both cases.
- **Your data.** One "Export JSON" click in the dashboard downloads every translation of a project.
- **Plurals.** All CLDR plural categories for every language (Russian 4 forms, Arabic 6, Polish 4), ordinals and gender/select — the model writes the branches, validated against `Intl.PluralRules`. [Plurals and genders](https://docs.i18n-keyless.com/docs/guides/plurals-and-genders).
- **Offline.** Users see the source language instead of a broken key. Or [export a precompiled bundle](https://docs.i18n-keyless.com/docs/guides/precompiled-bundle) at build time: no API call, no network dependency.
- **Scope.** AI translation, with a manual override in the dashboard that the AI never rewrites, and a per-cell "reviewed" mark. Read [what it does not do](#-what-i18n-keyless-does-not-do) before choosing.
- **Compared** with Crowdin, Lokalise, Phrase, Tolgee and i18next, prices dated: [the comparison](https://docs.i18n-keyless.com/docs/comparison). The [FAQ](https://docs.i18n-keyless.com/docs/faq) has the rest.

---

## 📜 **Table of Contents**

- [Using an AI coding agent?](#-using-an-ai-coding-agent)
- [How it works](#-how-it-works)
- [Every package and port](#-every-package-and-port)
- [Documentation](#-documentation)
- [Protocol and ports](#-protocol-and-ports)
- [Self-hosting the server](#-self-hosting-the-server)
- [What i18n-keyless does not do](#-what-i18n-keyless-does-not-do)
- [Common objections](#-common-objections)
- [What pains does it solve?](#-what-pains-does-it-solve)
- [Contact](#-contact)
- [License](#-license)

---

## 🤖 **Using an AI coding agent?**

i18n-keyless is built to be installed by an agent in one step. Point yours at whichever of
these fits your tool:

| What | Where | For |
| --- | --- | --- |
| **Agent Skill** | [`skills/i18n-keyless/SKILL.md`](./skills/i18n-keyless/SKILL.md) | Claude Code, Claude.ai, and any tool that reads `SKILL.md`. Copy the folder into `.claude/skills/` of your project. |
| **llms.txt** | [`llms.txt`](./llms.txt), also served at [docs.i18n-keyless.com/llms.txt](https://docs.i18n-keyless.com/llms.txt) | The whole documentation as one pasteable Markdown file — Cursor, ChatGPT, Windsurf, Copilot. |
| **Context7** | `use context7` in your prompt | Live docs injected into the context window through the Context7 MCP server. |
| **MCP server** | `claude mcp add --transport http i18n-keyless https://app.i18n-keyless.com/mcp` | Your agent operates the project: list missing translations, fix one, change languages, create a project. OAuth, no key to paste. [Guide](https://docs.i18n-keyless.com/docs/guides/mcp). |

The skill is short on purpose: install, initialise, the two ways to render a string, the
per-translation options, the SSR traps, and the gotchas. It links to `llms.txt` for the rest.

---

## 😎 **How it works**

First, you should read the [What pains does it solve?](#-what-pains-does-it-solve) section to understand the pains you have with the current i18n solutions.

i18n-keyless is a library, combined with an API service (I [provide one](https://i18n-keyless.com), you can [run the same server yourself](#-self-hosting-the-server) — its source is public — or [use your own](https://docs.i18n-keyless.com/docs/guides/custom-api)) that allows you to translate your text without the need to use keys.

By calling `I18nKeyless.init` you initialize an object that will be used to translate your text.
If your primary language is `en` and the user's language is `fr`, the object would look like this:

```javascript
{
   "Hello!": "Bonjour !",
   "Welcome to our website": "Bienvenue sur notre site web",
   ...
}
```

If the user's language is `en`, i18n-keyless won't use such an object and will use the default translations.

If the translation is not found, there will be an asynchronous fetch to I18nKeyless' API (or your own if you prefer) to get the translation by an AI API call.
Then the translation is returned and stored in the object.
This operation is only made once ever per key, for all the users all over the world.
The operation can be made in dev mode if you encounter that key, but it can also be made in production if the key is dynamic.

At the first opening of the app ever in a new language, there is an API call to the server where all your translations are stored.
Then it stores all those translations in the object and the storage you provide (localStorage, AsyncStorage, MMKV, etc.).
No translations are stored in the app initially.

At each opening of the app, the newest translations are fetched from the storage and the object is updated.

## 🧩 **Examples**

Runnable example apps for every major framework live in [`examples/`](./examples) — each a
two-page app showing `init`, the `<I18nKeylessText>` (`<T>`) component, the
`getTranslation()` function, `context`, `replace`, and a language switcher. The SSR ones
also show `getServerTranslations` + `runWithI18nKeyless` + `getUsedTranslationsSnapshot` +
`hydrateFromServer`.

| Example | Mode | | Example | Mode |
|---|---|---|---|---|
| [vite-react](./examples/vite-react) | SPA | | [astro](./examples/astro) | SSR (islands) |
| [tanstack-start](./examples/tanstack-start) | SSR | | [react-native](./examples/react-native) | native |
| [remix-rr7](./examples/remix-rr7) | SSR | | [expo](./examples/expo) | native |
| [nextjs](./examples/nextjs) | SSR | | [node](./examples/node) | server |
| [vue-vite](./examples/vue-vite) | SPA (Vue) | | [angular](./examples/angular) | SPA (Angular) |
| [browser](./examples/browser) | script tag, no framework | | [laravel](./examples/laravel) | server (PHP) |
| [rails](./examples/rails) | server (Ruby) | | | |

See [`examples/README.md`](./examples/README.md) to run them (real service via an API key, or
offline against the bundled mock backend). Primary language is `fr` throughout.

## 📦 **Every package and port**

One protocol, one dashboard, one API key. Pick the package for your stack; each README is
the full reference for that package.

| Target | Package | Install | README |
| --- | --- | --- | --- |
| React, React Native, Expo, Next.js, Remix, TanStack Start, Astro | `i18n-keyless-react` | `npm install i18n-keyless-react` | [packages/react](./packages/react/README.md) |
| Node.js backend (emails, push, cron) | `i18n-keyless-node` | `npm install i18n-keyless-node` | [packages/node](./packages/node/README.md) |
| Vue 3, Nuxt, Vite SSR | `i18n-keyless-vue` | `npm install i18n-keyless-vue` | [packages/vue](./packages/vue/README.md) |
| Angular >= 17.1 (standalone, signals, Angular SSR) | `i18n-keyless-angular` | `npm install i18n-keyless-angular` | [packages/angular](./packages/angular/README.md) |
| Plain HTML, Svelte, Alpine, htmx, jQuery, legacy sites | `i18n-keyless-browser` | `npm install i18n-keyless-browser`, or one script tag | [packages/browser](./packages/browser/README.md) |
| Laravel 11, 12, 13 | `i18n-keyless/laravel` (Composer) | `composer require i18n-keyless/laravel` | [ports/laravel](./ports/laravel/README.md) |
| Ruby on Rails 7, 8 | `i18n-keyless-rails` (RubyGems) | `bundle add i18n-keyless-rails` | [ports/rails](./ports/rails/README.md) |
| Flutter, Dart | `i18n_keyless` (pub.dev) | `flutter pub add i18n_keyless` | [ports/flutter](./ports/flutter/README.md) |
| Python >= 3.9: Django, Flask, FastAPI, scripts | `i18n-keyless` (PyPI) | `pip install i18n-keyless` | [ports/python](./ports/python/README.md) |
| Go >= 1.21: net/http, Gin, templates, CLIs | `github.com/arnaudambro/i18n-keyless/ports/go/v3` | `go get github.com/arnaudambro/i18n-keyless/ports/go/v3` | [ports/go](./ports/go/README.md) |
| Swift: iOS, macOS, SwiftUI, UIKit, Vapor | `I18nKeyless` (SwiftPM) | `.package(url: "https://github.com/arnaudambro/i18n-keyless-swift.git", from: "3.8.1")` | [ports/swift](./ports/swift/README.md) |
| Kotlin: Android, Compose, JVM, Ktor, Spring | `io.github.arnaudambro:i18n-keyless-kotlin` (Maven Central) | `implementation("io.github.arnaudambro:i18n-keyless-kotlin:3.8.1")` | [ports/kotlin](./ports/kotlin/README.md) |
| Any stack, shared engine | `i18n-keyless-core` | `npm install i18n-keyless-core` | [packages/core](./packages/core), [docs/PROTOCOL.md](./docs/PROTOCOL.md) |

---

## 📖 **Documentation**

Full documentation — installation, quick starts, usage guides, SSR, namespaces, plurals,
user-generated content, supported languages, custom API setup, and more:

**[docs.i18n-keyless.com](https://docs.i18n-keyless.com)**

---

## 🔌 **Protocol and ports**

Every package and port speaks the same wire protocol to the same API, so a project can mix
them (a Laravel, Rails, Python or Go backend and a Vue front end, a Flutter, Swift or Kotlin app
and a Node cron) on one API key
and one dashboard, and an app migrating from one package to another keeps its cache and its
device id.

- [`docs/PROTOCOL.md`](./docs/PROTOCOL.md): the language-neutral specification. Endpoints,
  headers, timeout and retry, the `key__context` storage format, the queue, ETag replay,
  usage analytics, identity (`sdk` and `unique_id`), the 48 language codes. Verified against
  the API source.
- [`conformance/`](./conformance): JSON test vectors that every SDK replays. The TypeScript
  core and the Laravel, Rails, Flutter, Python, Go, Swift and Kotlin ports run them in their
  test suites.
- [`docs/PORT_CHECKLIST.md`](./docs/PORT_CHECKLIST.md): what a new port must ship before it
  is called conformant.

Runtime labels sent in the `sdk` header: `react-client` / `react-server`, `vue-client` /
`vue-server`, `angular-client` / `angular-server`, `swift-client` / `swift-server`,
`kotlin-client` / `kotlin-server`, `browser`, `node`, `laravel`, `rails`, `flutter`, `python`,
`go`. A `*-server` label, `node`, `laravel`, `rails`, `python` and `go` are servers (counted
by connection, no device id); everything else is a device.

---

## 🏠 **Self-hosting the server**

The server that runs [i18n-keyless.com](https://i18n-keyless.com) is open source, under the
Elastic License 2.0: [ambroselli-io/i18n-keyless-server](https://github.com/ambroselli-io/i18n-keyless-server).
It is one Docker image — the translation API, the dashboard and the MCP server — on SQLite or
Postgres, with the AI provider of your choice (Mistral, OpenAI, Anthropic, Google, or any
OpenAI-compatible endpoint).

- Free to install, and one project is free forever. A [€30 lifetime licence](https://i18n-keyless.com/self-hosted)
  unlocks unlimited projects on an instance.
- Install with [ONCE](https://once.com) or `docker compose`:
  [docs.i18n-keyless.com/docs/guides/self-hosting](https://docs.i18n-keyless.com/docs/guides/self-hosting).
- Then set `API_URL` to your instance in `init` and keep your `API_KEY` from its dashboard.

Not sure whether to self-host or subscribe? [The FAQ answers it](https://docs.i18n-keyless.com/docs/faq).

---

## 🚫 **What i18n-keyless does not do**

The limits, as of the current release. None of this is on a roadmap you should count on.

- **48 target languages**, the App Store localizations, and no others. See [supported languages](https://docs.i18n-keyless.com/docs/guides/supported-languages).
- **Dates, numbers and currencies are not formatted by the SDK**: use your runtime's `Intl` and inject the result with `replace`.
- **Not documents, not PDFs.** .

---

## 🤔 **Common objections**

The ones that come up when a team evaluates it. Short answers; the [FAQ](https://docs.i18n-keyless.com/docs/faq) has the long ones.

**"It depends on a third-party service; that is lock-in."** The server is public (ELv2) and runs as one Docker image on your machine; the SDKs are MIT; the protocol is written down; the dashboard exports everything to JSON. If i18n-keyless.com vanished tomorrow, installed apps would keep serving their cached translations, a fresh client would fall back to the source text, and `API_URL` pointed at your own instance would restore everything, AI translation included.

**"`context` is just a key in disguise."** A key is mandatory on every string, unique, in a global namespace you maintain by hand. `context` is optional, describes the meaning ("the window" or "by distance" for *Close*), and is set on the few strings that are ambiguous — most carry none. The source text stays the lookup, with or without it.

**"Machine translation is not for serious production."** AI translation is the default and the fast path. Any cell can be overridden by hand in the dashboard, and the AI never rewrites what a person wrote; a per-cell "reviewed" mark tells the two apart. If your team has professional translators and a review workflow, a TMS (Crowdin, Lokalise, Tolgee) serves it better — [the comparison](https://docs.i18n-keyless.com/docs/comparison) says which does what.

**"I cannot review the copy in a pull request."** The source string is in the code, so a wording change is a plain-language diff in the PR — more readable than `t("order.status")` on both sides. Only the translations live outside git, as with every translation platform.

**"I could write that backend in an evening."** It is already written and public: coalescing of concurrent misses, rate limiting, ETag and `last_refresh` cache validation, a client-side queue, namespaces, user-generated content, ICU plurals per language, human review, OAuth 2.1 and an MCP server. Use it, or fork it.

**"One maintainer; what if it stops?"** See the first answer: nothing you have goes away. What would stop is the hosted instance — its dashboard and the AI translation of *new* strings for projects hosted there.

---

## 🔧 **What pains does it solve?**

Multiple pains exist with the current i18n solutions.

| Pain Point | Traditional i18n | i18n-keyless |
|------------|------------------|--------------|
| **Key Management** | Manual key creation & maintenance required | No keys needed — use natural language directly |
| **Translation Management** | Manual tracking of missing translations across languages | Automatic translation handling via AI |
| **Code Readability** | Read cryptic keys like `"user.welcome.message"` | Read actual text like `"Welcome to our app!"` |
| **Setup Time** | Hours of dev setup + ongoing maintenance | Minutes to initialize |
| **Cost** | dev time (2d) + infrastructure cost (so expensive) | 5 minutes to setup + €30 once for self-hosted + €5 per month for VPS hosting |
| **Offline / low network** | A missing key shows `header.welcome.title` to users | Users see the source language instead of a broken key. Or translations bundled if you opted in. |

### Key management is painful

Today most systems use keys to translate text:

```javascript
// Traditional: you maintain this by hand, in every language
{
   "en": { "hello": "Hello", "welcome_message": "Welcome to our website" },
   "fr": { "hello": "Bonjour", "welcome_message": "Bienvenue sur notre site web" }
}
```

```jsx
// In the code, you read keys — not text
<h1>{t("welcome_message")}</h1>
<p>{t("checkout.order_summary.item_count")}</p>
```

When you see text in the app and want to update it, you have to find the key, update the
text in every JSON file, and make sure the key still matches what the code references.
Rename a key and miss one callsite: the user sees `checkout.order_summary.item_count`.

With i18n-keyless, you write the text directly:

```jsx
<T>Welcome to our website</T>
<T>{"{count} items in your cart"}</T>
```

No key to create. No JSON file to maintain. No rename to break.

### Translation management is painful

With keys, you must track which translations are missing, in which languages. You must check
manually, or write a script that compares every JSON file. A new screen with 20 strings means
20 keys to add in every language file — or a CI step that yells about it.

With i18n-keyless, a missing translation is fetched from the API the first time anyone
renders it. No file to update. No CI step. No "forgot to add the Spanish translation" bug.

### Code readability suffers

```jsx
// Traditional: what does this screen say?
<h1>{t("dashboard.header.greeting")}</h1>
<p>{t("dashboard.header.subtitle")}</p>
<button>{t("dashboard.actions.export_csv")}</button>
```

You cannot read the screen from the code. You cannot spot a typo. You cannot tell if two
sentences flow together. You have to open the JSON file, find the key, read the value, go
back to the code, and repeat.

```jsx
// i18n-keyless: the code reads like the screen
<h1><T>Good morning, {"{name}"}</T></h1>
<p><T>Here is your activity for this week.</T></p>
<button><T>Export as CSV</T></button>
```

A grammar mistake is visible in the diff. A rewording is a one-line change in the component.

### The cost adds up

With a traditional i18n setup, you spend:

- **Initial setup**: at least 1 hour of senior dev time to wire the key system, the JSON
  loader, the language switcher, and the fallback logic.
- **Per-key overhead**: ~1 minute per key for the round trip (pick a name, add it to every
  JSON file, use it in the code, verify it renders). 1 000 keys × 1 min = 16 hours.
- **Ongoing maintenance**: keys drift, files go stale, new languages mean new files, a CI
  linter to keep them in sync.

At $100/hour, 1 000 keys cost $1 700 in developer time alone — before you pay for a
translation platform.

With [i18n-keyless.com](https://i18n-keyless.com), the same 1 000 keys cost a flat price per
project per month, from €4
([pricing](https://i18n-keyless.com/#pricing)) — or €30 once,
[self-hosted](https://i18n-keyless.com/self-hosted).

Building your own equivalent system is possible, but it took 1.5 days with AI assistance to
reach production quality. That system would need: AI translation, multi-language storage,
incremental fetching, rate limiting, ETag cache validation, a client-side queue, namespaces,
user-generated content, ICU plurals per language, human review, OAuth 2.1, and an MCP server.
All of that is already built and
[open source](https://github.com/ambroselli-io/i18n-keyless-server).

## 📬 **Contact**

Need help or have questions? Reach out to:

- **Twitter**: [@ambroselli_io](https://x.com/ambroselli_io)
- **Email**: [arnaud.ambroselli.io@gmail.com](mailto:arnaud.ambroselli.io@gmail.com)

---

## 📄 **License**

Every SDK and port in this repository is [MIT](./LICENSE.md). The server is a separate
repository, [ambroselli-io/i18n-keyless-server](https://github.com/ambroselli-io/i18n-keyless-server),
under the Elastic License 2.0.

© 2026 i18n-keyless

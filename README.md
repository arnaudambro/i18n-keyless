# i18n-keyless - Ultimate DX for i18n implementation. No key, use your natural language.

Welcome to **i18n-keyless**! 🚀 This package provides a seamless way to handle translations without the need for cumbersome key management. This README will guide you through the setup and usage of the library.

[Try it by yourself in this Stackblitz](https://stackblitz.com/edit/vitejs-vite-ttaib9fx?file=src%2FApp.tsx)

---

## 📜 **Table of Contents**

- [Using an AI coding agent?](#-using-an-ai-coding-agent)
- [How it works](#-how-it-works)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
  - [React](#react-quick-start), [Node](#node-quick-start), [Vue](#vue-quick-start), [Angular](#angular-quick-start), [Browser](#browser-quick-start), [Laravel](#laravel-quick-start), [Rails](#rails-quick-start), [Flutter](#flutter-quick-start), [Python](#python-quick-start), [Go](#go-quick-start), [Kotlin](#kotlin-quick-start), [Swift](#swift-quick-start)
- [Usage](#-usage)
  - [React](#-react-usage-i18n-keyless-react)
  - [Node](#-node-usage-i18n-keyless-node)
- [Namespaces](#️-namespaces)
- [User-Generated Content](#-user-generated-content)
- [Server-Side Rendering](#-server-side-rendering)
- [Supported Languages](#-supported-languages)
- [Setup](#️-setup-with-i18n-keyless-service)
- [Protocol and ports](#-protocol-and-ports)
- [Custom Component Example](#️-custom-component-example)
- [What pains does it solve?](#-what-pains-does-it-solve)
- [Contact](#-contact)

---

## 🤖 **Using an AI coding agent?**

i18n-keyless is built to be installed by an agent in one step. Point yours at whichever of
these fits your tool:

| What | Where | For |
| --- | --- | --- |
| **Agent Skill** | [`skills/i18n-keyless/SKILL.md`](./skills/i18n-keyless/SKILL.md) | Claude Code, Claude.ai, and any tool that reads `SKILL.md`. Copy the folder into `.claude/skills/` of your project. |
| **llms.txt** | [`llms.txt`](./llms.txt), also served at [docs.i18n-keyless.com/llms.txt](https://docs.i18n-keyless.com/llms.txt) | The whole documentation as one pasteable Markdown file — Cursor, ChatGPT, Windsurf, Copilot. |
| **Context7** | `use context7` in your prompt | Live docs injected into the context window through the Context7 MCP server. |
| **MCP server** | `claude mcp add --transport http i18n-keyless https://api.i18n-keyless.com/mcp` | Your agent operates the project: list missing translations, fix one, change languages, create a project. OAuth, no key to paste. [Guide](https://docs.i18n-keyless.com/docs/guides/mcp). |

The skill is short on purpose: install, initialise, the two ways to render a string, the
per-translation options, the SSR traps, and the gotchas. It links to `llms.txt` for the rest.

---

## 😎 **How it works**

First, you should read the [What pains does it solve?](#-what-pains-does-it-solve) section to understand the pains you have with the current i18n solutions.

i18n-keyless is a library, combined with an API service (I [provide one](https://i18n-keyless.com), but [you can use your own](#%EF%B8%8F-setup-with-your-own-api)) that allows you to translate your text without the need to use keys.

By calling `I18nKeyless.init` you [initialize](#%EF%B8%8F-setup-with-i18n-keyless-service) an object that will be used to translate your text.
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

## 🔧 **Installation**

### **React Installation**

Install the package via npm or yarn:

```bash
npm install i18n-keyless-react
```

### **Node Installation**

Install the package via npm or yarn:

```bash
npm install i18n-keyless-node
```

### **Every package and port**

One protocol, one dashboard, one API key. Pick the package for your stack; each README is
the full reference for that package.

| Target | Package | Install | README |
| --- | --- | --- | --- |
| React, React Native, Expo, Next.js, Remix, TanStack Start, Astro | `i18n-keyless-react` | `npm install i18n-keyless-react` | [React usage](#-react-usage-i18n-keyless-react) below |
| Node.js backend (emails, push, cron) | `i18n-keyless-node` | `npm install i18n-keyless-node` | [Node usage](#-node-usage-i18n-keyless-node) below |
| Vue 3, Nuxt, Vite SSR | `i18n-keyless-vue` | `npm install i18n-keyless-vue` | [packages/vue](./packages/vue/README.md) |
| Angular >= 17.1 (standalone, signals, Angular SSR) | `i18n-keyless-angular` | `npm install i18n-keyless-angular` | [packages/angular](./packages/angular/README.md) |
| Plain HTML, Svelte, Alpine, htmx, jQuery, legacy sites | `i18n-keyless-browser` | `npm install i18n-keyless-browser`, or one script tag | [packages/browser](./packages/browser/README.md) |
| Laravel 11, 12, 13 | `i18n-keyless/laravel` (Composer) | `composer require i18n-keyless/laravel` | [ports/laravel](./ports/laravel/README.md) |
| Ruby on Rails 7, 8 | `i18n-keyless-rails` (RubyGems) | `bundle add i18n-keyless-rails` | [ports/rails](./ports/rails/README.md) |
| Flutter, Dart | `i18n_keyless` (pub.dev) | `flutter pub add i18n_keyless` | [ports/flutter](./ports/flutter/README.md) |
| Python >= 3.9: Django, Flask, FastAPI, scripts | `i18n-keyless` (PyPI) | `pip install i18n-keyless` | [ports/python](./ports/python/README.md) |
| Go >= 1.21: net/http, Gin, templates, CLIs | `github.com/arnaudambro/i18n-keyless/ports/go/v3` | `go get github.com/arnaudambro/i18n-keyless/ports/go/v3` | [ports/go](./ports/go/README.md) |
| Swift: iOS, macOS, SwiftUI, UIKit, Vapor | `I18nKeyless` (SwiftPM) | `.package(url: "https://github.com/arnaudambro/i18n-keyless-swift.git", from: "3.6.1")` | [ports/swift](./ports/swift/README.md) |
| Kotlin: Android, Compose, JVM, Ktor, Spring | `io.github.arnaudambro:i18n-keyless-kotlin` (Maven Central) | `implementation("io.github.arnaudambro:i18n-keyless-kotlin:3.6.1")` | [ports/kotlin](./ports/kotlin/README.md) |
| Any stack, shared engine | `i18n-keyless-core` | `npm install i18n-keyless-core` | [packages/core](./packages/core), [docs/PROTOCOL.md](./docs/PROTOCOL.md) |

---

## ⚡ **Quick Start**

Get up and running in minutes!

### **React Quick Start**

1.  **Install:**
    ```bash
    npm install i18n-keyless-react
    ```

2.  **Initialize:** Call `init` once at the root of your app (e.g., `App.js` or `index.js`).
    ```javascript
    import { init } from "i18n-keyless-react";
    import myStorage from "./src/services/storage"; // Use your preferred storage solution

    init({
      API_KEY: "<YOUR_API_KEY>", // Get your key from i18n-keyless.com
      /**
         * the storage to use for the translations -  any storage that has a getItem, setItem, removeItem, or get, set, and remove method
        *
        * in React Native you can use react-native-mmkv, @react-native-async-storage/async-storage, and in Web window.localStorage, or idb-keyval for IndexedDB, or any storage whose methods are compatible
      */
      storage: myStorage, 
      languages: {
        primary: "en", // Your app's primary language
        supported: ["en", "fr", "es"], // Languages your app supports
      },
    });
    ```
    *Note: You'll need an `API_KEY` from [i18n-keyless.com](https://i18n-keyless.com) or configure your [own API](#️-setup-with-your-own-api).*

3.  **Use:** Wrap text with the `I18nKeylessText` component.
    ```javascript
    import { I18nKeylessText } from "i18n-keyless-react"; // `import { T } from "i18n-keyless-react"` also works
    import { setCurrentLanguage } from "i18n-keyless-react"; // Optional: for changing language

    // Example Component
    function MyComponent() {
      return (
        <div>
          <button onClick={() => setCurrentLanguage("fr")}>Set FR</button>
          <button onClick={() => setCurrentLanguage("es")}>Set ES</button>
          <h1>
            <I18nKeylessText>Welcome to our app!</I18nKeylessText>
          </h1>
          <p>
            <I18nKeylessText>This text will be automatically translated.</I18nKeylessText>
          </p>
          {/* Example with context for disambiguation */}
          <button>
            <I18nKeylessText context="this is a back button">Back</I18nKeylessText>
          </button>
        </div>
      );
    }
    ```

### **Node Quick Start**

1.  **Install:**
    ```bash
    npm install i18n-keyless-node
    ```

2.  **Initialize:** Call `init` at the start of your application.
    ```javascript
    import { init } from "i18n-keyless-node";

    (async () => {
      await init({
        API_KEY: "<YOUR_API_KEY>", // Get your key from i18n-keyless.com
        languages: {
          primary: "en", // Your primary language
          supported: ["en", "fr", "es"], // Languages you need translations for
        },
      });
      console.log("i18n-keyless initialized!");
    })();
    ```
     *Note: You'll need an `API_KEY` from [i18n-keyless.com](https://i18n-keyless.com) or configure your [own API](#️-setup-with-your-own-api).*

3.  **Use:** Two functions fetch and retrieve translations. Use `awaitForTranslationOrThrow`
    in a script or a build step (an ignored rejection crashes the process on purpose). Use
    `awaitForTranslationOrFallbackToOriginal` in a request handler (it never rejects: a
    failed POST falls back to the key, with the failure still logged).

    ```javascript
    import { awaitForTranslationOrThrow } from "i18n-keyless-node";

    // Assuming init has completed
    (async () => {
      // Fetch and get the French translation for "Hello world"
      const greeting = await awaitForTranslationOrThrow("Hello world", "fr"); // Target language 'fr'
      console.log(greeting); // Output: "Bonjour le monde" (or similar)

      // Fetch and get the Spanish translation for "Processing complete."
      const message = await awaitForTranslationOrThrow("Processing complete.", "es"); // Target language 'es'
      console.log(message); // Output: "Procesamiento completo." (or similar)

      // Example with context
      const backButtonText = await awaitForTranslationOrThrow("Back", "es", { context: "this is a back button" });
      console.log(backButtonText); // Output: Spanish translation for "Back" (e.g., "Atrás")

      // ⚠️ IMPORTANT: Always await translations to avoid API rate limiting
      // Bad - could get rate limited:
      awaitForTranslationOrThrow("Hello", "fr");
      awaitForTranslationOrThrow("World", "fr");
      
      // Good - await each translation:
      await awaitForTranslationOrThrow("Hello", "fr");
      await awaitForTranslationOrThrow("World", "fr");
      
      // Even better - await in parallel if possible:
      await Promise.all([
        awaitForTranslationOrThrow("Hello", "fr"),
        awaitForTranslationOrThrow("World", "fr") 
      ]);

    })();
    ```

    In a request handler (an HTTP server, an API route), prefer the fallback variant so one
    failed translation doesn't fail the whole request:

    ```javascript
    import { awaitForTranslationOrFallbackToOriginal } from "i18n-keyless-node";

    async function handleRequest(lang) {
      // Still MUST be awaited (rate limiting) — it just never rejects.
      const greeting = await awaitForTranslationOrFallbackToOriginal("Hello world", lang);
      return greeting; // falls back to "Hello world" if the POST fails; the failure is logged
    }
    ```

### **Vue Quick Start**

1.  **Install:**
    ```bash
    npm install i18n-keyless-vue
    ```

2.  **Initialize:** Call `init` once before the app mounts, then install the plugin. It registers `<T>` globally.
    ```javascript
    import { createApp } from "vue";
    import { init, I18nKeyless } from "i18n-keyless-vue";

    init({
      API_KEY: "<YOUR_API_KEY>",
      storage: window.localStorage,
      languages: { primary: "en", supported: ["en", "fr", "es"] },
    });
    createApp(App).use(I18nKeyless).mount("#app");
    ```

3.  **Use:** Wrap text with `<T>`, or call `t()` for an attribute.
    ```vue
    <script setup>
    import { useI18nKeyless, setCurrentLanguage } from "i18n-keyless-vue";
    const { t } = useI18nKeyless();
    </script>

    <template>
      <button @click="setCurrentLanguage('fr')">Set FR</button>
      <h1><T>Welcome to our app!</T></h1>
      <input :placeholder="t('Your email')" />
      <button><T context="this is a back button">Back</T></button>
    </template>
    ```
    Full reference, SSR and Nuxt: [packages/vue/README.md](./packages/vue/README.md).

### **Angular Quick Start**

1.  **Install:**
    ```bash
    npm install i18n-keyless-angular
    ```

2.  **Initialize:** Add the provider once, in `app.config.ts`. `storage` defaults to `localStorage` in the browser.
    ```typescript
    import { provideI18nKeyless } from "i18n-keyless-angular";

    export const appConfig = {
      providers: [
        provideI18nKeyless({
          API_KEY: "<YOUR_API_KEY>",
          languages: { primary: "en", supported: ["en", "fr", "es"] },
        }),
      ],
    };
    ```

3.  **Use:** The `<i18n-t>` component, or the `t` pipe where an element cannot go.
    ```typescript
    import { Component, inject } from "@angular/core";
    import { I18nKeylessTextComponent, I18nKeylessTranslatePipe, I18nKeylessService } from "i18n-keyless-angular";

    @Component({
      standalone: true,
      imports: [I18nKeylessTextComponent, I18nKeylessTranslatePipe],
      template: `
        <button (click)="i18n.setCurrentLanguage('fr')">Set FR</button>
        <h1><i18n-t>Welcome to our app!</i18n-t></h1>
        <input [placeholder]="'Your email' | t" />
        <button><i18n-t context="this is a back button">Back</i18n-t></button>
      `,
    })
    export class MyComponent {
      readonly i18n = inject(I18nKeylessService);
    }
    ```
    Full reference and Angular SSR: [packages/angular/README.md](./packages/angular/README.md).

### **Browser Quick Start**

No framework, no build step: one script tag does `init`, translates every `data-i18n`
element and every `<i18n-t>`, and exposes the JS API as `window.i18nKeyless`.

```html
<script async type="module" src="https://esm.sh/i18n-keyless-browser/auto"
        data-api-key="<YOUR_API_KEY>" data-primary="en" data-supported="en,fr,es"></script>

<button onclick="i18nKeyless.setCurrentLanguage('fr')">Set FR</button>
<h1 data-i18n>Welcome to our app!</h1>
<button><i18n-t context="this is a back button">Back</i18n-t></button>
```

With a bundler (Svelte, Alpine, htmx, jQuery, vanilla): `npm install i18n-keyless-browser`,
then `init`, `defineI18nT()`, `translateDom()` and `watchTranslation()` from JS. Full
reference: [packages/browser/README.md](./packages/browser/README.md).

### **Laravel Quick Start**

Your existing `__('Welcome to our app')` calls (Laravel's JSON keyless mode) resolve through
the API. One `composer require`, two `.env` lines, zero code change.

```bash
composer require i18n-keyless/laravel
```

```dotenv
I18N_KEYLESS_API_KEY=<YOUR_API_KEY>
I18N_KEYLESS_LANGUAGES=en,fr,es      # every language your app serves
```

```php
__('Welcome to our app');                        // translated for App::getLocale()
__('Welcome :name', ['name' => $user->name]);    // placeholders stay Laravel's job
i18nk('8 heures', context: 'duration');          // context, when one string has two meanings
```

Full reference (cache, queue, locales, limitations): [ports/laravel/README.md](./ports/laravel/README.md).

### **Rails Quick Start**

Write the source string where a key would go: `t('Welcome to our app')` resolves through the
API, cached in `Rails.cache`. Your YAML keys keep working and win. One gem, two `.env` lines.

```bash
bundle add i18n-keyless-rails
```

```dotenv
I18N_KEYLESS_API_KEY=<YOUR_API_KEY>
I18N_KEYLESS_LANGUAGES=en,fr,es      # every language your app serves
```

```ruby
t('Welcome to our app')                          # translated for I18n.locale
t('Welcome %{name}', name: user.name)            # placeholders stay I18n's job
i18nk('8 heures', context: 'duration')           # context, when one string has two meanings
t('users.index.title')                           # a Rails key: YAML as before, never sent
```

Full reference (the Rails-key rule, cache, queue, locales, limitations): [ports/rails/README.md](./ports/rails/README.md).

### **Flutter Quick Start**

No ARB files, no `flutter gen-l10n`: write `T('Welcome')` and ship 48 languages at runtime.

```bash
flutter pub add i18n_keyless
```

```dart
final i18n = I18nKeylessClient();
await i18n.init(I18nKeylessConfig(
  apiKey: '<YOUR_API_KEY>',
  languages: LanguagesConfig(primary: Lang.en, supported: [Lang.en, Lang.fr, Lang.es]),
  storage: SharedPreferencesStorage(),
));
runApp(I18nKeylessScope(client: i18n, child: const MyApp()));

// in a widget
T('Welcome to our app!');
TextField(decoration: InputDecoration(hintText: context.t('Your email')));
I18nKeyless.of(context).setCurrentLanguage(Lang.fr);
```

Full reference: [ports/flutter/README.md](./ports/flutter/README.md).

### **Python Quick Start**

A server, a script or a build step: `t("Welcome", lang)` resolves through the API, a miss is
translated once and served from memory from then on. No `.po` file, no catalogue.

```bash
pip install i18n-keyless        # or: uv add i18n-keyless
```

```python
import i18n_keyless as i18n

i18n.init(api_key="<YOUR_API_KEY>", primary="en", supported=["en", "fr", "es"])  # once, at start
i18n.t("Welcome to our app", "fr")                          # "Bienvenue dans notre application"
i18n.t("8 hours", "fr", context="duration")                 # context, when one string has two meanings
i18n.t("Hello {name}", "es", replace={"{name}": user.name}) # placeholders, replaced after translation
i18n.t_or_raise("Welcome", "de")                            # a script: raise instead of falling back
```

Full reference (Django, Flask and FastAPI snippets, the three network modes, `flush_usage()`): [ports/python/README.md](./ports/python/README.md).

### **Go Quick Start**

Standard library only: one client per process, `T()` in a handler or a template func map. A
miss is translated in the call and served from memory from then on.

```bash
go get github.com/arnaudambro/i18n-keyless/ports/go/v3
```

```go
import i18nkeyless "github.com/arnaudambro/i18n-keyless/ports/go/v3"

client, err := i18nkeyless.Init(ctx, i18nkeyless.Config{
	APIKey:    "<YOUR_API_KEY>",
	Languages: i18nkeyless.Languages{Primary: "en", Supported: []string{"en", "fr", "es"}},
})
client.T(ctx, "Welcome to our app", "fr")                                           // "Bienvenue dans notre application"
client.T(ctx, "8 hours", "fr", i18nkeyless.WithContext("duration"))                 // context, when one string has two meanings
client.T(ctx, "Hello {name}", "es", i18nkeyless.WithReplace(map[string]string{"{name}": name}))
text, err := client.Translate(ctx, "Welcome", "de")                                 // the error, for a build step
```

Full reference (Gin, `html/template`, the three network modes, `FlushUsage()`, `Close()`): [ports/go/README.md](./ports/go/README.md).

### **Swift Quick Start**

Foundation only, iOS 15 / macOS 12. A device port: a persisted id, `UserDefaults` storage by
default, an `ObservableObject` store so SwiftUI re-renders when a translation lands.

```swift
// Package.swift, or Xcode > Add Package: https://github.com/arnaudambro/i18n-keyless-swift
.package(url: "https://github.com/arnaudambro/i18n-keyless-swift.git", from: "3.6.1")
```

```swift
import I18nKeyless

try I18nKeyless.configure(.init(apiKey: "<YOUR_API_KEY>",
    languages: .init(primary: .en, supported: [.en, .fr, .es])))
I18nKeylessText("Welcome to our app")                                  // SwiftUI, re-renders when it lands
let title = I18nKeyless.t("Your profile")                              // a String, anywhere (UIKit, a label)
I18nKeyless.t("8 hours", context: "duration")                          // context, when one string has two meanings
I18nKeyless.t("Hello {name}", replace: ["{name}": user.name])
await I18nKeyless.setLanguage(.fr)                                     // switch
```

On a server (Vapor, Hummingbird) pass `server: true`: no device id, no usage analytics.
Full reference (the storage protocol, the `server` flag, custom handlers): [ports/swift/README.md](./ports/swift/README.md).

### **Kotlin Quick Start**

Pure JVM, zero dependencies, so it loads in any Android app without a duplicate-class clash.
A device port: a persisted id, a storage adapter, translations cached on disk.

```kotlin
implementation("io.github.arnaudambro:i18n-keyless-kotlin:3.6.1")
```

```kotlin
I18nKeyless.initBlocking(I18nKeylessConfig(
    apiKey = "<YOUR_API_KEY>",
    languages = LanguagesConfig(primary = Lang.EN, supported = listOf(Lang.EN, Lang.FR, Lang.ES)),
    storage = FileStorage(context.filesDir.resolve("i18n-keyless")),   // or a 6-line SharedPreferences adapter
))
I18nKeyless.t("Welcome to our app")                                   // the current language
I18nKeyless.t("8 hours", context = "duration")                       // context, when one string has two meanings
I18nKeyless.t("Hello {name}", replace = mapOf("{name}" to user.name))
I18nKeyless.setLanguage(Lang.FR)                                      // listeners fire; Compose recomposes
```

On a server (Ktor, Spring) pass `server = true`: no device id, one client per language.
Full reference (the Compose snippet, the SharedPreferences adapter, the `server` flag): [ports/kotlin/README.md](./ports/kotlin/README.md).

---

## 🚀 **React Usage (i18n-keyless-react)**

### **Component Usage**

Use the `I18nKeylessText` component to wrap your text in any supported language:

```javascript
import { I18nKeylessText } from "i18n-keyless-react";

<I18nKeylessText>Je mets mon texte dans ma langue, finies les clés !</I18nKeylessText>
```

### **Dynamic Text Replacement**

For text with dynamic content, use the `I18nKeylessText` component:

```javascript
import { I18nKeylessText } from "i18n-keyless-react";

// Replace specific text patterns with dynamic values
<I18nKeylessText 
  replace={{
    "{name}": user.name,
    "{date}": formattedDate
  }}
>
  Bonjour {name}, votre rendez-vous est confirmé pour le {date}
</I18nKeylessText>

// This will first translate the entire text, then replace the placeholders with their respective values. It's perfect for dynamic content like usernames, dates, or counts.
```

### **Plural and gender**

We didn't build any complicated internal system for plural and gender management. 
For now, you need to use JavaScript to switch between cases, and maybe context to specify plural and gender.

### **React Hooks and Methods**

For translating text outside of a `<I18nKeylessText>` component — a prop, an `alt`, a
`placeholder`, a string you pass to another library — use the `useTranslation` hook. It is
the hook behind `<I18nKeylessText>`, so it takes the same options and resolves the same way:

```javascript
import { useTranslation } from "i18n-keyless-react";

export default function Home() {
  const welcome = useTranslation("Welcome");
  const search = useTranslation("Search {what}", { replace: { "{what}": "products" } });

  return (
    <HomeTabs.Navigator>
      <HomeTabs.Screen options={{ tabBarLabel: welcome }} name="WELCOME" />
      <input placeholder={search} />
    </HomeTabs.Navigator>
  );
}
```

It is a hook, so the component re-renders when the translation arrives and when the user
switches language — and under SSR it reads the request's language from
`<I18nKeylessProvider>`, like `<I18nKeylessText>` does.

One hook call per string is right for a placeholder or two. For a component with many
strings, or strings inside an array or a `.map()`, call `useTranslation()` **without a
text**: it returns a reactive `t()` function with the same options and the same resolution.
The hook's options are the defaults; a call's options merge over them:

```javascript
import { useTranslation } from "i18n-keyless-react";

const links = [{ to: "/dashboard", label: "Dashboard" }, { to: "/inbox", label: "Inbox" }];

export function Nav() {
  const t = useTranslation({ context: "navigation menu item" });
  return links.map((link) => <a key={link.to} href={link.to}>{t(link.label)}</a>);
}
```

Because `t()` cannot know its strings ahead of time, that component re-renders on every
translation batch that lands, not only on its own strings — fine for a nav, wasteful for
one placeholder. Pick the form per site.

**Outside a component** — a route loader, a utility, a `head()` — there is no hook to call.
Use the plain `getTranslation` function there:

```javascript
import { getTranslation } from "i18n-keyless-react";

export const loader = async () => ({ title: getTranslation("Welcome") });
```

> [!IMPORTANT]
> **`getTranslation` is a plain function, not a hook.** It reads the store one time and does
> **not** subscribe to it. A component that calls it in render never re-renders when the
> user switches language, and the text stays in the previous language. In a component, use
> `useTranslation` instead — the string form for one prop, `const t = useTranslation()` for
> many. Before `init()` has run, `getTranslation` returns the text as-is instead of throwing,
> so a component tree rendered without the app entry (Storybook, a unit test) shows the
> primary language.

For setting a new current language, use the `setCurrentLanguage` method wherever you want:

```javascript
import { setCurrentLanguage } from "i18n-keyless-react";

setCurrentLanguage("en");
```

To retrieve the current language, use the `useCurrentLanguage` hook:

```javascript
import { useCurrentLanguage } from "i18n-keyless-react";

const currentLanguage = useCurrentLanguage();
```

It has a second job: it subscribes the component to language changes. Call it in every
component that calls `getTranslation()`, even if you ignore the return value. See the
note above.

### **Storage Management**

Clear the i18n-keyless storage:

```javascript
import { clearI18nKeylessStorage, clearI18nKeylessStorageAndStore } from "i18n-keyless-react";

// Clear the cached translations from the storage you passed to init()
clearI18nKeylessStorage(window.localStorage);
// Note: the device id (`i18n-keyless-user-id`) is deliberately kept. It identifies the
// install, not the cache — dropping it would count this device as a new monthly active
// user on its next launch.

// Same, and also resets the in-memory store, so the UI drops back to the source strings
await clearI18nKeylessStorageAndStore();
```

## 🚀 **Node Usage (i18n-keyless-node)**

### **Initialization**

Initialize the i18n system with your configuration (usually done once at startup):

```javascript
import { init } from "i18n-keyless-node";

await init({
  API_KEY: "<YOUR_API_KEY>",
  languages: {
    primary: "fr",
    supported: ["fr", "en"]
  }
});
```

### **Translation Methods**

#### `awaitForTranslationOrThrow` / `awaitForTranslationOrFallbackToOriginal` (Asynchronous - **MANDATORY AWAIT**)

Two functions retrieve a translation, automatically fetching it from the backend via API or
custom handler if it's missing locally. Pick by call site: in a **request handler**, use
`awaitForTranslationOrFallbackToOriginal` — it never rejects, and returns the key on
failure (the failure is still logged). In a **script or a build step**, use
`awaitForTranslationOrThrow` — it rejects, and an ignored rejection crashes the process on
purpose, so a one-off run fails loudly instead of shipping untranslated output.

**🚨 CRITICAL NODE.JS USAGE NOTE 🚨**

**You MUST `await` both functions' calls**, always — even `awaitForTranslationOrFallbackToOriginal`, which never rejects, still needs the `await` for rate limiting. You would be blocked by 429 Too many requests if you didn't.

For `awaitForTranslationOrThrow`, failure to await is **not optional**. If the underlying
translation process encounters an error (network issue, API error, etc.) the promise
rejects, and an unhandled rejection terminates the Node process — deliberately, so a script
or build step that cannot translate fails loudly instead of shipping the wrong text.

Handling it is honoured, though: a `try/catch` or a `.catch()` gets the error and your
process keeps running, so you can fall back to your own text. Only an *ignored* rejection is
fatal. The error names the key and carries the underlying failure as its `cause`.

> **Before 3.2.0 this was backwards**: ignoring the rejection was silent, and a correct
> `try/catch` crashed the process anyway.

> **Deprecated:** `awaitForTranslation` is an alias of `awaitForTranslationOrThrow`, kept
> for backward compatibility since 3.5.0. It will be removed in 4.0.0 — use
> `awaitForTranslationOrThrow` or `awaitForTranslationOrFallbackToOriginal` instead.

```javascript
import { awaitForTranslationOrThrow } from "i18n-keyless-node";

// --- CORRECT USAGE (Mandatory) ---
async function getGreetingSafe(name: string, lang: string): Promise<string> {
  const greetingTemplate = await awaitForTranslationOrThrow("Hello {user}", lang);
  return greetingTemplate.replace("{user}", name);
}


// --- ALSO CORRECT: .catch() is honoured, your fallback runs, nothing crashes ---
awaitForTranslationOrThrow("Processing complete.", "es")
  .then(message => {
    console.log(message); // Output: "Procesamiento completo."
  })
  .catch(error => {
    console.error("Failed to get processing message:", error);
    // Handle error, maybe use fallback text
  });

// DO NOT DO THIS:
awaitForTranslationOrThrow("This will crash if it rejects!", "de");

// ALSO DO NOT DO THIS (assigning promise without handling rejection):
const promise = awaitForTranslationOrThrow("This also crashes if it rejects!", "it");

```

### **Managing Translations**

Fetch all translations for all supported languages:

```javascript
import { getAllTranslationsForAllLanguages } from "i18n-keyless-node";

// Fetch and update translation store with latest translations
const response = await getAllTranslationsForAllLanguages(store);
if (response?.ok) {
  // Handle successful translation update
  console.log("Translations updated successfully");
}
```

---

## 🗂️ **Namespaces**

By default, all of a project's translations live in one bucket. On large projects that can
overflow browser storage (`Setting the value of 'i18n-keyless-translations' exceeded the
quota`) and means every client downloads everything.

A **namespace** splits translations into independent slices: each namespace is fetched and
persisted on its own, so a client only downloads and stores the parts it actually renders.

```javascript
// React — per call (component or function)
<I18nKeylessText namespace="checkout">Pay now</I18nKeylessText>
getTranslation("Pay now", { namespace: "checkout" });

// Node
await awaitForTranslationOrThrow("Pay now", "fr", { namespace: "checkout" });
```

Set a default namespace once in `init` (a per-call `namespace` always overrides it):

```javascript
init({
  API_KEY: "<YOUR_API_KEY>",
  storage: myStorage,
  defaultNamespace: "app-ui",
  languages: { primary: "en", supported: ["en", "fr", "es"] },
});
```

### Memory-only namespaces (`unpersistedNamespace`)

For high-cardinality, transient namespaces — e.g. **one namespace per discussion** in a
chat/community — add `unpersistedNamespace`. Those translations stay in memory only: never
written to storage, never reloaded at boot, never refetched on language change. So opening
hundreds of discussions adds zero storage weight and zero boot cost.

```javascript
<I18nKeylessText namespace={`discussion-${id}`} unpersistedNamespace>
  {message}
</I18nKeylessText>
```

> `unpersistedNamespace` is a client-storage concern only; it has no effect in
> `i18n-keyless-node` (the node store is in-memory regardless).

Namespaces are backward compatible: the default namespace reuses the existing storage keys,
so apps that don't use namespaces are unchanged. Self-hosted backends only need to handle an
optional `namespace` on the translate routes — see
[Using your own API](#using-your-own-api).

---

## 💬 **User-Generated Content**

Translate text your *users* wrote, not just text you wrote — a review, a comment, a chat
message — with the same `<T>` you already use.

Pass `originLanguage` to say what language the text arrived in:

```jsx
<T originLanguage="es">Hola mundo</T>
```

Every reader sees it in their own language. A French reader gets "Bonjour le monde", an
English reader "Hello world", and a Spanish reader gets the original text back untouched —
never a round-trip through a translation.

It works with the imperative API and on the server too:

```js
getTranslation(review.body, { originLanguage: review.lang });

// node
await awaitForTranslationOrThrow(review.body, "en", { originLanguage: review.lang });
```

**How it stays cheap.** The row is keyed by the primary-language version, so the same
sentence submitted by ten users costs one translation. Text already seen is recognised by
its original wording, never re-translated. Pair it with an
[unpersisted namespace](#memory-only-namespaces-unpersistednamespace) when the content is
high-cardinality and short-lived:

```jsx
<T originLanguage={msg.lang} namespace={`chat-${roomId}`} unpersistedNamespace>
  {msg.body}
</T>
```

---

## 🖥️ **Server-Side Rendering**

Render fully translated HTML on the server — real content for crawlers and a first paint
with no flash of untranslated text.

Wrap the tree in a provider and hand it the language for *this* request:

```jsx
import { I18nKeylessProvider, getServerTranslations } from "i18n-keyless-react";

export async function handler(request) {
  const lang = langFromUrl(request); // /en/about -> "en"
  const translations = await getServerTranslations(lang);

  return renderToString(
    <I18nKeylessProvider lang={lang} translations={translations}>
      <App />
    </I18nKeylessProvider>
  );
}
```

`<T>` reads the provider first and falls back to the store, so **SPA mode is untouched** —
adding SSR to an existing app changes nothing about how it already works.

- **No cross-request leaking.** The language lives in per-render context, not in the
  process-wide store, so concurrent requests in different languages cannot mix.
- **`getTranslation()` works too.** A plain function cannot read React context, so seed the
  store once in your client entry with `hydrateFromServer({ lang, translations })` before
  `hydrateRoot`.
- **Less traffic than a SPA, not more.** Usage analytics are suppressed on the server, and a
  long-lived process fetches each language once per boot.
- **Edge-safe.** Request scoping uses `AsyncLocalStorage` when available and degrades to a
  no-op when it is not, instead of crashing.

Full reference, including per-request scoping with `runWithI18nKeyless`, in
[docs/SSR.md](docs/SSR.md).

---

## 🌍 **Supported Languages**

i18n-keyless covers the 50 [App Store
localizations](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations/),
as 48 language codes. Any of them can be your `primary`.

| | | | |
|---|---|---|---|
| `ar` Arabic | `bn` Bangla | `ca` Catalan | `zh-Hans` Chinese (Simplified) |
| `zh-Hant` Chinese (Traditional) | `hr` Croatian | `cs` Czech | `da` Danish |
| `nl` Dutch | `en` English | `en-GB` English (U.K.) | `fi` Finnish |
| `fr` French | `fr-CA` French (Canada) | `de` German | `el` Greek |
| `gu` Gujarati | `he` Hebrew | `hi` Hindi | `hu` Hungarian |
| `id` Indonesian | `it` Italian | `ja` Japanese | `kn` Kannada |
| `ko` Korean | `ms` Malay | `ml` Malayalam | `mr` Marathi |
| `no` Norwegian | `or` Odia | `pl` Polish | `pt` Portuguese |
| `pt-BR` Portuguese (Brazil) | `pa` Punjabi | `ro` Romanian | `ru` Russian |
| `sk` Slovak | `sl` Slovenian | `es` Spanish | `es-MX` Spanish (Latin America) |
| `sv` Swedish | `ta` Tamil | `te` Telugu | `th` Thai |
| `tr` Turkish | `uk` Ukrainian | `ur` Urdu | `vi` Vietnamese |

### Why most codes are bare

A bare language code matches **every** region of that language: `fr` covers fr-FR, fr-CA,
fr-BE and fr-CH at once. Adding a region narrows it. So we only regionalize where the
translation is genuinely different text:

- **`zh-Hans` / `zh-Hant`** — a script, not a region. There is no bare `zh`: Simplified and
  Traditional aren't mutually readable.
- **`pt-BR`** — Brazilian vocabulary differs from European Portuguese in everyday UI words
  (usuário/utilizador, arquivo/ficheiro, tela/ecrã).
- **`es-MX`** — Latin American Spanish (computadora/ordenador, celular/móvil).
- **`fr-CA`** — Québec French.
- **`en-GB`** — British spelling.

You're billed per language you opt into, so `['pt']` is one translation and
`['pt', 'pt-BR']` is two. Start bare; add a variant when you actually want that second
translation.

### Matching a device locale

`resolveLang` maps any BCP-47 tag — `navigator.language`,
`Localization.getLocales()[0].languageTag`, an `Accept-Language` entry — onto a language you
ship, most specific first:

```js
import { resolveLang } from 'i18n-keyless-core';

resolveLang('pt-BR');   // 'pt-BR'
resolveLang('pt-AO');   // 'pt'       — no Angolan variant, falls back to the bare language
resolveLang('zh-TW');   // 'zh-Hant'
resolveLang('es-419');  // 'es-MX'

// Pass `supported` so you only ever get a language you actually ship
resolveLang(navigator.language, { supported: ['pt', 'en'], fallback: 'en' });
// 'pt-BR' device → 'pt'
```

### Pushing metadata to App Store Connect

App Store Connect has no bare slots — it wants `fr-FR`, not `fr`. `toAppStoreLocale` maps a
language onto its listing slot:

```js
import { toAppStoreLocale } from 'i18n-keyless-core';

toAppStoreLocale('fr');      // 'fr-FR'
toAppStoreLocale('en');      // 'en-US'
toAppStoreLocale('pt');      // 'pt-PT'
toAppStoreLocale('pt-BR');   // 'pt-BR'
```

Apple's `en-AU` and `en-CA` slots have no dedicated language — fill them from `en`, or opt
into `en-GB` for British spelling.

---

## ⚙️ **Setup Options**

While the Quick Start uses the [i18n-keyless service](https://i18n-keyless.com) via `API_KEY`, you have other options:

### **Using the i18n-keyless Service (Default)**

This is the easiest way to get started. Provide your `API_KEY` during initialization as shown in the Quick Start guides.

*(React Setup Example - Covered in Quick Start)*

*(Node Setup Example - Covered in Quick Start)*

### **Using your own API**

If you prefer to host your own translation backend, you can configure `i18n-keyless` to point to your API endpoints.

#### **Using `API_URL`**

To use your own API, you need to provide the `API_URL` in the init configuration. Your API must implement the following routes:

-   `GET /translate/:lang`: This route should return all translations for a given language.
    If a `?namespace=<ns>` query param is present (see [Namespaces](#️-namespaces)), return
    **only** that namespace's translations; when absent, return the default bucket (for
    non-namespaced projects that's everything — unchanged behaviour).
    **Response format to GET /translate/en:**

    ```json
    {
        "ok": true,
        "data": {
            "translations": {
                "Bonjour le monde": "Hello world",
                "Bienvenue chez nous": "Welcome to our website",
                "Au revoir": "Goodbye"    
            }
        },
        "error": null,
        "message": "" // there would be a message if the key is not valid, or whatever
    }
    ```

-   `POST /translate`: This route should accept a body with the key to translate and return the translated text.
    **Request body:**

    ```json
    {
        "key": "Bonjour le monde",
        "languages": ["en","nl","it","de","es"],
        "primaryLanguage": "fr"
    }
    ```

    The body may also include an optional `"namespace"` (see
    [Namespaces](#️-namespaces)) — store the key under it; absent ⇒ default bucket. It is
    omitted from the request when the namespace is the default, so non-namespaced apps send
    the exact body above.

    **Response format:**

    ```json
    {
        "ok": true,
        "message": "", // there would be a message if the key is not valid, or whatever
        "data": { "translation": { "fr": "Bonjour tout le monde", "en": "Hello world" } }
    }
    ```

Here's how to configure with your `API_URL`:

```javascript
// For React
import { init } from "i18n-keyless-react";
import myStorage from "./src/services/storage";

init({
    API_URL: "https://your-api.com",
    storage: myStorage,
    languages: {
        primary: "fr",
        supported: ["en", "fr"],
    },
});

// For Node.js
import { init } from "i18n-keyless-node";

await init({
    API_URL: "https://your-api.com",
    languages: {
        primary: "fr",
        supported: ["en", "fr"],
    },
});
```

#### **Using Custom Handlers**

Alternatively, you can provide custom functions to handle the translation and retrieval of all translations:

```javascript
// For React
import { init } from "i18n-keyless-react";
import myStorage from "./src/services/storage";

async function handleTranslate(key, languages, primaryLanguage) {
    // Your custom logic to translate the key
    return { ok: true, message: "" };
}

async function getAllTranslations(lang) {
    // Your custom logic to fetch all translations for a specific language
    return {
        ok: true,
        data: {
            translations: {
                "Bonjour le monde": "Hello world",
            }
        }
    };
}

init({
    storage: myStorage,
    languages: {
        primary: "fr",
        supported: ["en", "fr"],
    },
    handleTranslate: handleTranslate,
    getAllTranslations: getAllTranslations
});

// For Node.js
import { init } from "i18n-keyless-node";

async function handleTranslate(key, languages, primaryLanguage) {
    // Your custom logic to translate the key
    return { ok: true, message: "" };
}

async function getAllTranslationsForAllLanguages() {
    // Your custom logic to fetch translations for all languages
    return {
        ok: true,
        data: {
            translations: {
                en: {
                    "Bonjour le monde": "Hello world"
                },
                fr: {}
            }
        }
    };
}

await init({
    languages: {
        primary: "fr",
        supported: ["en", "fr"],
    },
    handleTranslate: handleTranslate,
    getAllTranslationsForAllLanguages: getAllTranslationsForAllLanguages
});
```

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

## 🛠️ **Custom Component Example (React)**

For better integration and consistency, wrap `I18nKeylessText` within your own custom text component:

### React web with markdown

```javascript
import * as I18nKeyless from 'i18n-keyless-react';
import type { I18nKeylessTextProps } from 'i18n-keyless-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

I18nKeyless.init({
  API_KEY: 'API_KEY',
  storage: window.localStorage,
  languages: {
    primary: 'en',
    supported: [ 'en', 'fr', /* 'es', 'pt', 'ar', 'de', 'it', 'ja', 'ko', 'nl', 'pl', 'ro', 'hu', 'ru', 'sv', 'tr', 'zh-Hans', 'cs', 'el', … */ ],
  },
});

export default function MyText({
  children,
  i18nProps,
}: {
  children: string;
  i18nProps?: I18nKeylessTextProps;
}) {
  // getTranslation does not subscribe to the store, so subscribe here.
  // Without this, the text keeps the previous language after a language switch.
  I18nKeyless.useCurrentLanguage();

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        // put your custom components - all the default italic/bold etc. are already setup in the lib
        strong: ({ ...props }) => <span className="text-neo-pink" {...props} />,
      }}
    >
      {I18nKeyless.getTranslation(children, i18nProps)}
    </ReactMarkdown>
  );
}
```

### React Native

You could also put markdown the same way here

```javascript
import { StyleProp, Text, TextProps, TextStyle } from "react-native";
import { I18nKeylessText, type I18nKeylessTextProps } from "i18n-keyless-react";
import { colors } from "~/utils/colors";

interface MyTextProps {
  className?: string;
  style?: StyleProp<TextStyle>;
  color?: keyof typeof colors;
  textProps?: TextProps;
  skipTranslation?: boolean;
  children: I18nKeylessTextProps["children"];
  debug?: I18nKeylessTextProps["debug"];
  context?: I18nKeylessTextProps["context"];
  replace?: I18nKeylessTextProps["replace"];
  forceTemporary?: I18nKeylessTextProps["forceTemporary"];
}

export default function MyText({
  className,
  style = {},
  children,
  color = "app-white",
  textProps,
  skipTranslation = false,
  debug = false,
  context,
  replace,
  forceTemporary,
}: MyTextProps) {
  if (skipTranslation) {
    if (debug) {
      console.log("skipTranslation", children);
    }
    return (
      <Text
        className={["text-dark dark:text-white", className].join(" ")}
        style={[style, { color: color ? colors[color] : undefined }]}
        {...textProps}
      >
        {children}
      </Text>
    );
  }
  if (debug) {
    console.log("children translated", children);
  }
  return (
    <Text
      className={["text-dark dark:text-white", className].join(" ")}
      style={[style, { color: color ? colors[color] : undefined }]}
      {...textProps}
    >
      <I18nKeylessText
        context={context}
        replace={replace}
        forceTemporary={forceTemporary}
        debug={debug}
      >
        {children}
      </I18nKeylessText>
    </Text>
  );
}
```

## 🔧 **What pains does it solve?**

Multiple pains exist with the current i18n solutions.

| Pain Point | Traditional i18n | i18n-keyless |
|------------|------------------|--------------|
| **Key Management** | Manual key creation & maintenance required | No keys needed - use natural language directly |
| **Translation Management** | Manual tracking of missing translations across languages | Automatic translation handling via AI |
| **Code Readability** | Read cryptic keys like `"user.welcome.message"` | Read actual text like `"Welcome to our app!"` |
| **Setup Time** | Hours of dev setup + ongoing maintenance | Minutes to initialize |
| **Cost** | ~$1600 for 1000 keys (dev time) | $8/month for 1000 keys |


### i18n key system management

Today most of the systems use keys to translate the text:

```javascript
{
   "en": {
      "hello": "Hello"
   },
   "fr": {
      "hello": "Bonjour"
   }
}
```

This is painful to generate.
This is painful to maintain.

When you see a text in the app, and you want to update it, you need to find the corresponding key, update the text, and make sure to not forget to update the key if needed.

With i18n-keyless, you don't care about the i18n system at all.

### Translation management

With the key system, you also need to manage the translations in the app. 
You need to not forget any. In all the languages you support.
You need to check manually, or create a script to do it.

With i18n-keyless, you don't care about the i18n system at all.

### Code reading

With the key system, when you read the code and the content, you have to read keys, not natural language.
So you don't really know what you are reading.
Sometimes you should make a fix because a sentence is not grammatically correct. But you don't know that because you read keys, not natural language.

With i18n-keyless, you read natural language.
So you know exactly what you are reading.
And you can make sure the sentence is grammatically correct, in real time.

### Time saving

With basic i18n system on your own, you need at least to
- setup the keys' system: at least 1 hour of senior dev time
- back and forth for each new key: 1 minutes per key, x1000 keys = 1000 minutes = 16 hours

At 100$ per hour, that's 1600$ for 1000 keys.

With [i18n-keyless.com](https://i18n-keyless.com), at 8$ a month for 1000 keys, you can afford 200 months of subscription.

You can setup your own system : it took me at least 1.5 day to make it strong enough, that would cost you at least 1200$ for
- handling translation with AI
- in several languages
- storage in DB
- retrieving translations from DB
- only the latest ones to make the service fast and efficient
- handling multiple languages
- maintaining the service

## 📬 **Contact**

Need help or have questions? Reach out to:

- **Twitter**: [@ambroselli_io](https://x.com/ambroselli_io)
- **Email**: [arnaud.ambroselli.io@gmail.com](mailto:arnaud.ambroselli.io@gmail.com)

---

© 2025 i18n-keyless


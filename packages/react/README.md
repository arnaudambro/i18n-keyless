# i18n-keyless-react

Keyless i18n for React, React Native, Expo, Next.js, Remix, TanStack Start and Astro.
The source text is the key — no JSON files, no translation step.

## Install

```bash
npm install i18n-keyless-react
```

## Quick start

**1. Initialise** (once, at the root of your app):

```js
import { init } from 'i18n-keyless-react';

init({
  API_KEY: '<YOUR_API_KEY>',
  storage: window.localStorage,
  languages: { primary: 'en', supported: ['en', 'fr', 'es'] },
});
```

**2. Translate:**

```jsx
import { I18nKeylessText } from 'i18n-keyless-react';

<h1><I18nKeylessText>Welcome to our app!</I18nKeylessText></h1>
```

**3. Switch language:**

```js
import { setCurrentLanguage } from 'i18n-keyless-react';
setCurrentLanguage('fr');
```

## Plurals, ordinals and genders

```jsx
<I18nKeylessText count={n}>{'{count} articles in your cart'}</I18nKeylessText>
<I18nKeylessText count={rank} ordinal>{'You are {count}th'}</I18nKeylessText>
<I18nKeylessText select={{ gender: user.gender }}>He is connected</I18nKeylessText>
```

The API writes one ICU message per language with the forms that language needs (two in
French, four in Russian, six in Arabic). The SDK resolves the right form with
`Intl.PluralRules`.

## Hooks

- `useTranslation(text, options?)` — reactive translation for a prop, placeholder or title.
- `useTranslation(options?)` — returns a reactive `t()` function for many strings.
- `useCurrentLanguage()` — the current language, and subscribes to changes.
- `useTranslationStatus(text, options?)` — `ready` / `pending` / `unavailable`.

## SSR

Works with Next.js, Remix, TanStack Start and Astro. Wrap the tree in
`<I18nKeylessProvider>` with the language and translations for the request. Full guide:
[docs.i18n-keyless.com/docs/guides/ssr](https://docs.i18n-keyless.com/docs/guides/ssr)

## Documentation

Full reference, namespaces, user-generated content, precompiled bundles:
[docs.i18n-keyless.com](https://docs.i18n-keyless.com)

The main README with every quick start:
[github.com/arnaudambro/i18n-keyless](https://github.com/arnaudambro/i18n-keyless)

## License

MIT

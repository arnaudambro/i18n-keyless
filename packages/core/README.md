# i18n-keyless-core

The shared engine behind every i18n-keyless SDK. The source text is the key — no JSON
files, no translation keys.

Unless you are building a custom integration, you probably want one of the
framework-specific packages instead:

| Package | For |
| --- | --- |
| [`i18n-keyless-react`](https://www.npmjs.com/package/i18n-keyless-react) | React, React Native, Expo, Next.js, Remix, TanStack Start, Astro |
| [`i18n-keyless-node`](https://www.npmjs.com/package/i18n-keyless-node) | Node.js backends (emails, cron, push, API routes) |
| [`i18n-keyless-vue`](https://www.npmjs.com/package/i18n-keyless-vue) | Vue 3, Nuxt |
| [`i18n-keyless-angular`](https://www.npmjs.com/package/i18n-keyless-angular) | Angular 17+ |
| [`i18n-keyless-browser`](https://www.npmjs.com/package/i18n-keyless-browser) | Plain HTML, Svelte, Alpine, htmx, jQuery |

## Install

```bash
npm install i18n-keyless-core
```

## What it provides

- `init()` — initialise the translation store with your API key and languages.
- `getTranslation(text, options?)` — synchronous lookup from the store.
- `setCurrentLanguage(lang)` — switch the active language.
- `resolveLang(tag, options?)` — map any BCP-47 tag to a language you ship.
- `toAppStoreLocale(lang)` — map a language code to its App Store Connect slot.
- Language constants and types shared by every SDK.

## Plurals, ordinals and genders

Pass `count` for plurals, `ordinal` for ranks, `select` for closed sets (gender, role).
The API writes one ICU message per language; the SDK resolves it with `Intl.PluralRules`.

```js
getTranslation('{count} items', { count: 3 });
getTranslation('You are {count}th', { count: rank, ordinal: true });
getTranslation('They are connected', { select: { gender: 'female' } });
```

## Documentation

Full documentation, quick starts for every framework, and the wire protocol:
[docs.i18n-keyless.com](https://docs.i18n-keyless.com)

The main README with all quick starts:
[github.com/arnaudambro/i18n-keyless](https://github.com/arnaudambro/i18n-keyless)

## License

MIT

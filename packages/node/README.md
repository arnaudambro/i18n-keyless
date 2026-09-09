# i18n-keyless-node

Keyless i18n for Node.js backends — emails, cron jobs, push notifications, API routes.
The source text is the key — no JSON files, no translation step.

## Install

```bash
npm install i18n-keyless-node
```

## Quick start

**1. Initialise** (once, at startup):

```js
import { init } from 'i18n-keyless-node';

await init({
  API_KEY: '<YOUR_API_KEY>',
  languages: { primary: 'en', supported: ['en', 'fr', 'es'] },
});
```

**2. Translate:**

```js
import { awaitForTranslationOrThrow } from 'i18n-keyless-node';

const greeting = await awaitForTranslationOrThrow('Hello world', 'fr');
// → "Bonjour le monde"
```

In a request handler, prefer the fallback variant — it never rejects:

```js
import { awaitForTranslationOrFallbackToOriginal } from 'i18n-keyless-node';

const text = await awaitForTranslationOrFallbackToOriginal('Hello world', lang);
// falls back to "Hello world" on failure; the failure is logged
```

**Always `await`** both functions — even the fallback one — to avoid 429 rate limiting.

## Plurals, ordinals and genders

```js
await awaitForTranslationOrThrow('{count} items', 'fr', { count: 3 });
await awaitForTranslationOrThrow('You are {count}th', 'fr', { count: rank, ordinal: true });
await awaitForTranslationOrThrow('They are connected', 'fr', { select: { gender: 'female' } });
```

The API writes one ICU message per language with the forms that language needs. The SDK
resolves the right form with `Intl.PluralRules`.

## Context and replace

```js
await awaitForTranslationOrThrow('Back', 'es', { context: 'navigation button' });
await awaitForTranslationOrThrow('Hello {name}', 'fr', { replace: { '{name}': user.name } });
```

## Documentation

Full reference, namespaces, user-generated content, precompiled bundles:
[docs.i18n-keyless.com](https://docs.i18n-keyless.com)

The main README with every quick start:
[github.com/arnaudambro/i18n-keyless](https://github.com/arnaudambro/i18n-keyless)

## License

MIT

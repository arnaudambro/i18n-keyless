import type { Lang, Translations } from "i18n-keyless-core";

/**
 * Per-request translation scope for SSR.
 *
 * Set by `runWithI18nKeyless` and read by both `getTranslation(...)` and
 * `<I18nKeylessText>` so a single server render resolves in `lang` using `translations`,
 * without touching the process-global store and without leaking across concurrent
 * requests. See docs/SSR.md.
 */
export interface I18nRequestScope {
  lang: Lang;
  translations: Translations;
}

interface AsyncLocalStorageLike<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
}

// The value actually stored in the ALS context: the request scope plus the set of
// translation keys touched during this render. `used` is a plain Set — recording a key is
// a pure Set.add with NO store write / setState, so it can't trigger React's
// "Cannot update a component while rendering" warning.
interface InternalScope extends I18nRequestScope {
  used: Set<string>;
}

// A single AsyncLocalStorage instance, created lazily on the server only. Each
// `run()` creates an isolated store, so the instance is correctly a module singleton.
let als: AsyncLocalStorageLike<InternalScope> | undefined;
let alsInit: Promise<void> | undefined;

async function ensureALS(): Promise<void> {
  // Browser: no request scoping (single user → the store is correct). Also avoids
  // pulling a Node builtin into client bundles.
  if (als || typeof window !== "undefined") {
    return;
  }
  if (!alsInit) {
    alsInit = (async () => {
      try {
        // Variable specifier + ignore hints keep bundlers from trying to resolve a Node
        // builtin into the browser graph. tsc keeps these comments (removeComments=false).
        const specifier = "node:async_hooks";
        const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)) as {
          AsyncLocalStorage: new () => AsyncLocalStorageLike<InternalScope>;
        };
        als = new mod.AsyncLocalStorage();
      } catch {
        // AsyncLocalStorage unavailable (e.g. some edge runtimes). Scoping degrades to a
        // no-op and getTranslation/<T> fall back to the global store. See docs/SSR.md.
      }
    })();
  }
  await alsInit;
}

/**
 * Runs `fn` with a per-request translation scope active. Every `getTranslation(...)`
 * call and every `<I18nKeylessText>` rendered within `fn` — synchronously OR across
 * `await`s/streaming — resolves in `scope.lang` using `scope.translations`, with no
 * change to the global store and full isolation between concurrent requests.
 *
 * Wrap your server render in it and await the result:
 *
 *   const html = await runWithI18nKeyless(
 *     { lang, translations },
 *     () => renderToString(<App />)
 *   );
 *
 * Server-only. In the browser (or where AsyncLocalStorage is unavailable) it simply
 * calls `fn` with no scoping. See docs/SSR.md.
 */
export async function runWithI18nKeyless<R>(scope: I18nRequestScope, fn: () => R): Promise<R> {
  await ensureALS();
  if (!als) {
    return fn();
  }
  // Each run gets its own `used` Set, isolated to this request's async context.
  return als.run({ lang: scope.lang, translations: scope.translations, used: new Set() }, fn);
}

/**
 * Returns the active per-request scope (`{ lang, translations }` with the FULL set
 * available for resolution), or `undefined` when none is set (browser, or outside
 * `runWithI18nKeyless`). Read internally by `getTranslation` and `<I18nKeylessText>`;
 * exported for advanced/server use.
 */
export function getRequestScope(): I18nRequestScope | undefined {
  const s = als?.getStore();
  return s ? { lang: s.lang, translations: s.translations } : undefined;
}

/**
 * Records that `key` (the storage key, i.e. `key` or `key__context`) was used in the
 * current render. No-op outside a `runWithI18nKeyless` scope (browser / SPA). Pure
 * `Set.add` — no store write, no setState. Internal: called by `getTranslation` and
 * `<I18nKeylessText>`.
 */
export function recordUsedKey(key: string): void {
  als?.getStore()?.used.add(key);
}

/**
 * Returns a snapshot containing ONLY the keys used during the current render (∩ the keys
 * actually available in the scope's translations), for serializing a per-page subset into
 * the SSR HTML instead of the full language set. Use it at the serialization site in
 * place of `getRequestScope()` when the language set is large.
 *
 * The full set is still used for resolution during render; only the serialized snapshot is
 * narrowed. Pair it with `init()`'s background full fetch on the client so subsequent
 * client-side navigation has every key. Returns `undefined` outside a scope. See docs/SSR.md.
 */
export function getUsedTranslationsSnapshot(): I18nRequestScope | undefined {
  const s = als?.getStore();
  if (!s) {
    return undefined;
  }
  const translations: Translations = {};
  for (const key of s.used) {
    if (key in s.translations) {
      translations[key] = s.translations[key];
    }
  }
  return { lang: s.lang, translations };
}

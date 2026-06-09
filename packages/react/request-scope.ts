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

// A single AsyncLocalStorage instance, created lazily on the server only. Each
// `run()` creates an isolated store, so the instance is correctly a module singleton.
let als: AsyncLocalStorageLike<I18nRequestScope> | undefined;
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
          AsyncLocalStorage: new () => AsyncLocalStorageLike<I18nRequestScope>;
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
  return als ? als.run(scope, fn) : fn();
}

/**
 * Returns the active per-request scope, or `undefined` when none is set (browser, or
 * outside `runWithI18nKeyless`). Read internally by `getTranslation` and
 * `<I18nKeylessText>`; exported for advanced/server use.
 */
export function getRequestScope(): I18nRequestScope | undefined {
  return als?.getStore();
}

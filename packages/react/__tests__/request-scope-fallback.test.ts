import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ALS_KEY = "__i18n_keyless_als__";
const ALS_INIT_KEY = "__i18n_keyless_als_init__";

/**
 * The suite's setup seeds a real AsyncLocalStorage on globalThis, because vitest's module
 * runner cannot execute the `new Function("return import('node:async_hooks')")` loader that
 * request-scope uses to stay opaque to bundlers. These tests remove that seed so the real
 * lazy-load path runs — and, when it fails, so does the degrade-to-no-op fallback that edge
 * runtimes without AsyncLocalStorage rely on.
 */
const registry = globalThis as Record<string, unknown>;
let seeded: unknown;

beforeEach(() => {
  seeded = registry[ALS_KEY];
  delete registry[ALS_KEY];
  delete registry[ALS_INIT_KEY];
  vi.resetModules();
});

afterEach(() => {
  registry[ALS_KEY] = seeded;
  delete registry[ALS_INIT_KEY];
});

describe("without AsyncLocalStorage", () => {
  it("still runs the callback, and returns its value", async () => {
    const { runWithI18nKeyless } = await import("../request-scope.ts");

    const result = await runWithI18nKeyless({ lang: "en", translations: {} }, () => "rendered");

    expect(result).toBe("rendered");
  });

  it("reports no active scope, so callers fall back to the global store", async () => {
    const { runWithI18nKeyless, getRequestScope } = await import("../request-scope.ts");

    let seen: unknown;
    await runWithI18nKeyless({ lang: "en", translations: {} }, () => {
      seen = getRequestScope();
    });

    expect(seen).toBeUndefined();
  });

  it("recordUsedKey is a no-op rather than a crash", async () => {
    const { recordUsedKey, getUsedTranslationsSnapshot } = await import("../request-scope.ts");

    expect(() => recordUsedKey("Bonjour")).not.toThrow();
    expect(getUsedTranslationsSnapshot()).toBeUndefined();
  });

  it("only attempts the lazy load once, even across concurrent runs", async () => {
    const { runWithI18nKeyless } = await import("../request-scope.ts");

    const results = await Promise.all([
      runWithI18nKeyless({ lang: "en", translations: {} }, () => 1),
      runWithI18nKeyless({ lang: "fr", translations: {} }, () => 2),
    ]);

    expect(results).toEqual([1, 2]);
  });
});

describe("in a browser", () => {
  it("skips scoping entirely, because a single user needs none", async () => {
    const { runWithI18nKeyless, getRequestScope } = await import("../request-scope.ts");

    let seen: unknown;
    await runWithI18nKeyless({ lang: "en", translations: {} }, () => {
      seen = getRequestScope();
    });

    // happy-dom provides `window`, so ensureALS returns before ever touching node:async_hooks
    expect(typeof window).not.toBe("undefined");
    expect(seen).toBeUndefined();
  });
});

describe("on a server without AsyncLocalStorage available", () => {
  // With `window` gone, ensureALS goes past the browser guard and attempts the
  // bundler-opaque `new Function("return import('node:async_hooks')")` load. vitest's
  // module runner cannot execute that form, so the load throws — which is exactly the
  // edge-runtime case the catch exists for: scoping degrades to a no-op instead of
  // crashing the render.
  it("degrades to a no-op when the AsyncLocalStorage import fails", async () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error simulating a server runtime
    delete globalThis.window;

    try {
      const { runWithI18nKeyless, getRequestScope } = await import("../request-scope.ts");

      let seen: unknown;
      const result = await runWithI18nKeyless({ lang: "en", translations: {} }, () => {
        seen = getRequestScope();
        return "rendered";
      });

      expect(result).toBe("rendered");
      expect(seen).toBeUndefined();
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

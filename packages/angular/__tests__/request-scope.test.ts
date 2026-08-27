import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  runWithI18nKeyless,
  getRequestScope,
  recordUsedKey,
  getUsedTranslationsSnapshot,
} from "../request-scope.ts";
import { EN, withoutWindow } from "./helpers.ts";

const ALS_KEY = "__i18n_keyless_als__";
const ALS_INIT_KEY = "__i18n_keyless_alsInit__";
const registry = globalThis as Record<string, unknown>;

// The setup file seeds the ALS slot; these tests take it away to exercise the lazy
// initialisation, then put the seed back so the other suites keep their scoping.
const seeded = registry[ALS_KEY];

beforeEach(() => {
  delete registry[ALS_INIT_KEY];
});

afterEach(() => {
  vi.unstubAllGlobals();
  registry[ALS_KEY] = seeded;
  delete registry[ALS_INIT_KEY];
});

/**
 * Replaces the global `Function` constructor for the duration of `fn`, so the
 * `new Function("return import('node:async_hooks')")` in request-scope.ts becomes
 * deterministic: `importer` is what the constructed function returns.
 */
async function withFakeFunctionConstructor<R>(importer: () => Promise<unknown>, fn: () => Promise<R>): Promise<R> {
  const Original = globalThis.Function;
  function FakeFunction(this: unknown) {
    return importer;
  }
  vi.stubGlobal("Function", FakeFunction);
  try {
    return await fn();
  } finally {
    vi.stubGlobal("Function", Original);
    vi.unstubAllGlobals();
  }
}

describe("outside a scope", () => {
  it("getRequestScope and getUsedTranslationsSnapshot return undefined, recordUsedKey is a no-op", () => {
    expect(getRequestScope()).toBeUndefined();
    expect(getUsedTranslationsSnapshot()).toBeUndefined();
    expect(() => recordUsedKey("Bonjour")).not.toThrow();
  });
});

describe("inside a scope", () => {
  it("snapshots only the used keys the scope can resolve", async () => {
    await runWithI18nKeyless({ lang: "en", translations: EN }, () => {
      recordUsedKey("Bonjour");
      recordUsedKey("Inconnu");
      expect(getUsedTranslationsSnapshot()).toEqual({ lang: "en", translations: { Bonjour: "Hello" } });
    });
  });

  it("isolates concurrent requests", async () => {
    const results = await Promise.all([
      runWithI18nKeyless({ lang: "en", translations: EN }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getRequestScope()?.lang;
      }),
      runWithI18nKeyless({ lang: "es", translations: {} }, async () => {
        return getRequestScope()?.lang;
      }),
    ]);
    expect(results).toEqual(["en", "es"]);
  });
});

describe("lazy AsyncLocalStorage initialisation", () => {
  it("runs fn without scoping in the browser (window defined, no ALS)", async () => {
    delete registry[ALS_KEY];
    const result = await runWithI18nKeyless({ lang: "en", translations: EN }, () => {
      expect(getRequestScope()).toBeUndefined();
      return "rendered";
    });
    expect(result).toBe("rendered");
    expect(registry[ALS_KEY]).toBeUndefined();
  });

  it("loads node:async_hooks once on the server and scopes from then on", async () => {
    delete registry[ALS_KEY];
    const importer = vi.fn(async () => ({ AsyncLocalStorage }));
    await withoutWindow(() =>
      withFakeFunctionConstructor(importer, async () => {
        // two concurrent calls share the same in-flight initialisation
        const [a, b] = await Promise.all([
          runWithI18nKeyless({ lang: "en", translations: EN }, () => getRequestScope()?.lang),
          runWithI18nKeyless({ lang: "es", translations: {} }, () => getRequestScope()?.lang),
        ]);
        expect(a).toBe("en");
        expect(b).toBe("es");
      })
    );
    expect(importer).toHaveBeenCalledTimes(1);
    expect(registry[ALS_KEY]).toBeInstanceOf(AsyncLocalStorage);
  });

  it("degrades to no scoping when node:async_hooks cannot be loaded", async () => {
    delete registry[ALS_KEY];
    const importer = vi.fn(async () => {
      throw new Error("edge runtime");
    });
    const result = await withoutWindow(() =>
      withFakeFunctionConstructor(importer, () =>
        runWithI18nKeyless({ lang: "en", translations: EN }, () => {
          expect(getRequestScope()).toBeUndefined();
          return "plain";
        })
      )
    );
    expect(result).toBe("plain");
    expect(registry[ALS_KEY]).toBeUndefined();
  });
});

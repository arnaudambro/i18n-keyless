import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";

// The same globalThis slots request-scope.ts routes every read and write through (a plain
// string key, realm-independent). setup.ts seeds ALS_KEY; these tests take it away to
// exercise the lazy load and the no-ALS fallback, and put it back afterwards.
const ALS_KEY = "__i18n_keyless_als__";
const ALS_INIT_KEY = "__i18n_keyless_alsInit__";
const registry = globalThis as Record<string, unknown>;

type Scope = typeof import("../request-scope.ts");

let seededAls: unknown;
let scope: Scope;

async function freshScope(): Promise<Scope> {
  vi.resetModules();
  return import("../request-scope.ts");
}

beforeEach(async () => {
  seededAls = registry[ALS_KEY];
  scope = await freshScope();
});

afterEach(() => {
  vi.unstubAllGlobals();
  registry[ALS_KEY] = seededAls;
  delete registry[ALS_INIT_KEY];
});

describe("outside a scope", () => {
  it("getRequestScope and getUsedTranslationsSnapshot return undefined, recordUsedKey is a no-op", () => {
    expect(scope.getRequestScope()).toBeUndefined();
    expect(scope.getUsedTranslationsSnapshot()).toBeUndefined();
    expect(() => scope.recordUsedKey("Hello")).not.toThrow();
  });
});

describe("inside a scope", () => {
  it("exposes the scope and narrows the snapshot to the keys used and known", async () => {
    const result = await scope.runWithI18nKeyless({ lang: "fr", translations: { Hello: "Bonjour", Bye: "Salut" } }, () => {
      scope.recordUsedKey("Hello");
      scope.recordUsedKey("Unknown");
      return { seen: scope.getRequestScope(), used: scope.getUsedTranslationsSnapshot() };
    });
    expect(result.seen).toEqual({ lang: "fr", translations: { Hello: "Bonjour", Bye: "Salut" } });
    expect(result.used).toEqual({ lang: "fr", translations: { Hello: "Bonjour" } });
  });
});

describe("without an AsyncLocalStorage", () => {
  beforeEach(() => {
    delete registry[ALS_KEY];
    delete registry[ALS_INIT_KEY];
  });

  it("in the browser, runWithI18nKeyless calls fn with no scoping and does not load node:async_hooks", async () => {
    // happy-dom: `window` is defined, so the lazy load is skipped entirely.
    const result = await scope.runWithI18nKeyless({ lang: "fr", translations: {} }, () => ({
      seen: scope.getRequestScope(),
      value: 42,
    }));
    expect(result).toEqual({ seen: undefined, value: 42 });
    expect(registry[ALS_KEY]).toBeUndefined();
    expect(registry[ALS_INIT_KEY]).toBeUndefined();
  });

  it("on the server, loads AsyncLocalStorage lazily, once, and scopes every later run", async () => {
    vi.stubGlobal("window", undefined);
    // The lazy load goes through `new Function("return import('node:async_hooks')")`, which
    // vitest's sandboxed module runner cannot execute (see setup.ts). Stand in for the
    // Function constructor with one that returns the real module, so the success path runs.
    const importNode = async () => ({ AsyncLocalStorage });
    vi.stubGlobal(
      "Function",
      class {
        constructor() {
          return importNode;
        }
      }
    );
    const [a, b] = await Promise.all([
      scope.runWithI18nKeyless({ lang: "fr", translations: {} }, () => scope.getRequestScope()?.lang),
      scope.runWithI18nKeyless({ lang: "es", translations: {} }, () => scope.getRequestScope()?.lang),
    ]);
    expect(a).toBe("fr");
    expect(b).toBe("es");
    expect(registry[ALS_KEY]).toBeInstanceOf(AsyncLocalStorage);
    // A later run reuses the instance without loading again.
    expect(await scope.runWithI18nKeyless({ lang: "de", translations: {} }, () => scope.getRequestScope()?.lang)).toBe(
      "de"
    );
  });

  it("on a runtime where node:async_hooks cannot be loaded, scoping degrades to a no-op", async () => {
    vi.stubGlobal("window", undefined);
    // Under vitest the dynamic import inside `new Function` rejects: that is exactly the
    // edge-runtime case the try/catch exists for.
    const result = await scope.runWithI18nKeyless({ lang: "fr", translations: {} }, () => ({
      seen: scope.getRequestScope(),
      used: scope.getUsedTranslationsSnapshot(),
    }));
    expect(result).toEqual({ seen: undefined, used: undefined });
    expect(registry[ALS_KEY]).toBeUndefined();
    // The failed attempt is remembered: a second run does not retry the import.
    const init = registry[ALS_INIT_KEY];
    expect(init).toBeInstanceOf(Promise);
    await scope.runWithI18nKeyless({ lang: "fr", translations: {} }, () => undefined);
    expect(registry[ALS_INIT_KEY]).toBe(init);
  });
});

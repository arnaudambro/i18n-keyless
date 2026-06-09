import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { runWithI18nKeyless, getRequestScope } from "../request-scope";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("runWithI18nKeyless (AsyncLocalStorage request scoping)", () => {
  beforeAll(() => {
    // Simulate the server so the lazy AsyncLocalStorage initializes (vitest runs on Node,
    // so node:async_hooks is available). In a real browser `window` exists → no-op.
    vi.stubGlobal("window", undefined);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("exposes the scope inside the run and nothing outside", async () => {
    expect(getRequestScope()).toBeUndefined();
    const inside = await runWithI18nKeyless(
      { lang: "en", translations: { Bonjour: "Hello" } },
      () => getRequestScope()
    );
    expect(inside).toEqual({ lang: "en", translations: { Bonjour: "Hello" } });
    expect(getRequestScope()).toBeUndefined();
  });

  it("returns the callback's value", async () => {
    const result = await runWithI18nKeyless({ lang: "en", translations: {} }, () => 42);
    expect(result).toBe(42);
  });

  it("keeps the scope across awaits (survives async continuations)", async () => {
    const lang = await runWithI18nKeyless({ lang: "es", translations: {} }, async () => {
      await tick();
      await tick();
      return getRequestScope()?.lang;
    });
    expect(lang).toBe("es");
  });

  it("isolates concurrent scopes (no cross-request leakage)", async () => {
    const results = await Promise.all([
      runWithI18nKeyless({ lang: "en", translations: {} }, async () => {
        await tick();
        return getRequestScope()?.lang;
      }),
      runWithI18nKeyless({ lang: "es", translations: {} }, async () => {
        await tick();
        return getRequestScope()?.lang;
      }),
      runWithI18nKeyless({ lang: "de", translations: {} }, async () => {
        await tick();
        return getRequestScope()?.lang;
      }),
    ]);
    expect(results).toEqual(["en", "es", "de"]);
  });
});

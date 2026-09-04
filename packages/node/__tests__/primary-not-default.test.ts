import { describe, it, expect, vi, beforeEach } from "vitest";

const okAll = (translations: Record<string, Record<string, string>> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "1" },
  error: "",
  message: "",
});

/**
 * Every other suite boots with the primary "fr", the same value the module-level store
 * holds before `init()`. A code path that falls back to that default passes those suites
 * for the wrong reason. Here the app's primary is "en" and the target language is "fr": a
 * fallback to the default gives an answer these tests can see.
 */
async function fresh() {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const service = await import("../service.ts");
  return { service, api: core.api };
}

async function boot(translations: Record<string, Record<string, string>> = {}) {
  const { service, api } = await fresh();
  vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll(translations) as never);
  await service.init({ languages: { primary: "en", supported: ["en", "fr"] }, API_KEY: "k" } as never);
  return { service, api };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a primary language other than the store default", () => {
  it("returns the source text for the primary language and the dictionary for the store's default one", async () => {
    const { service, api } = await boot({ fr: { Hello: "Bonjour" } });
    const spy = vi.spyOn(api, "fetchTranslation");
    await expect(service.awaitForTranslationOrThrow("Hello", "en")).resolves.toBe("Hello");
    await expect(service.awaitForTranslationOrThrow("Hello", "fr")).resolves.toBe("Bonjour");
    await expect(service.awaitForTranslationOrFallbackToOriginal("Hello", "fr")).resolves.toBe("Bonjour");
    expect(spy).not.toHaveBeenCalled();
    expect(service.getSupportedLanguages()).toEqual(["en", "fr"]);
  });

  it("before init, the fallback variant returns the source text and calls nothing", async () => {
    const { service, api } = await fresh();
    const spy = vi.spyOn(api, "fetchTranslation");
    await expect(service.awaitForTranslationOrFallbackToOriginal("Hello", "fr")).resolves.toBe("Hello");
    expect(spy).not.toHaveBeenCalled();
  });
});

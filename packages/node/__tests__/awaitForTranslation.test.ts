import { describe, it, expect, vi, beforeEach } from "vitest";

const okAll = (translations: Record<string, Record<string, string>> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "1" },
  error: "",
  message: "",
});
const okOne = (translation: Record<string, string>, message = "") => ({
  ok: true,
  data: { translation },
  error: "",
  message,
});

/**
 * `service.ts` keeps its store, its config and its in-flight map at module level, so a
 * booted store would leak into the next test. Reset the registry and re-import both the
 * service and core, then spy on that fresh core instance.
 */
async function boot(translations: Record<string, Record<string, string>> = {}, extra = {}) {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const service = await import("../service.ts");
  vi.spyOn(core.api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll(translations));
  await service.init({
    languages: { primary: "fr", supported: ["en", "es"] },
    API_KEY: "k",
    ...extra,
  } as never);
  return { awaitForTranslation: service.awaitForTranslation, api: core.api };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("awaitForTranslation", () => {
  it("returns an empty string for an empty key", async () => {
    const { awaitForTranslation, api } = await boot();
    await expect(awaitForTranslation("", "en")).resolves.toBe("");
  });

  it("returns the key as-is when the target IS the primary language", async () => {
    const { awaitForTranslation, api } = await boot();
    const spy = vi.spyOn(api, "fetchTranslation");
    await expect(awaitForTranslation("Bonjour", "fr")).resolves.toBe("Bonjour");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns a translation already in the store, without calling the API", async () => {
    const { awaitForTranslation, api } = await boot({ en: { Bonjour: "Hello" } });
    const spy = vi.spyOn(api, "fetchTranslation");
    await expect(awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches a missing translation and caches it for next time", async () => {
    const { awaitForTranslation, api } = await boot();
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello" }));

    await expect(awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    await expect(awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");

    expect(spy).toHaveBeenCalledTimes(1); // cached, never re-fetched
  });

  it("looks a key up under its context", async () => {
    const { awaitForTranslation, api } = await boot({ en: { "8 heures__time": "8 AM" } });
    await expect(awaitForTranslation("8 heures", "en", { context: "time" })).resolves.toBe("8 AM");
  });

  it("applies `replace` to a stored translation", async () => {
    const { awaitForTranslation, api } = await boot({ en: { "Hello {{name}}": "Bonjour {{name}}" } });
    await expect(
      awaitForTranslation("Hello {{name}}", "en", { replace: { "{{name}}": "Arnaud" } })
    ).resolves.toBe("Bonjour Arnaud");
  });

  it("applies `replace` to the key when the target is the primary language", async () => {
    const { awaitForTranslation, api } = await boot();
    await expect(
      awaitForTranslation("Hello {{name}}", "fr", { replace: { "{{name}}": "Arnaud" } })
    ).resolves.toBe("Hello Arnaud");
  });

  it("treats regex metacharacters in a placeholder literally", async () => {
    const { awaitForTranslation, api } = await boot();
    await expect(
      awaitForTranslation("Cost: $9.99 (net)", "fr", { replace: { "$9.99 (net)": "10 EUR" } })
    ).resolves.toBe("Cost: 10 EUR");
  });

  it("uses a custom handleTranslate instead of the API", async () => {
    const handleTranslate = vi.fn().mockResolvedValue(okOne({ en: "Hello" }));
    const { awaitForTranslation, api } = await boot({}, { handleTranslate });
    const spy = vi.spyOn(api, "fetchTranslation");

    await expect(awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    expect(handleTranslate).toHaveBeenCalledWith("Bonjour");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the key when a custom handler produces nothing", async () => {
    const handleTranslate = vi.fn().mockResolvedValue(okOne({}));
    const { awaitForTranslation, api } = await boot({}, { handleTranslate });
    await expect(awaitForTranslation("Bonjour", "en")).resolves.toBe("Bonjour");
  });

  it("honours forceTemporary over what is in the store", async () => {
    const { awaitForTranslation, api } = await boot({ en: { Bonjour: "Hello" } });
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "MY OWN" }));

    await expect(
      awaitForTranslation("Bonjour", "en", { forceTemporary: { en: "MY OWN" } })
    ).resolves.toBe("MY OWN");
  });

  it("rejects when the API answers not-ok", async () => {
    const { awaitForTranslation, api } = await boot();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue({
      ok: false,
      error: "quota exceeded",
      data: {},
      message: "",
    });

    await expect(awaitForTranslation("Bonjour", "en")).rejects.toThrow(/quota exceeded/);
  });

  describe("user generated content (originLanguage)", () => {
    it("returns the key as-is when the target IS its origin language", async () => {
      const { awaitForTranslation, api } = await boot();
      const spy = vi.spyOn(api, "fetchTranslation");
      await expect(
        awaitForTranslation("Hola mundo", "es", { originLanguage: "es" })
      ).resolves.toBe("Hola mundo");
      expect(spy).not.toHaveBeenCalled();
    });

    it("still translates UGC into the primary language", async () => {
      const { awaitForTranslation, api } = await boot({ fr: { "Hola mundo": "Bonjour le monde" } });
      await expect(
        awaitForTranslation("Hola mundo", "fr", { originLanguage: "es" })
      ).resolves.toBe("Bonjour le monde");
    });
  });

  describe("unknown language codes", () => {
    it("ignores a language code it does not know", async () => {
      const { awaitForTranslation, api } = await boot();
      vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ klingon: "nuqneH", en: "Hello" }));

      await expect(awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    });

    it("ignores unknown codes coming from the boot fetch", async () => {
      const { awaitForTranslation } = await boot({ klingon: { Bonjour: "nuqneH" }, en: { Bonjour: "Hello" } });

      await expect(awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    });
  });

  describe("the unhandled-rejection Proxy", () => {
    it("logs a fatal message when a caller never handles the rejection", async () => {
      const { awaitForTranslation, api } = await boot();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(api, "fetchTranslation").mockResolvedValue({
        ok: false,
        error: "boom",
        data: {},
        message: "",
      });

      await expect(awaitForTranslation("Bonjour", "en")).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 10));

      expect(error.mock.calls.flat().join(" ")).toMatch(/FATAL: Unhandled rejection/);
    });
  });
});

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
  return {
    awaitForTranslationOrThrow: service.awaitForTranslationOrThrow,
    awaitForTranslationOrFallbackToOriginal: service.awaitForTranslationOrFallbackToOriginal,
    awaitForTranslation: service.awaitForTranslation,
    api: core.api,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("awaitForTranslationOrThrow", () => {
  it("returns an empty string for an empty key", async () => {
    const { awaitForTranslationOrThrow, api } = await boot();
    await expect(awaitForTranslationOrThrow("", "en")).resolves.toBe("");
  });

  it("returns the key as-is when the target IS the primary language", async () => {
    const { awaitForTranslationOrThrow, api } = await boot();
    const spy = vi.spyOn(api, "fetchTranslation");
    await expect(awaitForTranslationOrThrow("Bonjour", "fr")).resolves.toBe("Bonjour");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns a translation already in the store, without calling the API", async () => {
    const { awaitForTranslationOrThrow, api } = await boot({ en: { Bonjour: "Hello" } });
    const spy = vi.spyOn(api, "fetchTranslation");
    await expect(awaitForTranslationOrThrow("Bonjour", "en")).resolves.toBe("Hello");
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches a missing translation and caches it for next time", async () => {
    const { awaitForTranslationOrThrow, api } = await boot();
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello" }));

    await expect(awaitForTranslationOrThrow("Bonjour", "en")).resolves.toBe("Hello");
    await expect(awaitForTranslationOrThrow("Bonjour", "en")).resolves.toBe("Hello");

    expect(spy).toHaveBeenCalledTimes(1); // cached, never re-fetched
  });

  it("looks a key up under its context", async () => {
    const { awaitForTranslationOrThrow, api } = await boot({ en: { "8 heures__time": "8 AM" } });
    await expect(awaitForTranslationOrThrow("8 heures", "en", { context: "time" })).resolves.toBe("8 AM");
  });

  it("applies `replace` to a stored translation", async () => {
    const { awaitForTranslationOrThrow, api } = await boot({ en: { "Hello {{name}}": "Bonjour {{name}}" } });
    await expect(
      awaitForTranslationOrThrow("Hello {{name}}", "en", { replace: { "{{name}}": "Arnaud" } })
    ).resolves.toBe("Bonjour Arnaud");
  });

  it("applies `replace` to the key when the target is the primary language", async () => {
    const { awaitForTranslationOrThrow, api } = await boot();
    await expect(
      awaitForTranslationOrThrow("Hello {{name}}", "fr", { replace: { "{{name}}": "Arnaud" } })
    ).resolves.toBe("Hello Arnaud");
  });

  it("treats regex metacharacters in a placeholder literally", async () => {
    const { awaitForTranslationOrThrow, api } = await boot();
    await expect(
      awaitForTranslationOrThrow("Cost: $9.99 (net)", "fr", { replace: { "$9.99 (net)": "10 EUR" } })
    ).resolves.toBe("Cost: 10 EUR");
  });

  it("uses a custom handleTranslate instead of the API", async () => {
    const handleTranslate = vi.fn().mockResolvedValue(okOne({ en: "Hello" }));
    const { awaitForTranslationOrThrow, api } = await boot({}, { handleTranslate });
    const spy = vi.spyOn(api, "fetchTranslation");

    await expect(awaitForTranslationOrThrow("Bonjour", "en")).resolves.toBe("Hello");
    expect(handleTranslate).toHaveBeenCalledWith("Bonjour");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the key when a custom handler produces nothing", async () => {
    const handleTranslate = vi.fn().mockResolvedValue(okOne({}));
    const { awaitForTranslationOrThrow, api } = await boot({}, { handleTranslate });
    await expect(awaitForTranslationOrThrow("Bonjour", "en")).resolves.toBe("Bonjour");
  });

  it("honours forceTemporary over what is in the store", async () => {
    const { awaitForTranslationOrThrow, api } = await boot({ en: { Bonjour: "Hello" } });
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "MY OWN" }));

    await expect(
      awaitForTranslationOrThrow("Bonjour", "en", { forceTemporary: { en: "MY OWN" } })
    ).resolves.toBe("MY OWN");
  });

  it("rejects when the API answers not-ok", async () => {
    const { awaitForTranslationOrThrow, api } = await boot();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue({
      ok: false,
      error: "quota exceeded",
      data: {},
      message: "",
    });

    await expect(awaitForTranslationOrThrow("Bonjour", "en")).rejects.toThrow(/quota exceeded/);
  });

  describe("user generated content (originLanguage)", () => {
    it("returns the key as-is when the target IS its origin language", async () => {
      const { awaitForTranslationOrThrow, api } = await boot();
      const spy = vi.spyOn(api, "fetchTranslation");
      await expect(
        awaitForTranslationOrThrow("Hola mundo", "es", { originLanguage: "es" })
      ).resolves.toBe("Hola mundo");
      expect(spy).not.toHaveBeenCalled();
    });

    it("still translates UGC into the primary language", async () => {
      const { awaitForTranslationOrThrow, api } = await boot({ fr: { "Hola mundo": "Bonjour le monde" } });
      await expect(
        awaitForTranslationOrThrow("Hola mundo", "fr", { originLanguage: "es" })
      ).resolves.toBe("Bonjour le monde");
    });
  });

  describe("unknown language codes", () => {
    it("ignores a language code it does not know", async () => {
      const { awaitForTranslationOrThrow, api } = await boot();
      vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ klingon: "nuqneH", en: "Hello" }));

      await expect(awaitForTranslationOrThrow("Bonjour", "en")).resolves.toBe("Hello");
    });

    it("ignores unknown codes coming from the boot fetch", async () => {
      const { awaitForTranslationOrThrow } = await boot({ klingon: { Bonjour: "nuqneH" }, en: { Bonjour: "Hello" } });

      await expect(awaitForTranslationOrThrow("Bonjour", "en")).resolves.toBe("Hello");
    });
  });

  describe("the unhandled-rejection Proxy", () => {
    /** Drives one scenario and reports whether Node would have killed the process. */
    async function withUnhandledWatch(run: () => Promise<void>): Promise<unknown[]> {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        await run();
        await new Promise((r) => setTimeout(r, 10));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      return unhandled;
    }

    async function bootFailing() {
      const { awaitForTranslationOrThrow, api } = await boot();
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(api, "fetchTranslation").mockResolvedValue({
        ok: false,
        error: "quota exceeded",
        data: {},
        message: "",
      });
      return awaitForTranslationOrThrow;
    }

    it("crashes the process when the caller ignores the rejection", async () => {
      const awaitForTranslationOrThrow = await bootFailing();

      const unhandled = await withUnhandledWatch(async () => {
        // A floating promise: no await, no catch. This MUST stay fatal — a server that
        // cannot translate has to fail loudly instead of serving the wrong text.
        void awaitForTranslationOrThrow("Bonjour", "en");
      });

      expect(unhandled).toHaveLength(1);
      expect((unhandled[0] as Error).message).toMatch(/FATAL: awaitForTranslationOrThrow failed for key "Bonjour"/);
    });

    it("does not crash the process when the caller handles the rejection", async () => {
      const awaitForTranslationOrThrow = await bootFailing();
      let handled: Error | null = null;

      const unhandled = await withUnhandledWatch(async () => {
        try {
          await awaitForTranslationOrThrow("Bonjour", "en");
        } catch (error) {
          handled = error as Error;
        }
      });

      // The caller wrote exactly what the JSDoc asks for, so their fallback must run.
      expect(handled).toBeInstanceOf(Error);
      expect(unhandled).toEqual([]);
    });

    it("names the key, says what to do, and keeps the original error as the cause", async () => {
      const awaitForTranslationOrThrow = await bootFailing();

      const error = await awaitForTranslationOrThrow("Bonjour", "en").catch((e: Error) => e);

      expect(error.message).toMatch(/FATAL: awaitForTranslationOrThrow failed for key "Bonjour"/);
      expect(error.message).toMatch(/try\/catch/);
      expect(error.message).toMatch(/quota exceeded/);
      expect((error as Error & { cause?: Error }).cause?.message).toBe("quota exceeded");
    });
  });
});

describe("awaitForTranslationOrFallbackToOriginal", () => {
  it("resolves to the hit translation when the store has it", async () => {
    const { awaitForTranslationOrFallbackToOriginal, api } = await boot({ en: { Bonjour: "Hello" } });
    const spy = vi.spyOn(api, "fetchTranslation");
    await expect(awaitForTranslationOrFallbackToOriginal("Bonjour", "en")).resolves.toBe("Hello");
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves to the key when the API answers not-ok, without rejecting", async () => {
    const { awaitForTranslationOrFallbackToOriginal, api } = await boot();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(api, "fetchTranslation").mockResolvedValue({
      ok: false,
      error: "quota exceeded",
      data: {},
      message: "",
    });

    await expect(awaitForTranslationOrFallbackToOriginal("Bonjour", "en")).resolves.toBe("Bonjour");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves to the key when the API request rejects (network error), without rejecting", async () => {
    const { awaitForTranslationOrFallbackToOriginal, api } = await boot();
    vi.spyOn(api, "fetchTranslation").mockRejectedValue(new Error("network down"));

    await expect(awaitForTranslationOrFallbackToOriginal("Bonjour", "en")).resolves.toBe("Bonjour");
  });

  it("applies `replace` to the fallback key", async () => {
    const { awaitForTranslationOrFallbackToOriginal, api } = await boot();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue({
      ok: false,
      error: "quota exceeded",
      data: {},
      message: "",
    });

    await expect(
      awaitForTranslationOrFallbackToOriginal("Hello {{name}}", "en", { replace: { "{{name}}": "Arnaud" } })
    ).resolves.toBe("Hello Arnaud");
  });

  it("returns the key when the API answers ok but without the requested language", async () => {
    const { awaitForTranslationOrFallbackToOriginal, api } = await boot();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ es: "Hola" }));

    await expect(awaitForTranslationOrFallbackToOriginal("Bonjour", "en")).resolves.toBe("Bonjour");
  });

  it("never produces an unhandled rejection when the caller ignores the promise", async () => {
    const { awaitForTranslationOrFallbackToOriginal, api } = await boot();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(api, "fetchTranslation").mockResolvedValue({
      ok: false,
      error: "quota exceeded",
      data: {},
      message: "",
    });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      // A floating promise: no await, no catch. It must never crash the process.
      void awaitForTranslationOrFallbackToOriginal("Bonjour", "en");
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });
});

describe("awaitForTranslation (deprecated)", () => {
  it("is the same function as awaitForTranslationOrThrow", async () => {
    const { awaitForTranslation, awaitForTranslationOrThrow } = await boot();
    expect(awaitForTranslation).toBe(awaitForTranslationOrThrow);
  });
});

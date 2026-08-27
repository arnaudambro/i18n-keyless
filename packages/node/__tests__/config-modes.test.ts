import { describe, it, expect, vi, beforeEach } from "vitest";

const okAll = (translations: Record<string, Record<string, string>> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "1" },
  error: "",
  message: "",
});
const okOne = (translation: Record<string, string>) => ({
  ok: true,
  data: { translation },
  error: "",
  message: "",
});

const languages = { primary: "fr", supported: ["en", "es"] } as const;

/** Fresh module registry per test: the node service keeps its store at module level. */
async function fresh() {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const service = await import("../service.ts");
  return { service, api: core.api };
}

async function load(extra: Record<string, unknown> = {}, boot = okAll()) {
  const { service, api } = await fresh();
  vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(boot as never);
  await service.init({ languages, API_KEY: "k", ...extra } as never);
  return { service, api };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("self-hosted mode (API_URL)", () => {
  it("routes the boot fetch, the POST and the usage flush to the custom URL", async () => {
    const { service, api } = await load({ API_URL: "https://self.hosted" }, okAll({ en: { Vu: "Seen" } }));
    const bulk = vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll() as never);
    const one = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello" }) as never);
    const usage = vi.spyOn(api, "postLastUsedTranslations").mockResolvedValue({ ok: true, message: "" } as never);

    await service.getAllTranslationsForAllLanguages();
    await service.awaitForTranslation("Bonjour", "en");
    await service.sendTranslationsUsageToI18nKeyless();

    expect(bulk.mock.calls[0][0]).toMatch(/^https:\/\/self\.hosted\/translate\/\?last_refresh=/);
    expect(one.mock.calls[0][0]).toBe("https://self.hosted/translate");
    expect(usage.mock.calls[0][0]).toBe("https://self.hosted/translate/last-used-translations");
    for (const call of [bulk.mock.calls[0], one.mock.calls[0], usage.mock.calls[0]]) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer k");
      expect(headers.Version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("accepts an API_URL without an API_KEY, but every call then reports the missing config", async () => {
    const { service, api } = await fresh();
    const bulk = vi.spyOn(api, "fetchAllTranslationsForAllLanguages");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(service.init({ languages, API_URL: "https://self.hosted" } as never)).resolves.toBeTruthy();

    // The boot fetch is skipped: the request builder refuses to run without an API_KEY.
    expect(bulk).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("i18n-keyless: No config found");

    await expect(service.getAllTranslationsForAllLanguages()).resolves.toBeUndefined();
    await expect(service.awaitForTranslation("Bonjour", "en")).rejects.toThrow(
      /config lacks API_KEY and handleTranslate/
    );
  });

  it("does not flush usage without an API_KEY, even with a custom handleTranslate", async () => {
    const { service, api } = await fresh();
    const handleTranslate = vi.fn().mockResolvedValue(okOne({ en: "Hello" }));
    const usage = vi.spyOn(api, "postLastUsedTranslations");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await service.init({ languages, API_URL: "https://self.hosted", handleTranslate } as never);
    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    await expect(service.sendTranslationsUsageToI18nKeyless()).resolves.toBeUndefined();

    expect(usage).not.toHaveBeenCalled();
    expect(error).toHaveBeenLastCalledWith("i18n-keyless: No config found");
  });
});

describe("custom handlers", () => {
  it("accepts handleTranslate + getAllTranslationsForAllLanguages without an API_KEY", async () => {
    const { service, api } = await fresh();
    const bulk = vi.spyOn(api, "fetchAllTranslationsForAllLanguages");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const getAll = vi.fn().mockResolvedValue(okAll({ en: { Bonjour: "Hello" } }));
    const handleTranslate = vi.fn().mockResolvedValue(okOne({ en: "Bye" }));

    await expect(
      service.init({ languages, getAllTranslationsForAllLanguages: getAll, handleTranslate } as never)
    ).resolves.toBeTruthy();

    // Pinned behaviour: the all-languages fetch bails out on the missing API_KEY before it
    // looks at the custom handler, so the boot fetch is skipped in this mode.
    expect(bulk).not.toHaveBeenCalled();
    expect(getAll).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("i18n-keyless: No config found");
    // Translation itself works through the custom handler.
    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Bye");
    expect(handleTranslate).toHaveBeenCalledWith("Bonjour");
  });

  it("calls the custom getAllTranslationsForAllLanguages at boot when an API_KEY is set", async () => {
    const { service, api } = await fresh();
    const bulk = vi.spyOn(api, "fetchAllTranslationsForAllLanguages");
    const getAll = vi.fn().mockResolvedValue(okAll({ en: { Bonjour: "Hello" } }));
    const handleTranslate = vi.fn().mockResolvedValue(okOne({ en: "Bye" }));

    await service.init({ languages, API_KEY: "k", getAllTranslationsForAllLanguages: getAll, handleTranslate } as never);

    expect(bulk).not.toHaveBeenCalled();
    expect(getAll).toHaveBeenCalledTimes(1);
    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    expect(handleTranslate).not.toHaveBeenCalled();
    await expect(service.awaitForTranslation("Au revoir", "en")).resolves.toBe("Bye");
    expect(handleTranslate).toHaveBeenCalledWith("Au revoir");
  });

  it("survives a handleTranslate that resolves to nothing", async () => {
    const handleTranslate = vi.fn().mockResolvedValue(undefined);
    const { service } = await load({ handleTranslate });

    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Bonjour");
    // Nothing was cached, so the handler is asked again on the next call.
    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Bonjour");
    expect(handleTranslate).toHaveBeenCalledTimes(2);
  });

  it("caches only the languages a handleTranslate answered", async () => {
    const handleTranslate = vi.fn().mockResolvedValue(okOne({ en: "Hello", klingon: "nuqneH", es: "" }));
    const { service, api } = await load({ handleTranslate });
    const one = vi.spyOn(api, "fetchTranslation");

    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    await expect(service.awaitForTranslation("Bonjour", "es")).resolves.toBe("Bonjour");

    expect(handleTranslate).toHaveBeenCalledTimes(2);
    expect(one).not.toHaveBeenCalled();
  });

  it("gives a custom sendTranslationsUsage an empty map when only other namespaces were used", async () => {
    const sendTranslationsUsage = vi.fn().mockResolvedValue({ ok: true, message: "" });
    const { service } = await load({ sendTranslationsUsage }, okAll({ en: { Payer: "Pay" } }));

    await service.awaitForTranslation("Payer", "en", { namespace: "checkout" });
    await service.sendTranslationsUsageToI18nKeyless();

    expect(sendTranslationsUsage).toHaveBeenCalledWith({});
  });
});

describe("the usage POST", () => {
  it("surfaces a server message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, api } = await load({}, okAll({ en: { Bonjour: "Hello" } }));
    vi.spyOn(api, "postLastUsedTranslations").mockResolvedValue({ ok: true, message: "please upgrade" } as never);

    await service.awaitForTranslation("Bonjour", "en");
    const res = await service.sendTranslationsUsageToI18nKeyless();

    expect(res).toEqual({ ok: true, message: "please upgrade" });
    expect(warn).toHaveBeenCalledWith("i18n-keyless: ", "please upgrade");
  });

  it("records one usage date per key and does not re-record it the same day", async () => {
    const { service, api } = await load({}, okAll({ en: { Bonjour: "Hello", Bonjour__greeting: "Hi" } }));
    const spy = vi.spyOn(api, "postLastUsedTranslations").mockResolvedValue({ ok: true, message: "" } as never);

    await service.awaitForTranslation("Bonjour", "en");
    await service.awaitForTranslation("Bonjour", "en");
    await service.awaitForTranslation("Bonjour", "en", { context: "greeting" });
    await service.sendTranslationsUsageToI18nKeyless();

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    const today = new Date().toISOString().split("T")[0];
    expect(body.translationsUsageByNamespace.default).toEqual({ Bonjour: today, Bonjour__greeting: today });
  });
});

describe("the translate POST", () => {
  it("rejects with a generic message when the API answers not-ok without an error", async () => {
    const { service, api } = await load();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue({ ok: false } as never);

    await expect(service.awaitForTranslation("Bonjour", "en")).rejects.toThrow(
      /API request failed for key "Bonjour"/
    );
  });

  it("logs the request and the response when debug is on", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { service, api } = await load();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello" }) as never);

    await service.awaitForTranslation("Bonjour", "en", { debug: true });

    const logged = log.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).toContain("Fetching translation from API");
    expect(logged).toContain("API response received");
    expect(logged).toContain("lastUsedAt");
  });

  it("honours the debug flag on a handler that rejects", async () => {
    const handleTranslate = vi.fn().mockRejectedValue(new Error("handler down"));
    const { service } = await load({ handleTranslate });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(service.awaitForTranslation("Bonjour", "en", { debug: true })).rejects.toThrow(/handler down/);

    expect(error.mock.calls.map((c) => String(c[0])).join(" ")).toContain('Error during awaitForTranslationFn for key "Bonjour"');
  });
});

describe("replace", () => {
  it("leaves the text alone for an empty replace map", async () => {
    const { service } = await load({}, okAll({ en: { "Hello {{name}}": "Bonjour {{name}}" } }));
    await expect(service.awaitForTranslation("Hello {{name}}", "en", { replace: {} })).resolves.toBe(
      "Bonjour {{name}}"
    );
  });

  it("keeps a placeholder whose replacement is empty", async () => {
    const { service } = await load({}, okAll({ en: { "Hello {{name}}": "Bonjour {{name}}" } }));
    await expect(service.awaitForTranslation("Hello {{name}}", "en", { replace: { "{{name}}": "" } })).resolves.toBe(
      "Bonjour {{name}}"
    );
  });

  it("applies replace to a translation fetched from the API", async () => {
    const { service, api } = await load();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello {{name}}" }) as never);

    await expect(
      service.awaitForTranslation("Bonjour {{name}}", "en", { replace: { "{{name}}": "Arnaud" } })
    ).resolves.toBe("Hello Arnaud");
  });
});

describe("the unhandled-rejection Proxy with a non-Error rejection", () => {
  it("stringifies the reason into the guided message and keeps it as the cause", async () => {
    const { service, api } = await load();
    vi.spyOn(api, "fetchTranslation").mockRejectedValue("boom");

    const error = await service.awaitForTranslation("Bonjour", "en").catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/FATAL: awaitForTranslation failed for key "Bonjour"/);
    expect(error.message).toMatch(/Original error: boom$/);
    expect((error as Error & { cause?: unknown }).cause).toBe("boom");
  });
});

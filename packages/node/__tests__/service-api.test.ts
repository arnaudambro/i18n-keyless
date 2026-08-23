import { describe, it, expect, vi, beforeEach } from "vitest";

const okAll = (translations: Record<string, Record<string, string>> = {}, message = "") => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "1" },
  error: "",
  message,
});
const okOne = (translation: Record<string, string>) => ({
  ok: true,
  data: { translation },
  error: "",
  message: "",
});

/** Fresh module registry per test: the node service holds its store at module level. */
async function load(extra: Record<string, unknown> = {}, boot = okAll()) {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const service = await import("../service.ts");
  vi.spyOn(core.api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(boot as never);
  await service.init({
    languages: { primary: "fr", supported: ["en", "es"] },
    API_KEY: "k",
    ...extra,
  } as never);
  return { service, api: core.api };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("getAllTranslationsForAllLanguages", () => {
  it("GETs the all-languages endpoint with the delta cursor", async () => {
    const { service, api } = await load();
    const spy = vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll() as never);

    await service.getAllTranslationsForAllLanguages();

    expect(spy.mock.calls[0][0]).toContain("/translate/?last_refresh=");
  });

  it("url-encodes an explicit namespace and omits the default one", async () => {
    const { service, api } = await load();
    const spy = vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll() as never);

    await service.getAllTranslationsForAllLanguages("check out/1");
    expect(spy.mock.calls[0][0]).toContain("namespace=check%20out%2F1");

    await service.getAllTranslationsForAllLanguages("default");
    expect(spy.mock.calls[1][0]).not.toContain("namespace=");
  });

  it("returns nothing when the API answers not-ok", async () => {
    const { service, api } = await load();
    vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue({
      ok: false,
      error: "nope",
      data: {},
      message: "",
    } as never);

    await expect(service.getAllTranslationsForAllLanguages()).resolves.toBeUndefined();
  });

  it("returns nothing when the request throws", async () => {
    const { service, api } = await load();
    vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockRejectedValue(new Error("offline"));
    await expect(service.getAllTranslationsForAllLanguages()).resolves.toBeUndefined();
  });

  it("surfaces a server message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, api } = await load();
    vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(
      okAll({}, "please upgrade") as never
    );

    await service.getAllTranslationsForAllLanguages();

    expect(warn).toHaveBeenCalledWith("i18n-keyless: ", "please upgrade");
  });

  it("uses a custom getAllTranslationsForAllLanguages handler", async () => {
    const handler = vi.fn().mockResolvedValue(okAll({ en: { Bonjour: "Hello" } }));
    const { service, api } = await load({ getAllTranslationsForAllLanguages: handler, handleTranslate: vi.fn() });
    const spy = vi.spyOn(api, "fetchAllTranslationsForAllLanguages");

    const res = await service.getAllTranslationsForAllLanguages();

    expect(res?.data.translations).toEqual({ en: { Bonjour: "Hello" } });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("sendTranslationsUsageToI18nKeyless", () => {
  it("does not POST when no usage was recorded", async () => {
    const { service, api } = await load();
    const spy = vi.spyOn(api, "postLastUsedTranslations");

    await service.sendTranslationsUsageToI18nKeyless();

    expect(spy).not.toHaveBeenCalled();
  });

  it("POSTs the usage recorded by a translation, keyed by namespace", async () => {
    const { service, api } = await load({}, okAll({ en: { Bonjour: "Hello" } }));
    const spy = vi
      .spyOn(api, "postLastUsedTranslations")
      .mockResolvedValue({ ok: true, message: "" } as never);

    await service.awaitForTranslation("Bonjour", "en");
    await service.sendTranslationsUsageToI18nKeyless();

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.primaryLanguage).toBe("fr");
    expect(body.translationsUsageByNamespace.default).toHaveProperty("Bonjour");
  });

  it("records usage under an explicit namespace", async () => {
    const { service, api } = await load({}, okAll({ en: { Payer: "Pay" } }));
    const spy = vi
      .spyOn(api, "postLastUsedTranslations")
      .mockResolvedValue({ ok: true, message: "" } as never);

    await service.awaitForTranslation("Payer", "en", { namespace: "checkout" });
    await service.sendTranslationsUsageToI18nKeyless();

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.translationsUsageByNamespace.checkout).toHaveProperty("Payer");
  });

  it("records NO usage for an unpersisted namespace", async () => {
    const { service, api } = await load({}, okAll({ en: { Hi: "Hi" } }));
    const spy = vi.spyOn(api, "postLastUsedTranslations");

    await service.awaitForTranslation("Hi", "en", { namespace: "chat-1", unpersistedNamespace: true });
    await service.sendTranslationsUsageToI18nKeyless();

    expect(spy).not.toHaveBeenCalled();
  });

  it("returns nothing when the request throws", async () => {
    const { service, api } = await load({}, okAll({ en: { Bonjour: "Hello" } }));
    vi.spyOn(api, "postLastUsedTranslations").mockRejectedValue(new Error("offline"));

    await service.awaitForTranslation("Bonjour", "en");
    await expect(service.sendTranslationsUsageToI18nKeyless()).resolves.toBeUndefined();
  });

  it("uses a custom sendTranslationsUsage handler with the default bucket", async () => {
    const sendTranslationsUsage = vi.fn().mockResolvedValue({ ok: true, message: "" });
    const { service, api } = await load({ sendTranslationsUsage }, okAll({ en: { Bonjour: "Hello" } }));
    const spy = vi.spyOn(api, "postLastUsedTranslations");

    await service.awaitForTranslation("Bonjour", "en");
    await service.sendTranslationsUsageToI18nKeyless();

    expect(sendTranslationsUsage).toHaveBeenCalledWith(expect.objectContaining({ Bonjour: expect.any(String) }));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("in-flight deduplication", () => {
  it("collapses concurrent misses of the same key into one POST", async () => {
    const { service, api } = await load();
    const spy = vi.spyOn(api, "fetchTranslation").mockImplementation(
      () => new Promise((r) => setTimeout(() => r(okOne({ en: "Hello" }) as never), 20))
    );

    const results = await Promise.all([
      service.awaitForTranslation("Bonjour", "en"),
      service.awaitForTranslation("Bonjour", "en"),
      service.awaitForTranslation("Bonjour", "en"),
    ]);

    expect(results).toEqual(["Hello", "Hello", "Hello"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not share an in-flight request across namespaces", async () => {
    const { service, api } = await load();
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello" }) as never);

    await Promise.all([
      service.awaitForTranslation("Payer", "en", { namespace: "checkout" }),
      service.awaitForTranslation("Payer", "en", { namespace: "cart" }),
    ]);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("never shares an in-flight request for a forceTemporary call", async () => {
    const { service, api } = await load();
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "MINE" }) as never);

    await Promise.all([
      service.awaitForTranslation("Bonjour", "en", { forceTemporary: { en: "MINE" } }),
      service.awaitForTranslation("Bonjour", "en", { forceTemporary: { en: "MINE" } }),
    ]);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight entry after a rejection, so a retry still fetches", async () => {
    const { service, api } = await load();
    const spy = vi
      .spyOn(api, "fetchTranslation")
      .mockResolvedValueOnce({ ok: false, error: "boom", data: {}, message: "" } as never)
      .mockResolvedValueOnce(okOne({ en: "Hello" }) as never);

    await expect(service.awaitForTranslation("Bonjour", "en")).rejects.toThrow();
    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("getSupportedLanguages", () => {
  it("returns the configured list", async () => {
    const { service } = await load();
    expect(service.getSupportedLanguages()).toEqual(["en", "es"]);
  });
});

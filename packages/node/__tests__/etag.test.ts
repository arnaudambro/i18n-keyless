import { describe, it, expect, vi, beforeEach } from "vitest";

const okAll = (translations: Record<string, Record<string, string>> = {}, etag?: string) => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "1" },
  error: "",
  message: "",
  ...(etag ? { etag } : {}),
});
const notModified = () => ({ ok: true, notModified: true });

const headersOf = (call: unknown[]) => (call[1] as RequestInit).headers as Record<string, string>;

/** Fresh module registry per test: the ETag map lives at module level in the service. */
async function load(boot = okAll()) {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const service = await import("../service.ts");
  vi.spyOn(core.api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(boot as never);
  await service.init({ languages: { primary: "fr", supported: ["en", "es"] }, API_KEY: "k" });
  return { service, api: core.api };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("ETag handling on the all-languages fetch", () => {
  it("sends no If-None-Match before it has an ETag", async () => {
    const { service, api } = await load();
    const spy = vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll() as never);

    await service.getAllTranslationsForAllLanguages();

    expect(headersOf(spy.mock.calls[0])["If-None-Match"]).toBeUndefined();
    expect(spy.mock.calls[0][0]).toContain("?last_refresh=");
  });

  it("replays the ETag as If-None-Match and drops last_refresh from the URL", async () => {
    const { service, api } = await load();
    const spy = vi
      .spyOn(api, "fetchAllTranslationsForAllLanguages")
      .mockResolvedValueOnce(okAll({}, '"v1"') as never)
      .mockResolvedValueOnce(okAll({}, '"v2"') as never);

    await service.getAllTranslationsForAllLanguages();
    await service.getAllTranslationsForAllLanguages();

    // The URL becomes stable, so shared HTTP caches can hold it.
    expect(spy.mock.calls[1][0]).toBe("https://api.i18n-keyless.com/translate/");
    expect(headersOf(spy.mock.calls[1])["If-None-Match"]).toBe('"v1"');
  });

  it("keeps the namespace in the stable URL", async () => {
    const { service, api } = await load();
    const spy = vi
      .spyOn(api, "fetchAllTranslationsForAllLanguages")
      .mockResolvedValueOnce(okAll({}, '"app-v1"') as never)
      .mockResolvedValueOnce(okAll() as never);

    await service.getAllTranslationsForAllLanguages("app");
    await service.getAllTranslationsForAllLanguages("app");

    expect(spy.mock.calls[1][0]).toBe("https://api.i18n-keyless.com/translate/?namespace=app");
    expect(headersOf(spy.mock.calls[1])["If-None-Match"]).toBe('"app-v1"');
  });

  it("keys the ETag per namespace, so one namespace never answers for another", async () => {
    const { service, api } = await load();
    const spy = vi
      .spyOn(api, "fetchAllTranslationsForAllLanguages")
      .mockResolvedValueOnce(okAll({}, '"app-v1"') as never)
      .mockResolvedValueOnce(okAll() as never);

    await service.getAllTranslationsForAllLanguages("app");
    await service.getAllTranslationsForAllLanguages();

    expect(spy.mock.calls[1][0]).toContain("?last_refresh=");
    expect(headersOf(spy.mock.calls[1])["If-None-Match"]).toBeUndefined();
  });

  it("returns nothing on 304 and keeps the in-memory dictionaries as they are", async () => {
    const { service, api } = await load(okAll({ en: { Bonjour: "Hello" } }, '"v1"'));
    const spy = vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(notModified() as never);

    await expect(service.getAllTranslationsForAllLanguages()).resolves.toBeUndefined();

    expect(headersOf(spy.mock.calls[0])["If-None-Match"]).toBe('"v1"');
    const fetchOne = vi.spyOn(api, "fetchTranslation");
    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    expect(fetchOne).not.toHaveBeenCalled();
  });

  it("does not learn an ETag from a not-ok answer", async () => {
    const { service, api } = await load();
    const spy = vi
      .spyOn(api, "fetchAllTranslationsForAllLanguages")
      .mockResolvedValueOnce({ ok: false, error: "nope", etag: '"bad"' } as never)
      .mockResolvedValueOnce(okAll() as never);

    await service.getAllTranslationsForAllLanguages();
    await service.getAllTranslationsForAllLanguages();

    expect(headersOf(spy.mock.calls[1])["If-None-Match"]).toBeUndefined();
  });
});

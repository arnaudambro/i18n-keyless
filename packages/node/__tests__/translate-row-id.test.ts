import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The API answers `POST /translate` with the stored row. Its flat `id` key is the numeric
 * row id, and `id` is also the ISO code of Indonesian. The SDK used to cache that number
 * as the Indonesian translation (docs/PROTOCOL.md, section 15, item 9).
 */
async function load() {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  return { service: await import("../service.ts"), core };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the translate response row", () => {
  it("does not read the numeric row id as the Indonesian translation", async () => {
    const { service, core } = await load();
    vi.spyOn(core.api, "fetchAllTranslationsForAllLanguages").mockResolvedValue({
      ok: true,
      data: { translations: {}, uniqueId: "server-minted-id", lastRefresh: "1" },
      error: "",
      message: "",
    } as never);
    vi.spyOn(core.api, "fetchTranslation").mockResolvedValue({
      ok: true,
      data: { translation: { id: 4242, en: "Hello", key: "Bonjour" } },
    } as never);

    await service.init({ languages: { primary: "fr", supported: ["en", "id"] }, API_KEY: "k" });
    const en = await service.awaitForTranslation("Bonjour", "en");
    // A second call for Indonesian: a cached "4242" would be served from the store.
    const id = await service.awaitForTranslation("Bonjour", "id");

    expect(en).toBe("Hello");
    expect(id).toBe("Bonjour");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A server has a signal the API can read directly and the client cannot shape: its source
 * IP. So the node SDK sends NO `unique_id` at all — it only declares `sdk: node`, and the
 * API counts the connection.
 *
 * Any id this process invented would be wrong in one direction or the other: a fresh one
 * per boot bills a restarting server as many users, and a pinned one collapses a whole
 * fleet into a single billed user. It used to do the first: the store booted with an empty
 * id, let the API mint one, and only learned it back from the boot GET — so every POST
 * before that, and every usage flush, was billed as another new user.
 */

const okAll = (translations: Record<string, Record<string, string>> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "server-minted-id", lastRefresh: "1" },
  error: "",
  message: "",
});

/** Fresh module registry: the node store and core's runtime label are module state. */
async function load() {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  core.resetUniqueIdState();
  return { service: await import("../service.ts"), core };
}

const headersOf = (call: [string, RequestInit]) => call[1].headers as Record<string, string>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("how a server identifies itself", () => {
  it("declares sdk: node on the boot fetch, and sends no unique_id", async () => {
    const { service, core } = await load();
    const fetchAll = vi.spyOn(core.api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll());

    await service.init({ languages: { primary: "fr", supported: ["en"] }, API_KEY: "k" });

    const headers = headersOf(fetchAll.mock.calls[0] as [string, RequestInit]);
    expect(headers.sdk).toBe("node");
    expect(headers.unique_id).toBeUndefined();
  });

  it("labels every counted route the same way, usage flush included", async () => {
    const { service, core } = await load();
    const fetchAll = vi.spyOn(core.api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll());
    const fetchTranslation = vi.spyOn(core.api, "fetchTranslation").mockResolvedValue({
      ok: true,
      data: { translation: { en: "Hello" } },
    });
    const postUsage = vi.spyOn(core.api, "postLastUsedTranslations").mockResolvedValue({ ok: true, message: "" });

    await service.init({ languages: { primary: "fr", supported: ["en"] }, API_KEY: "k" });
    await service.awaitForTranslation("Bonjour", "en");
    await service.sendTranslationsUsageToI18nKeyless();

    const calls = [
      ...(fetchAll.mock.calls as Array<[string, RequestInit]>),
      ...(fetchTranslation.mock.calls as Array<[string, RequestInit]>),
      ...(postUsage.mock.calls as Array<[string, RequestInit]>),
    ];
    expect(calls.length).toBeGreaterThan(2);
    for (const call of calls) {
      // The usage POST used to carry no identity header at all.
      expect(headersOf(call).sdk).toBe("node");
      expect(headersOf(call).unique_id).toBeUndefined();
    }
  });

  it("never invents an identity, however many times it boots", async () => {
    const seen = new Set<string | undefined>();
    for (let boot = 0; boot < 3; boot++) {
      const { service, core } = await load();
      const fetchAll = vi.spyOn(core.api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll());
      await service.init({ languages: { primary: "fr", supported: ["en"] }, API_KEY: "k" });
      seen.add(headersOf(fetchAll.mock.calls[0] as [string, RequestInit]).unique_id);
    }
    // Three restarts used to be three billed users. Now there is nothing to differ.
    expect([...seen]).toEqual([undefined]);
  });

  it("ignores the id the boot response echoes back", async () => {
    const { service, core } = await load();
    vi.spyOn(core.api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll());
    const fetchTranslation = vi.spyOn(core.api, "fetchTranslation").mockResolvedValue({
      ok: true,
      data: { translation: { en: "Hello" } },
    });

    await service.init({ languages: { primary: "fr", supported: ["en"] }, API_KEY: "k" });
    await service.awaitForTranslation("Bonjour", "en");

    expect(headersOf(fetchTranslation.mock.calls[0] as [string, RequestInit]).unique_id).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The node service goes through core's shared `api` (timeout, retry with backoff, no retry
 * on 4xx). These tests keep the real core code and stub the global `fetch` instead, so the
 * status handling is exercised end to end from `awaitForTranslation` down.
 */

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

type FakeResponse = {
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  headers: { get: (name: string) => string | null };
};

function response(status: number, body: unknown = null, statusText = "", headers: Record<string, string> = {}): FakeResponse {
  return {
    status,
    statusText,
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  };
}

/** A fetch that never answers, but honours the abort signal like the real one. */
function hanging(_url: string, init?: RequestInit): Promise<FakeResponse> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      reject(error);
    });
  });
}

async function boot(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const service = await import("../service.ts");
  await service.init({ languages: { primary: "fr", supported: ["en"] }, API_KEY: "k" });
  return { service, core };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HTTP status handling through the real core api", () => {
  it("boots from a 200 and serves the seeded translation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, okAll({ en: { Bonjour: "Hello" } })));
    const { service } = await boot(fetchMock);

    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/api\.i18n-keyless\.com\/translate\/\?last_refresh=/);
  });

  it("does not retry a 4xx: a wrong key stays wrong", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, okAll()))
      .mockResolvedValue(response(401, null, "Unauthorized"));
    const { service } = await boot(fetchMock);

    await expect(service.awaitForTranslation("Bonjour", "en")).rejects.toThrow(/Unauthorized/);

    // One boot GET, one POST, no retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx and a 429 with backoff, then answers from the 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, okAll()))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200, okOne({ en: "Hello" })));
    const { service, core } = await boot(fetchMock);
    vi.useFakeTimers();

    const pending = service.awaitForTranslation("Bonjour", "en");
    // Backoff: 500ms before attempt 2, 1500ms before attempt 3.
    await vi.advanceTimersByTimeAsync(core.RETRY_DELAYS_MS[0] + core.RETRY_DELAYS_MS[1]);

    await expect(pending).resolves.toBe("Hello");
    expect(fetchMock).toHaveBeenCalledTimes(1 + core.MAX_ATTEMPTS);
  });

  it("gives up after the last attempt and names the HTTP status", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(200, okAll())).mockResolvedValue(response(500));
    const { service, core } = await boot(fetchMock);
    vi.useFakeTimers();

    const outcome = service.awaitForTranslation("Bonjour", "en").catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(core.RETRY_DELAYS_MS[0] + core.RETRY_DELAYS_MS[1]);

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/Original error: HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1 + core.MAX_ATTEMPTS);
  });

  it("aborts a hanging request on the timeout and reports it as such", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(200, okAll())).mockImplementation(hanging);
    const { service, core } = await boot(fetchMock);
    vi.useFakeTimers();

    const outcome = service.awaitForTranslation("Bonjour", "en").catch((e: Error) => e);
    const total = core.MAX_ATTEMPTS * core.TIMEOUT_MS + core.RETRY_DELAYS_MS[0] + core.RETRY_DELAYS_MS[1];
    await vi.advanceTimersByTimeAsync(total);

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/Original error: timeout/);
    // Count the translate POSTs only: the 10s usage flush also fired inside that window.
    const posts = fetchMock.mock.calls.filter((c) => c[0] === "https://api.i18n-keyless.com/translate");
    expect(posts).toHaveLength(core.MAX_ATTEMPTS);
  });

  it("recovers from a network error on the next attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, okAll()))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(response(200, okOne({ en: "Hello" })));
    const { service, core } = await boot(fetchMock);
    vi.useFakeTimers();

    const pending = service.awaitForTranslation("Bonjour", "en");
    await vi.advanceTimersByTimeAsync(core.RETRY_DELAYS_MS[0]);

    await expect(pending).resolves.toBe("Hello");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("learns the ETag from the response header and gets a 304 back", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, okAll({ en: { Bonjour: "Hello" } }), "", { etag: '"v1"' }))
      .mockResolvedValueOnce(response(304));
    const { service } = await boot(fetchMock);

    await expect(service.getAllTranslationsForAllLanguages()).resolves.toBeUndefined();

    const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe('"v1"');
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.i18n-keyless.com/translate/");
    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
  });

  it("swallows a failing usage flush", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, okAll({ en: { Bonjour: "Hello" } })))
      .mockResolvedValue(response(403, null, "Forbidden"));
    const { service } = await boot(fetchMock);

    await service.awaitForTranslation("Bonjour", "en");
    const res = await service.sendTranslationsUsageToI18nKeyless();

    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.i18n-keyless.com/translate/last-used-translations");
  });
});

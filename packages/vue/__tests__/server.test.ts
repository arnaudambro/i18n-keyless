import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { load, mockFetch, baseConfig } from "./helpers.ts";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getServerTranslations", () => {
  it("returns an empty map for the primary language without a fetch", async () => {
    const { fn } = mockFetch();
    const lib = await load();
    lib.useI18nKeyless.setState({ config: baseConfig(lib.createMemoryStorage()) as never });
    expect(await lib.getServerTranslations("fr")).toEqual({});
    expect(fn).not.toHaveBeenCalled();
  });

  it("fetches a language once per process and caches it", async () => {
    const { fn } = mockFetch({ en: { Bonjour: "Hello" } });
    const lib = await load();
    lib.useI18nKeyless.setState({ config: baseConfig(lib.createMemoryStorage()) as never });
    expect(await lib.getServerTranslations("en")).toEqual({ Bonjour: "Hello" });
    expect(await lib.getServerTranslations("en")).toEqual({ Bonjour: "Hello" });
    expect(fn).toHaveBeenCalledTimes(1);
    // the store itself is left alone: the choice of language is per request
    expect(lib.useI18nKeyless.getState().translations).toEqual({});
  });

  it("clearServerTranslationsCache evicts one language or all", async () => {
    const { fn } = mockFetch({ en: { Bonjour: "Hello" }, es: { Bonjour: "Hola" } });
    const lib = await load();
    lib.useI18nKeyless.setState({ config: baseConfig(lib.createMemoryStorage()) as never });
    await lib.getServerTranslations("en");
    await lib.getServerTranslations("es");
    lib.clearServerTranslationsCache("en");
    await lib.getServerTranslations("en");
    await lib.getServerTranslations("es");
    expect(fn).toHaveBeenCalledTimes(3);
    lib.clearServerTranslationsCache();
    await lib.getServerTranslations("es");
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe("getServerTranslations on failure", () => {
  it("returns an empty map when the API refuses the fetch, and retries on the next request", async () => {
    const fn = vi.fn(async () => ({
      status: 400,
      statusText: "Bad Request",
      headers: { get: () => null },
      json: async () => ({ ok: false, error: "Bad Request" }),
    }));
    vi.stubGlobal("fetch", fn);
    const lib = await load();
    lib.useI18nKeyless.setState({ config: baseConfig(lib.createMemoryStorage()) as never });
    expect(await lib.getServerTranslations("en")).toEqual({});
    expect(console.error).toHaveBeenCalled();
    expect(await lib.getServerTranslations("en")).toEqual({});
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// A failure must not pin `{}` for the life of the process: a long-lived server would
// otherwise serve the source strings for every request after one bad fetch at boot.
describe("getServerTranslations does not cache a failure", () => {
  const boot = async (fn: ReturnType<typeof mockFetch>["fn"]) => {
    const lib = await load();
    lib.useI18nKeyless.setState({ config: baseConfig(lib.createMemoryStorage()) as never });
    return { lib, fn };
  };

  // The core retries a network error and a 5xx a few times inside one call, so the fetch
  // double fails for the whole first call and recovers before the second.
  it("retries on the next request after a fetch that kept rejecting (a timeout)", async () => {
    const { fn } = mockFetch({ en: { Bonjour: "Hello" } });
    const good = fn.getMockImplementation()!;
    let down = true;
    fn.mockImplementation(async (...args) => {
      if (down) throw new Error("timeout");
      return good(...args);
    });
    const { lib } = await boot(fn);
    expect(await lib.getServerTranslations("en")).toEqual({});
    const attemptsWhileDown = fn.mock.calls.length;
    expect(attemptsWhileDown).toBeGreaterThan(0);
    down = false;
    expect(await lib.getServerTranslations("en")).toEqual({ Bonjour: "Hello" });
    expect(fn).toHaveBeenCalledTimes(attemptsWhileDown + 1);
    // the success is cached
    await lib.getServerTranslations("en");
    expect(fn).toHaveBeenCalledTimes(attemptsWhileDown + 1);
  });

  it("retries on the next request after a 4xx answer", async () => {
    const { fn } = mockFetch({ en: { Bonjour: "Hello" } });
    fn.mockResolvedValueOnce({
      status: 400,
      statusText: "Bad Request",
      headers: { get: () => null },
      json: async () => ({ ok: false, error: "Bad Request" }),
    } as never);
    const { lib } = await boot(fn);
    expect(await lib.getServerTranslations("en")).toEqual({});
    expect(await lib.getServerTranslations("en")).toEqual({ Bonjour: "Hello" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not cache an empty success (a language with no translation yet)", async () => {
    const { fn } = mockFetch({ en: {} });
    const { lib } = await boot(fn);
    expect(await lib.getServerTranslations("en")).toEqual({});
    expect(await lib.getServerTranslations("en")).toEqual({});
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

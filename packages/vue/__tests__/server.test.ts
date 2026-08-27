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
  it("returns an empty map when the API refuses the fetch, and caches that answer", async () => {
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
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

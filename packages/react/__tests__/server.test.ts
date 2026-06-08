import { describe, it, expect, vi, beforeEach } from "vitest";
import * as core from "i18n-keyless-core";

// Controllable store returned by useI18nKeyless.getState() inside server.ts.
const mockStore = {
  uniqueId: null,
  lastRefresh: null,
  currentLanguage: "fr",
  translations: {},
  config: {
    API_KEY: "test-key",
    languages: { primary: "fr", supported: ["fr", "en"] },
  },
};

vi.mock("../store", () => ({
  useI18nKeyless: { getState: () => mockStore },
}));

// Keep all of core real except the network call.
vi.mock("i18n-keyless-core", async (importOriginal) => {
  const actual = await importOriginal<typeof core>();
  return { ...actual, getAllTranslationsFromLanguage: vi.fn() };
});

import { getServerTranslations, clearServerTranslationsCache } from "../server";

const fetchMock = core.getAllTranslationsFromLanguage as unknown as ReturnType<typeof vi.fn>;

describe("getServerTranslations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearServerTranslationsCache();
    fetchMock.mockResolvedValue({ ok: true, data: { translations: { Hello: "Hello-en" } } });
  });

  it("returns an empty map for the primary language without fetching", async () => {
    const result = await getServerTranslations("fr");
    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches translations for a non-primary language", async () => {
    const result = await getServerTranslations("en");
    expect(result).toEqual({ Hello: "Hello-en" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches per language across calls (fetches at most once per process)", async () => {
    await getServerTranslations("en");
    await getServerTranslations("en");
    await getServerTranslations("en");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after the cache is cleared", async () => {
    await getServerTranslations("en");
    clearServerTranslationsCache("en");
    await getServerTranslations("en");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an empty map (and caches it) when the fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(undefined);
    const result = await getServerTranslations("en");
    expect(result).toEqual({});
  });
});

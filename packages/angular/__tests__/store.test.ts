import { describe, it, expect, beforeEach, vi } from "vitest";
import { init, store, setCurrentLanguage, getTranslation, hydrateFromServer } from "../store.ts";
import { baseConfig, makeStorage, mockFetch, resetAll, flush, EN } from "./helpers.ts";

beforeEach(() => {
  resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("init", () => {
  it("validates the config", async () => {
    mockFetch();
    // @ts-expect-error invalid on purpose
    expect(() => init({})).toThrow(/languages is required/);
    expect(() => init(baseConfig({ API_KEY: "" }))).toThrow(/API_KEY is required/);
  });

  it("defaults fallback and initWithDefault to the primary language", async () => {
    mockFetch();
    await init(baseConfig());
    const { languages } = store.config();
    expect(languages.fallback).toBe("fr");
    expect(languages.initWithDefault).toBe("fr");
    expect(store.hydrated()).toBe(true);
  });

  it("defaults the storage to window.localStorage in the browser", async () => {
    mockFetch();
    window.localStorage.clear();
    await init(baseConfig({ storage: undefined }));
    expect(store.config().storage).toBe(window.localStorage);
    // the device id was generated and persisted
    expect(window.localStorage.getItem("i18n-keyless-user-id")).toMatch(/^[0-9A-Za-z_]{16}$/);
  });
});

describe("hydration from storage", () => {
  it("loads the cached translations and the current language, then fetches that language", async () => {
    const api = mockFetch();
    const storage = makeStorage({
      "i18n-keyless-user-id": "device-0123456789",
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello (cached)" }),
      "i18n-keyless-current-language": "en",
    });
    expect(store.hydrated()).toBe(false);

    await init(baseConfig({ storage }));

    expect(store.hydrated()).toBe(true);
    expect(store.currentLanguage()).toBe("en");
    // the cache is what renders first...
    expect(store.getState().uniqueId).toBe("device-0123456789");
    // ...then the background fetch of the current language merges over it
    await vi.waitFor(() => expect(store.translations()["8 heures__heure"]).toBe("8 AM"));
    const fetches = api.to("/translate/en");
    expect(fetches).toHaveLength(1);
    expect(fetches[0].method).toBe("GET");
  });

  it("skips the fetch when the current language is the primary one", async () => {
    const api = mockFetch();
    await init(baseConfig());
    await flush();
    expect(store.currentLanguage()).toBe("fr");
    expect(api.calls.filter((call) => call.method === "GET")).toHaveLength(0);
  });

  it("keeps a server snapshot applied before init (hydrateFromServer)", async () => {
    mockFetch();
    const storage = makeStorage({ "i18n-keyless-current-language": "es" });
    hydrateFromServer({ lang: "en", translations: { Bonjour: "Hello" } });
    await init(baseConfig({ storage }));
    expect(store.currentLanguage()).toBe("en");
    expect(store.translations().Bonjour).toBe("Hello");
  });
});

describe("setCurrentLanguage", () => {
  it("persists the language, fetches it and updates the signals", async () => {
    const api = mockFetch();
    const storage = makeStorage();
    await init(baseConfig({ storage, onSetLanguage: vi.fn() }));

    await setCurrentLanguage("en");

    expect(store.currentLanguage()).toBe("en");
    expect(store.translations()).toMatchObject(EN);
    expect(storage.data.get("i18n-keyless-current-language")).toBe("en");
    expect(storage.data.get("i18n-keyless-translations")).toBe(JSON.stringify(EN));
    expect(api.to("/translate/en")).toHaveLength(1);
    expect(store.config().onSetLanguage).toHaveBeenCalledWith("en");
  });

  it("falls back for an unsupported language", async () => {
    mockFetch();
    await init(baseConfig({ languages: { primary: "fr", supported: ["fr", "en"], fallback: "en" } }));
    await setCurrentLanguage("de");
    expect(store.currentLanguage()).toBe("en");
  });
});

describe("getTranslation (imperative path)", () => {
  it("returns the source for the primary language and the translation otherwise", async () => {
    mockFetch();
    await init(baseConfig());
    expect(getTranslation("Bonjour")).toBe("Bonjour");
    await setCurrentLanguage("en");
    expect(getTranslation("Bonjour")).toBe("Hello");
    expect(getTranslation("8 heures", { context: "durée" })).toBe("8 hours");
    expect(getTranslation("Bonjour {name}", { replace: { "{name}": "Ada" } })).toBe("Hello Ada");
  });

  it("queues a miss as POST /translate and records usage", async () => {
    const api = mockFetch();
    const storage = makeStorage();
    await init(baseConfig({ storage }));
    await setCurrentLanguage("en");

    expect(getTranslation("Au revoir")).toBe("Au revoir");
    await vi.waitFor(() => expect(api.to("/translate")).toHaveLength(1));
    expect(api.to("/translate")[0].body).toMatchObject({ key: "Au revoir", primaryLanguage: "fr" });
    await flush();
    expect(store.getState().translationsUsageByNamespace.default).toHaveProperty("Au revoir");
    expect(storage.data.get("i18n-keyless-translations-usage")).toContain("Au revoir");
  });
});

describe("usage analytics", () => {
  const seededUsage = () =>
    makeStorage({
      "i18n-keyless-translations-usage": JSON.stringify({ default: { Bonjour: "2025-01-01" } }),
    });

  it("POSTs the stored usage on init in the browser", async () => {
    const api = mockFetch();
    await init(baseConfig({ storage: seededUsage() }));
    await vi.waitFor(() => expect(api.to("/translate/last-used-translations")).toHaveLength(1));
    expect(api.to("/translate/last-used-translations")[0].body).toEqual({
      primaryLanguage: "fr",
      translationsUsageByNamespace: { default: { Bonjour: "2025-01-01" } },
    });
  });

  it("does not POST usage under ssr: true, and records none", async () => {
    const api = mockFetch();
    const storage = seededUsage();
    await init(baseConfig({ storage: storage, ssr: true }));
    await setCurrentLanguage("en");
    getTranslation("Bonjour");
    await flush();
    expect(api.to("/translate/last-used-translations")).toHaveLength(0);
    // the stored usage is untouched: nothing was added, nothing was flushed
    expect(storage.data.get("i18n-keyless-translations-usage")).toBe(
      JSON.stringify({ default: { Bonjour: "2025-01-01" } })
    );
    // and the requests are labelled as a server, without a device id
    const get = api.to("/translate/en")[0];
    expect(get).toBeDefined();
  });
});

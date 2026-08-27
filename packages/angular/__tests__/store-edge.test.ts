import { describe, it, expect, beforeEach, vi } from "vitest";
import type { I18nKeylessResponse, Translations } from "i18n-keyless-core";
import {
  init,
  store,
  setCurrentLanguage,
  getTranslation,
  hydrateFromServer,
  whenHydrated,
  clearI18nKeylessStorageAndStore,
} from "../store.ts";
import { baseConfig, makeStorage, mockFetch, resetAll, flush, EN } from "./helpers.ts";

const ok = (translations: Translations, extra: Partial<I18nKeylessResponse["data"]> = {}): I18nKeylessResponse => ({
  ok: true,
  // `uniqueId` / `lastRefresh` are optional on the wire: the store must cope without them.
  data: { translations, ...extra } as I18nKeylessResponse["data"],
  error: "",
  message: "",
});

/** A `fetch` that answers every call with a 400: the SDK reports the error and does not retry. */
function failingFetch() {
  const fetchMock = vi.fn(async () => ({
    status: 400,
    statusText: "Bad Request",
    headers: { get: () => null },
    json: async () => ({}),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const logs = () => (console.log as ReturnType<typeof vi.fn>).mock.calls.map((call) => call.join(" "));

beforeEach(() => {
  resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("init validation and defaults", () => {
  it("requires a primary language", () => {
    mockFetch();
    // @ts-expect-error invalid on purpose
    expect(() => init({ API_KEY: "k", languages: { supported: ["fr"] } })).toThrow(/primary is required/);
  });

  it("requires an API_KEY, an API_URL or the two handlers", () => {
    mockFetch();
    const languages = { primary: "fr" as const, supported: ["fr" as const] };
    expect(() => init({ API_KEY: "", languages })).toThrow(/didn't provide an API_KEY nor an API_URL/);
    // the handlers satisfy the first check; the API_KEY is still mandatory
    expect(() =>
      init({
        API_KEY: "",
        languages,
        handleTranslate: async () => ({ ok: true, data: { translation: {} }, error: "", message: "" }),
        getAllTranslations: async () => ok({}),
      })
    ).toThrow(/API_KEY is required/);
  });

  it("adds initWithDefault to the supported languages and starts in it", async () => {
    const api = mockFetch();
    await init(baseConfig({ languages: { primary: "fr", supported: ["fr", "en"], initWithDefault: "es" } }));
    expect(store.config().languages.supported).toEqual(["fr", "en", "es"]);
    expect(store.currentLanguage()).toBe("es");
    await vi.waitFor(() => expect(api.to("/translate/es")).toHaveLength(1));
  });

  it("keeps addMissingTranslations: false, defaults it to true, and calls onInit", async () => {
    mockFetch();
    const onInit = vi.fn();
    await init(baseConfig({ addMissingTranslations: false, onInit }));
    expect(store.config().addMissingTranslations).toBe(false);
    expect(onInit).toHaveBeenCalledWith("fr");
    resetAll();
    mockFetch();
    await init(baseConfig());
    expect(store.config().addMissingTranslations).toBe(true);
  });

  it("whenHydrated resolves immediately before init", async () => {
    await expect(whenHydrated()).resolves.toBeUndefined();
  });
});

describe("hydration edge paths", () => {
  it("restores the delta cursors and the origin namespaces, then refetches the origin namespaces", async () => {
    const api = mockFetch();
    const storage = makeStorage({
      "i18n-keyless-namespaces": JSON.stringify(["default", "shop"]),
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello (cached)" }),
      "i18n-keyless-last-refresh": "2025-01-01",
      "i18n-keyless-origin-namespaces": JSON.stringify(["ugc"]),
      "i18n-keyless-translations-usage": JSON.stringify({}),
    });
    await init(baseConfig({ storage, debug: true }));
    const state = store.getState();
    // the cursors were read from storage, then reset by the initial setLanguage (full fetch)
    expect(storage.getItem).toHaveBeenCalledWith("i18n-keyless-last-refresh");
    expect(state.lastRefresh).toBeNull();
    expect(state.lastRefreshByNamespace).toEqual({});
    // "shop" had no cached slice: only the loaded namespaces are known
    expect(state.namespaces).toEqual(["default"]);
    expect(state.originNamespaces).toEqual(["ugc"]);
    expect(state.translationsUsageByNamespace).toEqual({});
    // the primary language needs no fetch, except for the namespaces holding UGC keys
    await vi.waitFor(() => expect(api.to("/translate/fr")).toHaveLength(1));
    expect(api.to("/translate/fr")[0].url).toContain("namespace=ugc");
    expect(logs()).toEqual(expect.arrayContaining([expect.stringContaining("origin namespaces")]));
  });

  it("discards a legacy flat usage map", async () => {
    mockFetch();
    const storage = makeStorage({ "i18n-keyless-translations-usage": JSON.stringify({ Bonjour: "2025-01-01" }) });
    await init(baseConfig({ storage, debug: true }));
    expect(store.getState().translationsUsageByNamespace).toEqual({});
    expect(logs()).toEqual(expect.arrayContaining([expect.stringContaining("discarding legacy flat usage")]));
  });

  it("logs the empty-storage paths in debug mode", async () => {
    mockFetch();
    await init(baseConfig({ debug: true }));
    expect(logs()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("_hydrate: uniqueId"),
        expect.stringContaining("_hydrate: no translations"),
        expect.stringContaining("_hydrate: no translations usage"),
        expect.stringContaining("_hydrate: no current language"),
      ])
    );
  });

  it("logs the cached-storage paths in debug mode", async () => {
    mockFetch();
    const storage = makeStorage({
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello" }),
      "i18n-keyless-current-language": "en",
      "i18n-keyless-translations-usage": JSON.stringify({ default: { Bonjour: "2025-01-01" } }),
    });
    await init(baseConfig({ storage, debug: true }));
    expect(logs()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("_hydrate [object Object]"),
        expect.stringContaining("_hydrate: translations usage"),
        expect.stringContaining("_hydrate en"),
      ])
    );
  });

  it("skipCurrentLanguageHydration ignores the stored language", async () => {
    mockFetch();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });
    await init(
      baseConfig({
        storage,
        debug: true,
        languages: { primary: "fr", supported: ["fr", "en"], skipCurrentLanguageHydration: true },
      })
    );
    expect(store.currentLanguage()).toBe("fr");
    expect(logs()).toEqual(expect.arrayContaining([expect.stringContaining("skip current language hydration")]));
  });

  it("keeps the server-seeded language (debug) and hydrateFromServer ignores an empty snapshot", async () => {
    mockFetch();
    hydrateFromServer();
    hydrateFromServer({});
    expect(store.currentLanguage()).toBe("fr");
    hydrateFromServer({ lang: "en" });
    expect(store.currentLanguage()).toBe("en");
    expect(store.translations()).toEqual({});
    const storage = makeStorage({ "i18n-keyless-current-language": "es" });
    await init(baseConfig({ storage, debug: true }));
    expect(store.currentLanguage()).toBe("en");
    expect(logs()).toEqual(expect.arrayContaining([expect.stringContaining("keeping server-seeded language")]));
  });

  it("an empty namespaces index falls back to the default namespace", async () => {
    mockFetch();
    const storage = makeStorage({
      "i18n-keyless-namespaces": "[]",
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello (cached)" }),
    });
    await init(baseConfig({ storage }));
    expect(store.translations()).toEqual({ Bonjour: "Hello (cached)" });
  });

  it("runs as a server runtime under ssr: true, without a device id", async () => {
    mockFetch();
    const storage = makeStorage({ "i18n-keyless-user-id": "device-0123456789" });
    await init(baseConfig({ storage, ssr: true, debug: true }));
    expect(store.getState().uniqueId).toBeNull();
    expect(storage.getItem).not.toHaveBeenCalledWith("i18n-keyless-user-id");
    expect(logs()).toEqual(expect.arrayContaining([expect.stringContaining("server runtime, no device id")]));
  });

  it("survives a storage that throws on read", async () => {
    mockFetch();
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    await init(baseConfig({ storage }));
    expect(store.hydrated()).toBe(true);
    expect(store.currentLanguage()).toBe("fr");
    // a fresh device id was generated and written
    expect(storage.setItem).toHaveBeenCalledWith("i18n-keyless-user-id", expect.stringMatching(/^[0-9A-Za-z_]{16}$/));
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error getting item:", expect.any(Error));
  });
});

describe("setLanguage", () => {
  it("throws before init", async () => {
    await expect(store.setLanguage("en")).rejects.toThrow(/config is not initialized setting language/);
  });

  it("logs the fallback and the switch in debug mode", async () => {
    mockFetch();
    await init(baseConfig({ debug: true, languages: { primary: "fr", supported: ["fr", "en"], fallback: "en" } }));
    await setCurrentLanguage("de");
    expect(store.currentLanguage()).toBe("en");
    expect(logs()).toEqual(expect.arrayContaining([expect.stringContaining("is not supported, fallback to en")]));
    await setCurrentLanguage("en");
    expect(logs()).toEqual(expect.arrayContaining([expect.stringContaining("setLanguage en")]));
  });
});

describe("setTranslations", () => {
  it("ignores a failed response and validates the store", () => {
    store.setTranslations(undefined, "default");
    expect(store.translations()).toEqual({});
    expect(() => store.setTranslations(ok({ Bonjour: "Hello" }), "default")).toThrow(
      /config is not initialized setting translations/
    );
    store.setState({ config: baseConfig({ storage: undefined }) });
    expect(() => store.setTranslations(ok({ Bonjour: "Hello" }), "default")).toThrow(
      /storage is not initialized setting translations/
    );
  });

  it("keeps the cache when the fetch fails (translate-on-miss failure)", async () => {
    failingFetch();
    const storage = makeStorage({
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello (cached)" }),
      "i18n-keyless-current-language": "en",
    });
    await init(baseConfig({ storage }));
    await flush();
    expect(store.translations()).toEqual({ Bonjour: "Hello (cached)" });
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: fetch all translations error:", expect.any(Error));

    // a miss whose POST fails, then whose bulk fetch fails: nothing throws, nothing changes
    expect(getTranslation("Au revoir")).toBe("Au revoir");
    await flush(6);
    expect(store.translations()).toEqual({ Bonjour: "Hello (cached)" });
    expect(store.hydrated()).toBe(true);
  });

  it("adopts the server id only when the device has none", async () => {
    mockFetch();
    const storage = makeStorage();
    await init(baseConfig({ storage }));
    const generated = store.getState().uniqueId;
    expect(generated).toMatch(/^[0-9A-Za-z_]{16}$/);

    // the local id wins
    store.setTranslations(ok({}, { uniqueId: "srv-0123456789ab" }), "default");
    expect(store.getState().uniqueId).toBe(generated);

    // no local id: an invalid server id is refused, a valid one is adopted and persisted
    store.setState({ uniqueId: null });
    store.setTranslations(ok({}, { uniqueId: "bad\nid" }), "default");
    expect(store.getState().uniqueId).toBeNull();
    store.setTranslations(ok({}, { uniqueId: "srv-0123456789ab" }), "default");
    expect(store.getState().uniqueId).toBe("srv-0123456789ab");
    expect(storage.data.get("i18n-keyless-user-id")).toBe("srv-0123456789ab");
  });

  it("keeps an unpersisted namespace in memory only", async () => {
    mockFetch();
    const storage = makeStorage();
    await init(baseConfig({ storage }));
    await setCurrentLanguage("en");

    store.setTranslations(ok({ Temp: "Tmp" }), "tmp", true);
    store.setTranslations(ok({ Temp2: "Tmp2" }, { lastRefresh: "2025-02-02" }), "tmp", true);
    const state = store.getState();
    expect(state.translations).toMatchObject({ ...EN, Temp: "Tmp", Temp2: "Tmp2" });
    expect(state.translationsByNamespace.tmp).toEqual({ Temp: "Tmp", Temp2: "Tmp2" });
    expect(state.namespaces).toEqual(["default", "tmp"]);
    expect(state.unpersistedNamespaces).toEqual(["tmp"]);
    expect(state.lastRefreshByNamespace.tmp).toBe("2025-02-02");
    expect(storage.data.has("i18n-keyless-translations__tmp")).toBe(false);
    expect(storage.data.has("i18n-keyless-last-refresh__tmp")).toBe(false);
    expect(storage.data.get("i18n-keyless-namespaces")).toBe(JSON.stringify(["default"]));

    // a second persisted namespace merges over its previous slice and enters the index
    store.setTranslations(ok({ Cart: "Cart" }), "shop");
    store.setTranslations(ok({ Cart: "Basket" }), "shop");
    expect(store.getState().translationsByNamespace.shop).toEqual({ Cart: "Basket" });
    expect(storage.data.get("i18n-keyless-namespaces")).toBe(JSON.stringify(["default", "shop"]));

    // switching language refetches every known namespace, resets the persisted cursors only
    const api = mockFetch();
    await setCurrentLanguage("es");
    const urls = api.to("/translate/es").map((call) => call.url);
    expect(urls).toHaveLength(3);
    expect(urls.some((url) => url.includes("namespace=tmp"))).toBe(true);
    expect(urls.some((url) => url.includes("namespace=shop"))).toBe(true);
    expect(storage.data.has("i18n-keyless-last-refresh__tmp")).toBe(false);
    expect(storage.data.get("i18n-keyless-last-refresh__shop")).toBe("2025-01-01");
  });

  it("fetches a miss in an unpersisted namespace in memory only and records no usage for it", async () => {
    const api = mockFetch({ en: {} });
    const storage = makeStorage();
    await init(baseConfig({ storage }));
    await setCurrentLanguage("en");

    expect(getTranslation("Temp", { namespace: "tmp", unpersistedNamespace: true })).toBe("Temp");
    await vi.waitFor(() => expect(api.to("/translate")).toHaveLength(1));
    expect(api.to("/translate")[0].body).toMatchObject({ key: "Temp", namespace: "tmp" });
    await vi.waitFor(() => expect(api.to("/translate/en").some((call) => call.url.includes("namespace=tmp"))).toBe(true));
    await flush();
    expect(store.getState().unpersistedNamespaces).toEqual(["tmp"]);
    expect(store.getState().translationsUsageByNamespace.tmp).toBeUndefined();
    expect(storage.data.has("i18n-keyless-translations__tmp")).toBe(false);
  });
});

describe("origin namespaces (UGC)", () => {
  it("registers the namespace of a UGC key and persists the index for persisted namespaces", async () => {
    const api = mockFetch();
    const storage = makeStorage();
    await init(baseConfig({ storage }));

    getTranslation("Hola", { originLanguage: "es" });
    await flush();
    expect(store.getState().originNamespaces).toEqual(["default"]);
    expect(storage.data.get("i18n-keyless-origin-namespaces")).toBe(JSON.stringify(["default"]));
    await vi.waitFor(() => expect(api.to("/translate")).toHaveLength(1));
    expect(api.to("/translate")[0].body).toMatchObject({ key: "Hola", originLanguage: "es" });

    getTranslation("Adiós", { originLanguage: "es", namespace: "ugc", unpersistedNamespace: true });
    await flush();
    expect(store.getState().originNamespaces).toEqual(["default", "ugc"]);
    expect(storage.data.get("i18n-keyless-origin-namespaces")).toBe(JSON.stringify(["default"]));

    // already registered: no change
    store.registerOriginNamespace("default");
    expect(store.getState().originNamespaces).toEqual(["default", "ugc"]);

    // without a storage: memory only
    store.setState({ config: { ...store.config(), storage: undefined } });
    store.registerOriginNamespace("nostorage");
    expect(store.getState().originNamespaces).toEqual(["default", "ugc", "nostorage"]);
    await store.setTranslationUsage("Hola");
    expect(store.getState().translationsUsageByNamespace.default).toHaveProperty("Hola");
  });
});

describe("usage analytics edge paths", () => {
  it("keeps the usage when the POST fails", async () => {
    failingFetch();
    const storage = makeStorage({
      "i18n-keyless-translations-usage": JSON.stringify({ default: { Bonjour: "2025-01-01" } }),
    });
    await init(baseConfig({ storage }));
    await flush(6);
    expect(store.getState().translationsUsageByNamespace).toEqual({ default: { Bonjour: "2025-01-01" } });
    expect(storage.data.get("i18n-keyless-translations-usage")).toBe(
      JSON.stringify({ default: { Bonjour: "2025-01-01" } })
    );
  });
});

describe("clearI18nKeylessStorageAndStore", () => {
  it("wipes the cache, keeps the device id and resets the store", async () => {
    mockFetch();
    const storage = makeStorage();
    await init(baseConfig({ storage }));
    await setCurrentLanguage("en");
    const deviceId = storage.data.get("i18n-keyless-user-id");
    expect(storage.data.get("i18n-keyless-translations")).toBeDefined();

    await clearI18nKeylessStorageAndStore();

    expect(storage.data.get("i18n-keyless-user-id")).toBe(deviceId);
    expect(storage.data.has("i18n-keyless-translations")).toBe(false);
    expect(storage.data.has("i18n-keyless-current-language")).toBe(false);
    expect(storage.data.has("i18n-keyless-namespaces")).toBe(false);
    expect(store.currentLanguage()).toBe("fr");
    expect(store.translations()).toEqual({});
    expect(store.hydrated()).toBe(false);
    expect(store.config().API_KEY).toBe("");
    await expect(whenHydrated()).resolves.toBeUndefined();

    // from the reset state (no storage) it is a no-op on storage
    await expect(clearI18nKeylessStorageAndStore()).resolves.toBeUndefined();
  });
});

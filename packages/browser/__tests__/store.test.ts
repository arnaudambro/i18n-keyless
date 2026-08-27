import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetUniqueIdState } from "i18n-keyless-core";
import {
  init,
  getState,
  setState,
  subscribe,
  getTranslation,
  resolveTranslation,
  watchTranslation,
  setCurrentLanguage,
  getCurrentLanguage,
  getSupportedLanguages,
  clearI18nKeylessStorageAndStore,
  resetStore,
} from "../store.ts";
import { storeKeys } from "../utils.ts";
import type { I18nConfig } from "../types.ts";
import { makeStorage, mockFetch, okResponse, flush, baseConfig, silenceConsole } from "./helpers.ts";

beforeEach(() => {
  resetStore();
  resetUniqueIdState();
  silenceConsole();
  window.localStorage.clear();
});

afterEach(async () => {
  await flush();
  vi.restoreAllMocks();
});

describe("init validation", () => {
  it("requires languages", async () => {
    // @ts-expect-error invalid on purpose
    await expect(init({})).rejects.toThrow(/languages is required/);
  });

  it("requires a primary language", async () => {
    // @ts-expect-error invalid on purpose
    await expect(init({ languages: { supported: ["en"] } })).rejects.toThrow(/primary is required/);
  });

  it("requires an API_KEY", async () => {
    await expect(init(baseConfig(makeStorage(), { API_KEY: undefined as never }))).rejects.toThrow(
      /you didn't provide an API_KEY/
    );
  });

  it("defaults initWithDefault and fallback to the primary language", async () => {
    mockFetch();
    const config = baseConfig(makeStorage());
    await init(config);
    expect(getState().config.languages.fallback).toBe("fr");
    expect(getState().config.languages.initWithDefault).toBe("fr");
    expect(getState().config.addMissingTranslations).toBe(true);
  });

  it("defaults storage to window.localStorage", async () => {
    mockFetch();
    await init(baseConfig(undefined));
    expect(getState().config.storage).toBe(window.localStorage);
    await flush();
    expect(window.localStorage.getItem(storeKeys.currentLanguage)).toBe("fr");
    expect(window.localStorage.getItem(storeKeys.uniqueId)).toMatch(/^[0-9A-Za-z_]{16}$/);
  });
});

describe("hydration", () => {
  it("loads translations, the current language and the device id from storage", async () => {
    const { calls } = mockFetch({ en: { Bonjour: "Hello" } });
    const storage = makeStorage({
      [storeKeys.uniqueId]: "device-0000000001",
      [storeKeys.currentLanguage]: "en",
      [storeKeys.translations]: JSON.stringify({ Bonjour: "Hello", "Au revoir": "Goodbye" }),
      [storeKeys.lastRefresh]: "222",
    });
    const onInit = vi.fn();
    await init(baseConfig(storage, { onInit }));

    expect(getState().uniqueId).toBe("device-0000000001");
    expect(getCurrentLanguage()).toBe("en");
    expect(getState().translations).toEqual({ Bonjour: "Hello", "Au revoir": "Goodbye" });
    expect(getState().namespaces).toEqual(["default"]);
    expect(onInit).toHaveBeenCalledWith("en");
    // the persisted id is the one sent, not a new one
    expect(storage.setItem).not.toHaveBeenCalledWith(storeKeys.uniqueId, expect.anything());

    await flush();
    // a non-primary boot language fetches its dictionary once
    const gets = calls.filter((call) => call.method === "GET");
    expect(gets).toHaveLength(1);
    expect(gets[0].url).toContain("/translate/en");
  });

  it("generates and persists a device id when storage has none", async () => {
    mockFetch();
    const storage = makeStorage();
    await init(baseConfig(storage));
    const id = getState().uniqueId;
    expect(id).toMatch(/^[0-9A-Za-z_]{16}$/);
    expect(storage.data.get(storeKeys.uniqueId)).toBe(id);
  });

  it("honours skipCurrentLanguageHydration", async () => {
    mockFetch();
    const storage = makeStorage({ [storeKeys.currentLanguage]: "en" });
    await init(
      baseConfig(storage, {
        languages: { primary: "fr", supported: ["fr", "en"], skipCurrentLanguageHydration: true, initWithDefault: "fr" },
      })
    );
    expect(getCurrentLanguage()).toBe("fr");
  });

  it("loads per-namespace slices from the namespaces index", async () => {
    mockFetch();
    const storage = makeStorage({
      [storeKeys.namespaces]: JSON.stringify(["default", "shop"]),
      [storeKeys.translations]: JSON.stringify({ Bonjour: "Hello" }),
      [`${storeKeys.translations}__shop`]: JSON.stringify({ Panier: "Cart" }),
    });
    await init(baseConfig(storage));
    expect(getState().translations).toEqual({ Bonjour: "Hello", Panier: "Cart" });
    expect(getState().translationsByNamespace.shop).toEqual({ Panier: "Cart" });
    expect(getState().namespaces).toEqual(["default", "shop"]);
  });
});

describe("subscribe", () => {
  it("notifies on every change and stops after unsubscribe", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setState({ currentLanguage: "en" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].currentLanguage).toBe("en");
    expect(listener.mock.calls[0][1].currentLanguage).toBe("fr");
    unsubscribe();
    setState({ currentLanguage: "fr" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is notified when init lands the config and the language", async () => {
    mockFetch();
    const listener = vi.fn();
    subscribe(listener);
    await init(baseConfig(makeStorage()));
    const configs = listener.mock.calls.map((call) => call[0].config.API_KEY);
    expect(configs).toContain("k");
  });
});

describe("getTranslation", () => {
  it("returns the source in the primary language and records the usage once per key", async () => {
    mockFetch();
    const storage = makeStorage();
    await init(baseConfig(storage));
    expect(getTranslation("Bonjour")).toBe("Bonjour");
    expect(getTranslation("8 heures", { context: "durée" })).toBe("8 heures");
    await flush(1);
    const usage = getState().translationsUsageByNamespace.default;
    expect(Object.keys(usage)).toEqual(["Bonjour", "8 heures__durée"]);
    expect(storage.data.get(storeKeys.translationsUsage)).toBe(JSON.stringify(getState().translationsUsageByNamespace));
  });

  it("looks up key__context and applies replace", async () => {
    mockFetch();
    await init(
      baseConfig(
        makeStorage({
          [storeKeys.currentLanguage]: "en",
          [storeKeys.translations]: JSON.stringify({
            "8 heures__durée": "8 hours",
            "8 heures__heure": "8 AM",
            "Bonjour {name}": "Hello {name}",
          }),
        })
      )
    );
    expect(getTranslation("8 heures", { context: "durée" })).toBe("8 hours");
    expect(getTranslation("8 heures", { context: "heure" })).toBe("8 AM");
    expect(getTranslation("Bonjour {name}", { replace: { "{name}": "Ada" } })).toBe("Hello Ada");
    expect(resolveTranslation("Bonjour {name}", { replace: { "{name}": "Ada" } })).toBe("Hello Ada");
  });

  it("queues a POST /translate on a miss, then bulk-fetches the namespace", async () => {
    // the fixtures are read at call time: the key lands server-side after the first miss
    const fixtures: Record<string, Record<string, string>> = { en: {} };
    const { calls } = mockFetch(fixtures);
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    await flush();
    expect(getTranslation("Bonjour", { namespace: "shop" })).toBe("Bonjour");
    fixtures.en = { Bonjour: "Hello" };
    await flush();
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/translate"));
    expect(post?.body).toMatchObject({ key: "Bonjour", namespace: "shop", primaryLanguage: "fr" });
    expect(calls.some((call) => call.method === "GET" && call.url.includes("namespace=shop"))).toBe(true);
    expect(getState().translations.Bonjour).toBe("Hello");
    expect(getState().namespaces).toContain("shop");
  });

  it("sends the identity headers", async () => {
    const { fetchMock } = mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    await flush();
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer k");
    expect(headers.sdk).toBe("browser");
    expect(headers.unique_id).toBe(getState().uniqueId);
  });
});

describe("setCurrentLanguage", () => {
  it("persists the language, fetches it and notifies subscribers", async () => {
    const { calls } = mockFetch({ en: { Bonjour: "Hello" } });
    const storage = makeStorage();
    const onSetLanguage = vi.fn();
    await init(baseConfig(storage, { onSetLanguage }));
    const listener = vi.fn();
    subscribe(listener);

    await setCurrentLanguage("en");
    expect(onSetLanguage).toHaveBeenCalledWith("en");
    expect(getCurrentLanguage()).toBe("en");
    expect(storage.data.get(storeKeys.currentLanguage)).toBe("en");
    expect(calls.filter((call) => call.method === "GET" && call.url.includes("/translate/en"))).toHaveLength(1);
    expect(getState().translations).toEqual({ Bonjour: "Hello" });
    expect(storage.data.get(storeKeys.translations)).toBe(JSON.stringify({ Bonjour: "Hello" }));
    expect(getTranslation("Bonjour")).toBe("Hello");
    expect(listener).toHaveBeenCalled();
  });

  it("falls back when the language is not supported", async () => {
    mockFetch();
    await init(baseConfig(makeStorage(), { languages: { primary: "fr", supported: ["fr", "en"], fallback: "en" } }));
    await setCurrentLanguage("de");
    expect(getCurrentLanguage()).toBe("en");
    expect(getSupportedLanguages()).toEqual(["fr", "en"]);
  });
});

describe("watchTranslation", () => {
  it("delivers the source, then the translation, then the new language", async () => {
    mockFetch({ en: { Bonjour: "Hello" }, fr: {} });
    await init(baseConfig(makeStorage()));
    const onText = vi.fn();
    const stop = watchTranslation("Bonjour", {}, onText);
    expect(onText).toHaveBeenLastCalledWith("Bonjour", "fr");

    await setCurrentLanguage("en");
    expect(onText).toHaveBeenLastCalledWith("Hello", "en");

    await setCurrentLanguage("fr");
    expect(onText).toHaveBeenLastCalledWith("Bonjour", "fr");
    const callsBefore = onText.mock.calls.length;
    stop();
    setState({ translations: { Bonjour: "Other" }, currentLanguage: "en" });
    expect(onText).toHaveBeenCalledTimes(callsBefore);
  });

  it("delivers the source before init and requests once the config lands", async () => {
    const { calls } = mockFetch({ en: { Bonjour: "Hello" } });
    const onText = vi.fn();
    watchTranslation("Bonjour", {}, onText);
    expect(onText).toHaveBeenCalledWith("Bonjour", "fr");
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    await flush();
    expect(onText).toHaveBeenLastCalledWith("Hello", "en");
    expect(calls.some((call) => call.method === "POST" && call.body?.key === "Bonjour")).toBe(true);
  });
});

describe("usage report", () => {
  it("POSTs the persisted usage exactly once at init and clears it", async () => {
    const { calls } = mockFetch();
    const usage = { default: { Bonjour: "2025-01-01" } };
    const storage = makeStorage({ [storeKeys.translationsUsage]: JSON.stringify(usage) });
    await init(baseConfig(storage));
    await flush();
    const posts = calls.filter((call) => call.url.endsWith("/translate/last-used-translations"));
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ primaryLanguage: "fr", translationsUsageByNamespace: usage });
    expect(getState().translationsUsageByNamespace).toEqual({});
    expect(storage.data.get(storeKeys.translationsUsage)).toBe("");

    // a language switch sends nothing more
    await setCurrentLanguage("en");
    await flush();
    expect(calls.filter((call) => call.url.endsWith("/translate/last-used-translations"))).toHaveLength(1);
  });

  it("sends nothing when there is no usage", async () => {
    const { calls } = mockFetch();
    await init(baseConfig(makeStorage()));
    await flush();
    expect(calls.filter((call) => call.url.endsWith("/translate/last-used-translations"))).toHaveLength(0);
  });
});

describe("clearI18nKeylessStorageAndStore", () => {
  it("wipes the cache, keeps the device id", async () => {
    mockFetch({ en: { Bonjour: "Hello" } });
    const storage = makeStorage();
    await init(baseConfig(storage));
    await setCurrentLanguage("en");
    const id = getState().uniqueId;
    await clearI18nKeylessStorageAndStore();
    expect(getState().translations).toEqual({});
    expect(getState().uniqueId).toBe(id);
    expect(storage.data.get(storeKeys.uniqueId)).toBe(id);
    expect(storage.data.has(storeKeys.translations)).toBe(false);
    expect(storage.data.has(storeKeys.currentLanguage)).toBe(false);
  });
});

/** A `fetch` that answers every call with one fixed status and payload. */
const fetchJson = (payload: unknown, status = 200) => {
  const fetchMock = vi.fn(async () => ({
    status,
    ok: status === 200,
    statusText: status === 200 ? "OK" : "Unauthorized",
    json: async () => payload,
    headers: { get: () => null },
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe("init: config defaults and custom handlers", () => {
  it("defaults supported to the primary language", async () => {
    mockFetch();
    await init(baseConfig(makeStorage(), { languages: { primary: "fr" } as I18nConfig["languages"] }));
    expect(getSupportedLanguages()).toEqual(["fr"]);
  });

  it("adds initWithDefault to the supported languages", async () => {
    const { calls } = mockFetch();
    await init(baseConfig(makeStorage(), { languages: { primary: "fr", supported: ["fr"], initWithDefault: "en" } }));
    expect(getSupportedLanguages()).toEqual(["fr", "en"]);
    expect(getCurrentLanguage()).toBe("en");
    await flush();
    expect(calls.some((call) => call.method === "GET" && call.url.includes("/translate/en"))).toBe(true);
  });

  it("still requires an API_KEY with custom handlers", async () => {
    await expect(
      init({
        languages: { primary: "fr", supported: ["fr"] },
        handleTranslate: async () => ({ ok: true, message: "", data: { translation: {} } }),
        getAllTranslations: async () => okResponse(),
      } as unknown as I18nConfig)
    ).rejects.toThrow(/API_KEY is required/);
    expect(getState().config.API_KEY).toBe("");
  });

  it("uses the custom handlers instead of fetch", async () => {
    const { fetchMock } = mockFetch();
    const getAllTranslations = vi.fn(async () => okResponse({ Bonjour: "Hello" }));
    const handleTranslate = vi.fn(async () => ({ ok: true, message: "", data: { translation: {} } }));
    await init(
      baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" }), { getAllTranslations, handleTranslate })
    );
    await flush();
    expect(getAllTranslations).toHaveBeenCalledTimes(1);
    expect(getTranslation("Bonjour")).toBe("Hello");
    expect(getTranslation("Au revoir")).toBe("Au revoir");
    await flush();
    expect(handleTranslate).toHaveBeenCalledWith("Au revoir");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("hydration edge cases", () => {
  it("throws when a listener wipes the config during init", async () => {
    mockFetch();
    subscribe((current) => {
      if (current.config.API_KEY === "k") {
        setState({ config: { ...current.config, API_KEY: "" } });
      }
    });
    await expect(init(baseConfig(makeStorage()))).rejects.toThrow(/config is not initialized hydrating/);
  });

  it("throws when a listener drops the storage during init", async () => {
    mockFetch();
    subscribe((current) => {
      if (current.config.API_KEY === "k" && current.config.storage) {
        setState({ config: { ...current.config, storage: undefined } });
      }
    });
    await expect(init(baseConfig(makeStorage()))).rejects.toThrow(/storage is not initialized hydrating/);
  });

  it("ignores an empty origin-namespaces index", async () => {
    const { calls } = mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.originNamespaces]: "[]" })));
    expect(getState().originNamespaces).toEqual([]);
    await flush();
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(0);
  });

  it("refetches the origin namespaces even in the primary language", async () => {
    const { calls } = mockFetch({ fr: { "Hola": "Salut" } });
    await init(baseConfig(makeStorage({ [storeKeys.originNamespaces]: JSON.stringify(["ugc"]) })));
    expect(getState().originNamespaces).toEqual(["ugc"]);
    await flush();
    const gets = calls.filter((call) => call.method === "GET");
    expect(gets).toHaveLength(1);
    expect(gets[0].url).toContain("/translate/fr");
    expect(gets[0].url).toContain("namespace=ugc");
    expect(getState().translationsByNamespace.ugc).toEqual({ Hola: "Salut" });
  });

  it("discards a legacy flat usage map", async () => {
    const { calls } = mockFetch();
    const storage = makeStorage({ [storeKeys.translationsUsage]: JSON.stringify({ Bonjour: "2025-01-01" }) });
    await init(baseConfig(storage, { debug: true }));
    expect(getState().translationsUsageByNamespace).toEqual({});
    await flush();
    expect(calls.filter((call) => call.url.endsWith("/translate/last-used-translations"))).toHaveLength(0);
    expect(console.log).toHaveBeenCalledWith("i18n-keyless: _hydrate: discarding legacy flat usage");
  });

  it("logs every step of an empty hydration with debug", async () => {
    mockFetch();
    await init(baseConfig(makeStorage(), { debug: true }));
    expect(console.log).toHaveBeenCalledWith("i18n-keyless: _hydrate: uniqueId", getState().uniqueId);
    expect(console.log).toHaveBeenCalledWith("i18n-keyless: _hydrate: no translations");
    expect(console.log).toHaveBeenCalledWith("i18n-keyless: _hydrate: no current language");
    expect(console.log).toHaveBeenCalledWith("i18n-keyless: setLanguage", "fr");
  });

  it("logs every step of a filled hydration with debug", async () => {
    mockFetch({ en: {} });
    const storage = makeStorage({
      [storeKeys.currentLanguage]: "en",
      [storeKeys.translations]: JSON.stringify({ Bonjour: "Hello" }),
    });
    await init(baseConfig(storage, { debug: true }));
    expect(console.log).toHaveBeenCalledWith("i18n-keyless: _hydrate", { Bonjour: "Hello" });
    expect(console.log).toHaveBeenCalledWith("i18n-keyless: _hydrate", "en");
    await setCurrentLanguage("de");
    expect(console.log).toHaveBeenCalledWith("i18n-keyless: language", "de", "is not supported, fallback to", "fr");
  });

  it("logs the skipped language hydration with debug", async () => {
    mockFetch();
    await init(
      baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" }), {
        debug: true,
        languages: { primary: "fr", supported: ["fr", "en"], skipCurrentLanguageHydration: true },
      })
    );
    expect(getCurrentLanguage()).toBe("fr");
    expect(console.log).toHaveBeenCalledWith("i18n-keyless: _hydrate: skip current language hydration");
  });
});

describe("setCurrentLanguage edge cases", () => {
  it("rejects before init", async () => {
    await expect(setCurrentLanguage("en")).rejects.toThrow(/config is not initialized setting language/);
  });

  it("keeps the stored dictionary when the fetch fails", async () => {
    const fetchMock = fetchJson({ ok: false, error: "Unauthorized" }, 401);
    const storage = makeStorage({ [storeKeys.translations]: JSON.stringify({ Bonjour: "Hello" }) });
    await init(baseConfig(storage));
    await setCurrentLanguage("en");
    expect(fetchMock).toHaveBeenCalled();
    expect(getCurrentLanguage()).toBe("en");
    expect(getTranslation("Bonjour")).toBe("Hello");
    expect(getState().lastRefresh).toBeNull();
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: fetch all translations error:", expect.any(Error));
  });

  it("throws when the config is reset while the dictionary is in flight", async () => {
    mockFetch({ en: { Bonjour: "Hello" } });
    await init(baseConfig(makeStorage()));
    const pending = setCurrentLanguage("en");
    setState({ config: { ...getState().config, API_KEY: "" } });
    await expect(pending).rejects.toThrow(/config is not initialized setting translations/);
  });

  it("throws when the storage is dropped while the dictionary is in flight", async () => {
    mockFetch({ en: { Bonjour: "Hello" } });
    await init(baseConfig(makeStorage()));
    const pending = setCurrentLanguage("en");
    setState({ config: { ...getState().config, storage: undefined } });
    await expect(pending).rejects.toThrow(/storage is not initialized setting translations/);
  });
});

describe("setTranslations", () => {
  it("adopts the server id only when the device has none", async () => {
    mockFetch({ en: { Bonjour: "Hello" } });
    const storage = makeStorage();
    await init(baseConfig(storage));
    const id = getState().uniqueId;
    await setCurrentLanguage("en");
    // the response echoes "u1": the id we sent stays the authoritative one
    expect(getState().uniqueId).toBe(id);
    expect(storage.data.get(storeKeys.uniqueId)).toBe(id);

    setState({ uniqueId: null });
    await setCurrentLanguage("fr");
    await setCurrentLanguage("en");
    expect(getState().uniqueId).toBe("u1");
    expect(storage.data.get(storeKeys.uniqueId)).toBe("u1");
  });

  it("ignores an invalid server id and a missing lastRefresh", async () => {
    fetchJson({ ok: true, data: { translations: { Bonjour: "Hello" }, uniqueId: "bad\nid", lastRefresh: "" } });
    const storage = makeStorage();
    await init(baseConfig(storage));
    setState({ uniqueId: null });
    await setCurrentLanguage("en");
    expect(getState().translations).toEqual({ Bonjour: "Hello" });
    expect(getState().uniqueId).toBeNull();
    expect(getState().lastRefresh).toBeNull();
    expect(getState().lastRefreshByNamespace).toEqual({});
    // the cursor was reset by the switch and never written back
    expect(storage.data.get(storeKeys.lastRefresh)).toBe("");
  });
});

describe("unpersisted namespaces and origin languages", () => {
  it("keeps an unpersisted namespace in memory only", async () => {
    const fixtures: Record<string, Record<string, string>> = { en: {} };
    mockFetch(fixtures);
    const storage = makeStorage({ [storeKeys.currentLanguage]: "en" });
    await init(baseConfig(storage));
    await flush();
    expect(JSON.parse(storage.data.get(storeKeys.namespaces)!)).toEqual(["default"]);

    expect(getTranslation("Bonjour", { namespace: "tmp", unpersistedNamespace: true })).toBe("Bonjour");
    fixtures.en = { Bonjour: "Hello" };
    await flush();
    expect(getState().translations.Bonjour).toBe("Hello");
    expect(getState().namespaces).toEqual(["default", "tmp"]);
    expect(getState().unpersistedNamespaces).toEqual(["tmp"]);
    expect(JSON.parse(storage.data.get(storeKeys.namespaces)!)).toEqual(["default"]);
    expect(storage.data.has(`${storeKeys.translations}__tmp`)).toBe(false);
    // no usage is recorded for a transient namespace
    expect(getState().translationsUsageByNamespace).toEqual({});

    // a language round trip refetches it, still in memory only, and never touches its cursor
    storage.setItem.mockClear();
    await setCurrentLanguage("fr");
    await setCurrentLanguage("en");
    expect(getState().unpersistedNamespaces).toEqual(["tmp"]);
    expect(getState().translationsByNamespace.tmp).toEqual({ Bonjour: "Hello" });
    expect(storage.data.has(`${storeKeys.translations}__tmp`)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalledWith(`${storeKeys.lastRefresh}__tmp`, "");
    expect(storage.setItem).toHaveBeenCalledWith(storeKeys.lastRefresh, "");
  });

  it("registers the namespaces holding origin-language keys", async () => {
    mockFetch();
    const storage = makeStorage();
    await init(baseConfig(storage));
    expect(getTranslation("Hola", { originLanguage: "es" })).toBe("Hola");
    await flush(1);
    expect(getState().originNamespaces).toEqual(["default"]);
    expect(storage.data.get(storeKeys.originNamespaces)).toBe(JSON.stringify(["default"]));

    // already registered: nothing is written again
    storage.setItem.mockClear();
    getTranslation("Hola", { originLanguage: "es" });
    await flush(1);
    expect(storage.setItem).not.toHaveBeenCalledWith(storeKeys.originNamespaces, expect.anything());

    // an unpersisted namespace is registered in memory only
    getTranslation("Ciao", { originLanguage: "it", namespace: "ugc-tmp", unpersistedNamespace: true });
    await flush(1);
    expect(getState().originNamespaces).toEqual(["default", "ugc-tmp"]);
    expect(storage.setItem).not.toHaveBeenCalledWith(storeKeys.originNamespaces, expect.anything());

    // an origin language equal to the primary is the regular flow
    getTranslation("Bonjour", { originLanguage: "fr", namespace: "plain" });
    await flush(1);
    expect(getState().originNamespaces).toEqual(["default", "ugc-tmp"]);
  });
});

describe("resolveTranslation", () => {
  it("resolves origin-language keys against the current language", () => {
    setState({ config: baseConfig(undefined), currentLanguage: "fr", translations: { Hola: "Salut" } });
    expect(resolveTranslation("Hola", { originLanguage: "es" })).toBe("Salut");
    expect(resolveTranslation("Hola", { originLanguage: "fr" })).toBe("Hola");
    setState({ currentLanguage: "es" });
    expect(resolveTranslation("Hola", { originLanguage: "es" })).toBe("Hola");
    // without an origin language the key is a primary-language string: it is looked up
    expect(resolveTranslation("Hola")).toBe("Salut");
  });

  it("ignores an empty replace map and keeps a placeholder without a value", () => {
    setState({ config: baseConfig(undefined), currentLanguage: "en", translations: { "Bonjour {name}": "Hello {name}" } });
    expect(resolveTranslation("Bonjour {name}", { replace: {} })).toBe("Hello {name}");
    expect(resolveTranslation("Bonjour {name}", { replace: { "{name}": "" } })).toBe("Hello {name}");
  });
});

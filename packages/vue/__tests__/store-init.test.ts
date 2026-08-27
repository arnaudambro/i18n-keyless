import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { load, makeStorage, mockFetch, flush, baseConfig } from "./helpers.ts";

const EN = { Bonjour: "Hello", "Au revoir": "Goodbye" };

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("init validation", () => {
  it("requires languages", async () => {
    const { init } = await load();
    // @ts-expect-error invalid on purpose
    await expect(init({})).rejects.toThrow(/languages is required/);
  });

  it("requires a primary language", async () => {
    const { init } = await load();
    // @ts-expect-error invalid on purpose
    await expect(init({ languages: { supported: ["en"] } })).rejects.toThrow(/primary is required/);
  });

  it("requires an API_KEY", async () => {
    const { init } = await load();
    await expect(init(baseConfig(makeStorage(), { API_KEY: undefined }) as never)).rejects.toThrow(
      /API_KEY is required/
    );
  });

  it("defaults initWithDefault, fallback and addMissingTranslations", async () => {
    mockFetch();
    const { init, useI18nKeyless } = await load();
    await init(baseConfig(makeStorage()) as never);
    const config = useI18nKeyless.getState().config;
    expect(config.languages.fallback).toBe("fr");
    expect(config.languages.initWithDefault).toBe("fr");
    expect(config.addMissingTranslations).toBe(true);
  });

  it("throws without storage on the client", async () => {
    const { init } = await load();
    await expect(init(baseConfig(undefined) as never)).rejects.toThrow(/storage is required/);
  });
});

describe("hydration from storage", () => {
  it("loads translations, the current language and the device id, then fetches the language", async () => {
    const { calls } = mockFetch({ en: EN });
    const storage = makeStorage({
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello (stored)" }),
      "i18n-keyless-current-language": "en",
      "i18n-keyless-user-id": "device-id-0001",
      "i18n-keyless-last-refresh": "2024-12-31",
    });
    const { init, useI18nKeyless, getTranslation } = await load();
    await init(baseConfig(storage) as never);

    const state = useI18nKeyless.getState();
    expect(state.currentLanguage).toBe("en");
    expect(state.uniqueId).toBe("device-id-0001");
    expect(state.namespaces).toEqual(["default"]);
    // The stored map is usable right away, before the network answers.
    expect(getTranslation("Bonjour")).toBe("Hello (stored)");

    // setLanguage refetches the whole language with the device id in the header.
    await flush();
    const bulk = calls.find((call) => call.method === "GET" && call.url.includes("/translate/en"));
    expect(bulk).toBeDefined();
    expect(useI18nKeyless.getState().translations).toMatchObject(EN);
    // The refreshed slice is persisted back under the default namespace key.
    expect(storage.data.get("i18n-keyless-translations")).toContain("Goodbye");
  });

  it("generates and persists a device id when storage holds none", async () => {
    mockFetch();
    const storage = makeStorage();
    const { init, useI18nKeyless } = await load();
    await init(baseConfig(storage) as never);
    const uniqueId = useI18nKeyless.getState().uniqueId;
    expect(uniqueId).toMatch(/^[0-9A-Za-z_]{16}$/);
    expect(storage.data.get("i18n-keyless-user-id")).toBe(uniqueId);
  });

  it("uses initWithDefault when skipCurrentLanguageHydration is set", async () => {
    mockFetch({ en: EN });
    const storage = makeStorage({ "i18n-keyless-current-language": "es" });
    const { init, useI18nKeyless } = await load();
    await init(
      baseConfig(storage, {
        languages: { primary: "fr", supported: ["fr", "en", "es"], initWithDefault: "en", skipCurrentLanguageHydration: true },
      }) as never
    );
    expect(useI18nKeyless.getState().currentLanguage).toBe("en");
  });

  it("calls onInit with the hydrated language", async () => {
    mockFetch({ en: EN });
    const onInit = vi.fn();
    const { init } = await load();
    await init(baseConfig(makeStorage({ "i18n-keyless-current-language": "en" }), { onInit }) as never);
    expect(onInit).toHaveBeenCalledWith("en");
  });

  it("keeps a server snapshot applied with hydrateFromServer over the stored language", async () => {
    mockFetch({ en: EN, es: { Bonjour: "Hola" } });
    const storage = makeStorage({
      "i18n-keyless-current-language": "en",
      "i18n-keyless-translations": JSON.stringify(EN),
    });
    const { init, hydrateFromServer, useI18nKeyless } = await load();
    hydrateFromServer({ lang: "es", translations: { Bonjour: "Hola" } });
    await init(baseConfig(storage) as never);
    expect(useI18nKeyless.getState().currentLanguage).toBe("es");
    expect(useI18nKeyless.getState().translations.Bonjour).toBe("Hola");
  });
});

describe("usage analytics", () => {
  const usage = JSON.stringify({ default: { Bonjour: "2025-01-01" } });

  it("POSTs the stored usage on init on the client", async () => {
    const { calls } = mockFetch();
    const { init } = await load();
    await init(baseConfig(makeStorage({ "i18n-keyless-translations-usage": usage })) as never);
    await flush();
    expect(calls.some((call) => call.url.includes("/translate/last-used-translations"))).toBe(true);
  });

  it("does not POST usage on init under ssr: true", async () => {
    const { calls } = mockFetch();
    const { init } = await load();
    await init(baseConfig(makeStorage({ "i18n-keyless-translations-usage": usage }), { ssr: true }) as never);
    await flush();
    expect(calls.some((call) => call.url.includes("/translate/last-used-translations"))).toBe(false);
  });

  it("does not POST usage on init on the server, and defaults to an in-memory storage", async () => {
    vi.stubGlobal("window", undefined);
    const { calls } = mockFetch();
    const { init, useI18nKeyless, core } = await load();
    await init(baseConfig(undefined) as never);
    await flush();
    const storage = useI18nKeyless.getState().config.storage;
    expect(typeof storage?.getItem).toBe("function");
    expect(typeof storage?.setItem).toBe("function");
    expect(calls.some((call) => call.url.includes("/translate/last-used-translations"))).toBe(false);
    // A server sends no device id: the API counts its IP.
    expect(core.getSdkRuntime()).toBe("vue-server");
    expect(useI18nKeyless.getState().uniqueId).toBeNull();
  });

  it("does not record usage in getTranslation under ssr: true", async () => {
    mockFetch();
    const { init, getTranslation, useI18nKeyless } = await load();
    await init(baseConfig(makeStorage(), { ssr: true }) as never);
    useI18nKeyless.setState({ currentLanguage: "en" });
    getTranslation("Bonjour");
    await flush();
    expect(useI18nKeyless.getState().translationsUsageByNamespace).toEqual({});
  });

  it("records usage in getTranslation on the client, under key__context", async () => {
    mockFetch();
    const { init, getTranslation, useI18nKeyless } = await load();
    await init(baseConfig(makeStorage()) as never);
    useI18nKeyless.setState({ currentLanguage: "en" });
    getTranslation("8 heures", { context: "heure" });
    await flush();
    expect(useI18nKeyless.getState().translationsUsageByNamespace.default).toHaveProperty("8 heures__heure");
  });
});

describe("setCurrentLanguage", () => {
  it("switches the language, fetches it, persists it and calls onSetLanguage", async () => {
    const { calls } = mockFetch({ en: EN });
    const onSetLanguage = vi.fn();
    const storage = makeStorage();
    const { init, setCurrentLanguage, useI18nKeyless, getTranslation } = await load();
    await init(baseConfig(storage, { onSetLanguage }) as never);
    expect(getTranslation("Bonjour")).toBe("Bonjour");

    await setCurrentLanguage("en");
    expect(onSetLanguage).toHaveBeenCalledWith("en");
    expect(useI18nKeyless.getState().currentLanguage).toBe("en");
    expect(getTranslation("Bonjour")).toBe("Hello");
    expect(storage.data.get("i18n-keyless-current-language")).toBe("en");
    expect(calls.some((call) => call.method === "GET" && call.url.includes("/translate/en"))).toBe(true);
  });

  it("falls back to the fallback language for an unsupported code", async () => {
    mockFetch({ en: EN });
    const { init, setCurrentLanguage, useI18nKeyless } = await load();
    await init(baseConfig(makeStorage(), { languages: { primary: "fr", supported: ["fr", "en"], fallback: "en" } }) as never);
    await setCurrentLanguage("de");
    expect(useI18nKeyless.getState().currentLanguage).toBe("en");
  });
});

describe("clearI18nKeylessStorageAndStore", () => {
  it("wipes the translation cache but keeps the device id", async () => {
    mockFetch({ en: EN });
    const storage = makeStorage({ "i18n-keyless-user-id": "device-id-0001" });
    const { init, setCurrentLanguage, clearI18nKeylessStorageAndStore, useI18nKeyless } = await load();
    await init(baseConfig(storage) as never);
    await setCurrentLanguage("en");
    expect(storage.data.has("i18n-keyless-translations")).toBe(true);

    await clearI18nKeylessStorageAndStore();
    expect(storage.data.has("i18n-keyless-translations")).toBe(false);
    expect(storage.data.get("i18n-keyless-user-id")).toBe("device-id-0001");
    expect(useI18nKeyless.getState().translations).toEqual({});
  });
});

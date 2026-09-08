/**
 * The precompiled bundle (docs/PROTOCOL.md 7.4): a namespace the manifest covers in the
 * current language is seeded from the shipped file, with the bundle's cursor, instead of
 * fetched — at boot and on a language switch. Storage wins only when newer and in the same
 * language. Everything not covered keeps the fetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("zustand");

function makeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn((k: string) => void data.delete(k)),
  };
}

const okResponse = (translations: Record<string, string> = {}, lastRefresh = "111") => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh },
  error: "",
  message: "",
});

async function load() {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const mod = await import("../store.ts");
  const fetchDictionary = vi
    .spyOn(core, "getAllTranslationsFromLanguage")
    .mockResolvedValue(okResponse({ Fetched: "From the API" }) as never);
  vi.spyOn(core, "sendTranslationsUsageToI18nKeyless").mockResolvedValue({ ok: true, message: "" });
  return { ...mod, core, fetchDictionary };
}

const BUNDLE_CURSOR = "1757000000000";
const manifest = {
  primaryLanguage: "fr",
  languages: ["en", "es", "fr"],
  exportedAt: BUNDLE_CURSOR,
  namespaces: {
    default: { lastRefresh: BUNDLE_CURSOR, languages: ["en", "es", "fr"] },
    checkout: { lastRefresh: BUNDLE_CURSOR, languages: ["en"] },
  },
};
const files: Record<string, Record<string, string>> = {
  "default/en.json": { Bonjour: "Hello", Merci: "Thanks" },
  "default/es.json": { Bonjour: "Hola", Merci: "Gracias" },
  "default/fr.json": { Bonjour: "Bonjour", Merci: "Merci" },
  "checkout/en.json": { Panier: "Cart" },
};
const bundleConfig = () => ({
  manifest,
  // the module shape of a dynamic import()
  load: vi.fn(async (ns: string, lang: string) => ({ default: files[`${ns}/${lang}.json`] })),
});

const config = (storage: unknown, extra: Record<string, unknown> = {}) => ({
  API_KEY: "k",
  languages: { primary: "fr", supported: ["fr", "en", "es"] },
  storage,
  bundle: bundleConfig(),
  ...extra,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("boot", () => {
  it("seeds every bundled namespace in the current language, with the bundle cursor, and fetches nothing", async () => {
    const { init, boundStore, fetchDictionary } = await load();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });
    const cfg = config(storage);

    await init(cfg as never);
    await flush();

    const state = boundStore.getState();
    expect(state.currentLanguage).toBe("en");
    expect(state.translations).toEqual({ Bonjour: "Hello", Merci: "Thanks", Panier: "Cart" });
    expect(state.translationsByNamespace.checkout).toEqual({ Panier: "Cart" });
    expect(state.namespaces).toEqual(["default", "checkout"]);
    expect(state.lastRefreshByNamespace).toEqual({ default: BUNDLE_CURSOR, checkout: BUNDLE_CURSOR });
    expect(fetchDictionary).not.toHaveBeenCalled();
    expect(cfg.bundle.load).toHaveBeenCalledWith("default", "en");
    expect(cfg.bundle.load).toHaveBeenCalledWith("checkout", "en");
    // persisted like a fetched dictionary, so the delta cursor survives a reload
    expect(storage.data.get("i18n-keyless-last-refresh")).toBe(BUNDLE_CURSOR);
  });

  it("seeds the bundled primary dictionary too, and fetches only an origin namespace the bundle does not cover", async () => {
    const { init, boundStore, fetchDictionary } = await load();
    const storage = makeStorage({
      "i18n-keyless-current-language": "fr",
      "i18n-keyless-origin-namespaces": JSON.stringify(["chat"]),
    });

    await init(config(storage) as never);
    await flush();

    expect(boundStore.getState().translationsByNamespace.default).toEqual({ Bonjour: "Bonjour", Merci: "Merci" });
    expect(fetchDictionary).toHaveBeenCalledTimes(1);
    expect(fetchDictionary.mock.calls[0][0]).toBe("fr");
    expect(fetchDictionary.mock.calls[0][2]).toBe("chat");
  });

  it("fetches a language the bundle does not cover for a namespace", async () => {
    const { init, fetchDictionary, boundStore } = await load();
    const storage = makeStorage({ "i18n-keyless-current-language": "es" });

    await init(config(storage) as never);
    await flush();

    // default/es is bundled, checkout/es is not
    expect(boundStore.getState().translationsByNamespace.default).toEqual({ Bonjour: "Hola", Merci: "Gracias" });
    expect(fetchDictionary).toHaveBeenCalledTimes(1);
    expect(fetchDictionary.mock.calls[0][2]).toBe("checkout");
    expect(boundStore.getState().translationsByNamespace.checkout).toEqual({ Fetched: "From the API" });
  });

  it("keeps a stored slice on top of the bundle when it is newer and in the same language", async () => {
    const { init, boundStore, fetchDictionary } = await load();
    const newer = `${Number(BUNDLE_CURSOR) + 60_000}`;
    const storage = makeStorage({
      "i18n-keyless-current-language": "en",
      "i18n-keyless-namespaces": JSON.stringify(["default"]),
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello, reviewed" }),
      "i18n-keyless-last-refresh": newer,
    });

    await init(config(storage) as never);
    await flush();

    const state = boundStore.getState();
    expect(state.translationsByNamespace.default).toEqual({ Bonjour: "Hello, reviewed", Merci: "Thanks" });
    expect(state.lastRefreshByNamespace.default).toBe(newer);
    expect(fetchDictionary).not.toHaveBeenCalled();
  });

  it("ignores a stored slice that is older than the bundle", async () => {
    const { init, boundStore } = await load();
    const storage = makeStorage({
      "i18n-keyless-current-language": "en",
      "i18n-keyless-namespaces": JSON.stringify(["default"]),
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Old hello" }),
      "i18n-keyless-last-refresh": `${Number(BUNDLE_CURSOR) - 60_000}`,
    });

    await init(config(storage) as never);
    await flush();

    expect(boundStore.getState().translationsByNamespace.default).toEqual({ Bonjour: "Hello", Merci: "Thanks" });
    expect(boundStore.getState().lastRefreshByNamespace.default).toBe(BUNDLE_CURSOR);
  });

  it("never mixes in a newer stored slice written in another language", async () => {
    const { init, boundStore } = await load();
    const storage = makeStorage({
      // storage holds English, the app boots in Spanish (skipCurrentLanguageHydration)
      "i18n-keyless-current-language": "en",
      "i18n-keyless-namespaces": JSON.stringify(["default"]),
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello" }),
      "i18n-keyless-last-refresh": `${Number(BUNDLE_CURSOR) + 60_000}`,
    });

    await init(
      config(storage, { languages: { primary: "fr", supported: ["fr", "en", "es"], initWithDefault: "es", skipCurrentLanguageHydration: true } }) as never
    );
    await flush();

    expect(boundStore.getState().currentLanguage).toBe("es");
    expect(boundStore.getState().translationsByNamespace.default).toEqual({ Bonjour: "Hola", Merci: "Gracias" });
  });

  it("falls back to the fetch when the loader throws", async () => {
    const { init, fetchDictionary } = await load();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bundle = { manifest, load: vi.fn(() => Promise.reject(new Error("missing"))) };

    await init(config(storage, { bundle }) as never);
    await flush();

    expect(fetchDictionary).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});

describe("language switch", () => {
  it("seeds the new language from the bundle and never mixes the previous language's slice", async () => {
    const { init, boundStore, fetchDictionary } = await load();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });

    await init(config(storage) as never);
    await flush();
    await boundStore.getState().setLanguage("es");
    await flush();

    expect(boundStore.getState().translationsByNamespace.default).toEqual({ Bonjour: "Hola", Merci: "Gracias" });
    expect(boundStore.getState().lastRefreshByNamespace.default).toBe(BUNDLE_CURSOR);
    // checkout has no Spanish file: fetched
    expect(fetchDictionary).toHaveBeenCalledTimes(1);
    expect(fetchDictionary.mock.calls[0][2]).toBe("checkout");
  });

  it("the delta after a miss starts from the bundle cursor", async () => {
    const { init, boundStore, core, fetchDictionary } = await load();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });
    await init(config(storage) as never);
    await flush();
    fetchDictionary.mockClear();

    // what the queue's `empty` handler does for a namespace that just had a miss
    const store = boundStore.getState();
    await core.getAllTranslationsFromLanguage(
      store.currentLanguage,
      { ...store, lastRefresh: store.lastRefreshByNamespace["default"] ?? null },
      "default"
    );

    expect(fetchDictionary.mock.calls[0][1].lastRefresh).toBe(BUNDLE_CURSOR);
  });
});

describe("without a bundle", () => {
  it("fetches exactly as before", async () => {
    const { init, fetchDictionary } = await load();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });

    await init({ API_KEY: "k", languages: { primary: "fr", supported: ["fr", "en"] }, storage } as never);
    await flush();

    expect(fetchDictionary).toHaveBeenCalledTimes(1);
    expect(fetchDictionary.mock.calls[0][2]).toBe("default");
  });
});

describe("server rendering", () => {
  it("getServerTranslations answers the bundled default dictionary and never fetches it", async () => {
    vi.resetModules();
    const core = await import("i18n-keyless-core");
    const fetchDictionary = vi.spyOn(core, "getAllTranslationsFromLanguage");
    const { boundStore } = await import("../store.ts");
    const { getServerTranslations, clearServerTranslationsCache } = await import("../server.ts");
    clearServerTranslationsCache();
    const bundle = bundleConfig();
    boundStore.setState({
      config: { API_KEY: "k", languages: { primary: "fr", supported: ["fr", "en", "es"] }, bundle } as never,
    });

    await expect(getServerTranslations("en")).resolves.toEqual({ Bonjour: "Hello", Merci: "Thanks" });
    await expect(getServerTranslations("en")).resolves.toEqual({ Bonjour: "Hello", Merci: "Thanks" });
    expect(bundle.load).toHaveBeenCalledTimes(1);
    expect(fetchDictionary).not.toHaveBeenCalled();
    await expect(getServerTranslations("fr")).resolves.toEqual({});
  });
});

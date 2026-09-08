/**
 * The precompiled bundle (docs/PROTOCOL.md 7.4): a namespace the manifest covers in the
 * current language is seeded from the shipped file, with the bundle's cursor, instead of
 * fetched — at boot and on a language switch. Storage wins only when newer and in the same
 * language. Everything not covered keeps the fetch.
 *
 * Unlike the react suite, this one drives the store through the real `fetch` double
 * (`mockFetch`, see `helpers.ts`) instead of mocking `i18n-keyless-core` module functions,
 * matching how the rest of the angular suite is written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAllTranslationsFromLanguage } from "i18n-keyless-core";
import { init, store, setCurrentLanguage } from "../store.ts";
import { getServerTranslations, clearServerTranslationsCache } from "../server.ts";
import { baseConfig, makeStorage, mockFetch, resetAll, flush } from "./helpers.ts";
import type { I18nConfig } from "../types.ts";

beforeEach(() => {
  resetAll();
  clearServerTranslationsCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

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

const config = (storage: I18nConfig["storage"], extra: Partial<I18nConfig> = {}): I18nConfig =>
  baseConfig({
    languages: { primary: "fr", supported: ["fr", "en", "es"] },
    storage,
    bundle: bundleConfig(),
    ...extra,
  });

const namespaceOf = (url: string) => new URL(url).searchParams.get("namespace");
const lastRefreshOf = (url: string) => new URL(url).searchParams.get("last_refresh");

describe("boot", () => {
  it("seeds every bundled namespace in the current language, with the bundle cursor, and fetches nothing", async () => {
    const api = mockFetch();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });
    const cfg = config(storage);

    await init(cfg);
    await flush();

    expect(store.currentLanguage()).toBe("en");
    expect(store.translations()).toEqual({ Bonjour: "Hello", Merci: "Thanks", Panier: "Cart" });
    const state = store.getState();
    expect(state.translationsByNamespace.checkout).toEqual({ Panier: "Cart" });
    expect(state.namespaces).toEqual(["default", "checkout"]);
    expect(state.lastRefreshByNamespace).toEqual({ default: BUNDLE_CURSOR, checkout: BUNDLE_CURSOR });
    expect(api.calls).toHaveLength(0);
    expect(cfg.bundle!.load).toHaveBeenCalledWith("default", "en");
    expect(cfg.bundle!.load).toHaveBeenCalledWith("checkout", "en");
    // persisted like a fetched dictionary, so the delta cursor survives a reload
    expect(storage.data.get("i18n-keyless-last-refresh")).toBe(BUNDLE_CURSOR);
  });

  it("seeds the bundled primary dictionary too, and fetches only an origin namespace the bundle does not cover", async () => {
    const api = mockFetch();
    const storage = makeStorage({
      "i18n-keyless-current-language": "fr",
      "i18n-keyless-origin-namespaces": JSON.stringify(["chat"]),
    });

    await init(config(storage));
    await flush();

    expect(store.getState().translationsByNamespace.default).toEqual({ Bonjour: "Bonjour", Merci: "Merci" });
    const fetches = api.to("/translate/fr");
    expect(fetches).toHaveLength(1);
    expect(namespaceOf(fetches[0].url)).toBe("chat");
  });

  it("fetches a language the bundle does not cover for a namespace", async () => {
    const api = mockFetch();
    const storage = makeStorage({ "i18n-keyless-current-language": "es" });

    await init(config(storage));
    await flush();

    // default/es is bundled, checkout/es is not
    expect(store.getState().translationsByNamespace.default).toEqual({ Bonjour: "Hola", Merci: "Gracias" });
    const fetches = api.to("/translate/es");
    expect(fetches).toHaveLength(1);
    expect(namespaceOf(fetches[0].url)).toBe("checkout");
  });

  it("keeps a stored slice on top of the bundle when it is newer and in the same language", async () => {
    const api = mockFetch();
    const newer = `${Number(BUNDLE_CURSOR) + 60_000}`;
    const storage = makeStorage({
      "i18n-keyless-current-language": "en",
      "i18n-keyless-namespaces": JSON.stringify(["default"]),
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello, reviewed" }),
      "i18n-keyless-last-refresh": newer,
    });

    await init(config(storage));
    await flush();

    const state = store.getState();
    expect(state.translationsByNamespace.default).toEqual({ Bonjour: "Hello, reviewed", Merci: "Thanks" });
    expect(state.lastRefreshByNamespace.default).toBe(newer);
    expect(api.to("/translate/en")).toHaveLength(0);
  });

  it("ignores a stored slice that is older than the bundle", async () => {
    mockFetch();
    const storage = makeStorage({
      "i18n-keyless-current-language": "en",
      "i18n-keyless-namespaces": JSON.stringify(["default"]),
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Old hello" }),
      "i18n-keyless-last-refresh": `${Number(BUNDLE_CURSOR) - 60_000}`,
    });

    await init(config(storage));
    await flush();

    const state = store.getState();
    expect(state.translationsByNamespace.default).toEqual({ Bonjour: "Hello", Merci: "Thanks" });
    expect(state.lastRefreshByNamespace.default).toBe(BUNDLE_CURSOR);
  });

  it("never mixes in a newer stored slice written in another language", async () => {
    mockFetch();
    const storage = makeStorage({
      // storage holds English, the app boots in Spanish (skipCurrentLanguageHydration)
      "i18n-keyless-current-language": "en",
      "i18n-keyless-namespaces": JSON.stringify(["default"]),
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello" }),
      "i18n-keyless-last-refresh": `${Number(BUNDLE_CURSOR) + 60_000}`,
    });

    await init(
      config(storage, {
        languages: { primary: "fr", supported: ["fr", "en", "es"], initWithDefault: "es", skipCurrentLanguageHydration: true },
      })
    );
    await flush();

    expect(store.currentLanguage()).toBe("es");
    expect(store.getState().translationsByNamespace.default).toEqual({ Bonjour: "Hola", Merci: "Gracias" });
  });

  it("falls back to the fetch when the loader throws", async () => {
    const api = mockFetch();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bundle = { manifest, load: vi.fn(() => Promise.reject(new Error("missing"))) };

    await init(config(storage, { bundle }));
    await flush();

    expect(api.to("/translate/en")).toHaveLength(2);
    error.mockRestore();
  });
});

describe("language switch", () => {
  it("seeds the new language from the bundle and never mixes the previous language's slice", async () => {
    const api = mockFetch();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });

    await init(config(storage));
    await flush();
    await setCurrentLanguage("es");
    await flush();

    const state = store.getState();
    expect(state.translationsByNamespace.default).toEqual({ Bonjour: "Hola", Merci: "Gracias" });
    expect(state.lastRefreshByNamespace.default).toBe(BUNDLE_CURSOR);
    // checkout has no Spanish file: fetched
    const fetches = api.to("/translate/es");
    expect(fetches).toHaveLength(1);
    expect(namespaceOf(fetches[0].url)).toBe("checkout");
  });

  it("the delta after a miss starts from the bundle cursor", async () => {
    const api = mockFetch();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });
    await init(config(storage));
    await flush();
    expect(api.calls).toHaveLength(0);

    // what the queue's `empty` handler does for a namespace that just had a miss
    const state = store.getState();
    await getAllTranslationsFromLanguage(
      state.currentLanguage,
      { ...state, lastRefresh: state.lastRefreshByNamespace["default"] ?? null },
      "default"
    );

    const fetches = api.to("/translate/en");
    expect(fetches).toHaveLength(1);
    expect(lastRefreshOf(fetches[0].url)).toBe(BUNDLE_CURSOR);
  });
});

describe("without a bundle", () => {
  it("fetches exactly as before", async () => {
    const api = mockFetch();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });

    await init(baseConfig({ languages: { primary: "fr", supported: ["fr", "en"] }, storage }));
    await flush();

    const fetches = api.to("/translate/en");
    expect(fetches).toHaveLength(1);
    expect(namespaceOf(fetches[0].url)).toBeNull();
  });
});

describe("server rendering", () => {
  it("getServerTranslations answers the bundled default dictionary and never fetches it", async () => {
    const api = mockFetch();
    const storage = makeStorage();
    const cfg = config(storage);
    await init(cfg);
    await flush();
    clearServerTranslationsCache();

    // `init` itself already seeded the primary ("fr") dictionary from the bundle at boot.
    const callsBefore = (cfg.bundle!.load as ReturnType<typeof vi.fn>).mock.calls.length;

    await expect(getServerTranslations("en")).resolves.toEqual({ Bonjour: "Hello", Merci: "Thanks" });
    await expect(getServerTranslations("en")).resolves.toEqual({ Bonjour: "Hello", Merci: "Thanks" });
    expect(cfg.bundle!.load).toHaveBeenCalledWith("default", "en");
    // cached after the first call: no second load for the same language
    expect((cfg.bundle!.load as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore + 1);
    expect(api.to("/translate/en")).toHaveLength(0);
    await expect(getServerTranslations("fr")).resolves.toEqual({});
  });
});

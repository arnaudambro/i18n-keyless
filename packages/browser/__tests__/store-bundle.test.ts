/**
 * The precompiled bundle (docs/PROTOCOL.md 7.4): a namespace the manifest covers in the
 * current language is seeded from the shipped file, with the bundle's cursor, instead of
 * fetched — at boot and on a language switch. Storage wins only when newer and in the same
 * language. Everything not covered keeps the fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetUniqueIdState, resetPendingTranslations } from "i18n-keyless-core";
import { init, getState, setCurrentLanguage, resetStore } from "../store.ts";
import { storeKeys } from "../utils.ts";
import { makeStorage, flush, baseConfig, silenceConsole } from "./helpers.ts";
import type { I18nConfig, StorageAdapter } from "../types.ts";

beforeEach(() => {
  resetStore();
  resetUniqueIdState();
  resetPendingTranslations();
  silenceConsole();
  window.localStorage.clear();
});

afterEach(async () => {
  await flush();
  vi.restoreAllMocks();
});

type FetchCall = { url: string; method: string };

/**
 * A `fetch` that speaks the i18n-keyless protocol, namespace-aware: `GET /translate/:lang`
 * answers per `(namespace, lang)` from `dictionaries`, falling back to `fallback` for a pair
 * not listed there. Both POSTs answer `ok`. Every call is recorded in `calls`.
 */
function mockNamespacedFetch(
  dictionaries: Record<string, Record<string, string>>,
  fallback: Record<string, string> = { Fetched: "From the API" }
) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, options: RequestInit = {}) => {
    const method = options.method ?? "GET";
    calls.push({ url, method });
    let payload: unknown;
    if (method === "POST" && url.endsWith("/translate/last-used-translations")) {
      payload = { ok: true, message: "" };
    } else if (method === "POST" && url.endsWith("/translate")) {
      payload = { ok: true, data: { translation: {} }, message: "" };
    } else {
      const lang = url.match(/\/translate\/([^/?]+)/)?.[1] ?? "";
      const namespace = decodeURIComponent(url.match(/[?&]namespace=([^&]+)/)?.[1] ?? "default");
      payload = {
        ok: true,
        data: { translations: dictionaries[`${namespace}/${lang}`] ?? fallback, uniqueId: "u1", lastRefresh: "999" },
        error: "",
        message: "",
      };
    }
    return { status: 200, ok: true, json: async () => payload, headers: { get: () => null } };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
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

const config = (storage: StorageAdapter | undefined, extra: Partial<I18nConfig> = {}): I18nConfig =>
  baseConfig(storage, {
    languages: { primary: "fr", supported: ["fr", "en", "es"] },
    bundle: bundleConfig(),
    ...extra,
  });

describe("boot", () => {
  it("seeds every bundled namespace in the current language, with the bundle cursor, and fetches nothing", async () => {
    const { fetchMock } = mockNamespacedFetch(files);
    const storage = makeStorage({ [storeKeys.currentLanguage]: "en" });
    const cfg = config(storage);

    await init(cfg);
    await flush();

    const state = getState();
    expect(state.currentLanguage).toBe("en");
    expect(state.translations).toEqual({ Bonjour: "Hello", Merci: "Thanks", Panier: "Cart" });
    expect(state.translationsByNamespace.checkout).toEqual({ Panier: "Cart" });
    expect(state.namespaces).toEqual(["default", "checkout"]);
    expect(state.lastRefreshByNamespace).toEqual({ default: BUNDLE_CURSOR, checkout: BUNDLE_CURSOR });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cfg.bundle!.load).toHaveBeenCalledWith("default", "en");
    expect(cfg.bundle!.load).toHaveBeenCalledWith("checkout", "en");
    // persisted like a fetched dictionary, so the delta cursor survives a reload
    expect(storage.data.get(storeKeys.lastRefresh)).toBe(BUNDLE_CURSOR);
  });

  it("seeds the bundled primary dictionary too, and fetches only an origin namespace the bundle does not cover", async () => {
    const { fetchMock, calls } = mockNamespacedFetch(files);
    const storage = makeStorage({
      [storeKeys.currentLanguage]: "fr",
      [storeKeys.originNamespaces]: JSON.stringify(["chat"]),
    });

    await init(config(storage));
    await flush();

    expect(getState().translationsByNamespace.default).toEqual({ Bonjour: "Bonjour", Merci: "Merci" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const gets = calls.filter((call) => call.method === "GET");
    expect(gets[0].url).toContain("/translate/fr");
    expect(gets[0].url).toContain("namespace=chat");
  });

  it("fetches a language the bundle does not cover for a namespace", async () => {
    const { fetchMock, calls } = mockNamespacedFetch(files);
    const storage = makeStorage({ [storeKeys.currentLanguage]: "es" });

    await init(config(storage));
    await flush();

    // default/es is bundled, checkout/es is not
    expect(getState().translationsByNamespace.default).toEqual({ Bonjour: "Hola", Merci: "Gracias" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toContain("namespace=checkout");
    expect(getState().translationsByNamespace.checkout).toEqual({ Fetched: "From the API" });
  });

  it("keeps a stored slice on top of the bundle when it is newer and in the same language", async () => {
    const { fetchMock } = mockNamespacedFetch(files);
    const newer = `${Number(BUNDLE_CURSOR) + 60_000}`;
    const storage = makeStorage({
      [storeKeys.currentLanguage]: "en",
      [storeKeys.namespaces]: JSON.stringify(["default"]),
      [storeKeys.translations]: JSON.stringify({ Bonjour: "Hello, reviewed" }),
      [storeKeys.lastRefresh]: newer,
    });

    await init(config(storage));
    await flush();

    const state = getState();
    expect(state.translationsByNamespace.default).toEqual({ Bonjour: "Hello, reviewed", Merci: "Thanks" });
    expect(state.lastRefreshByNamespace.default).toBe(newer);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a stored slice that is older than the bundle", async () => {
    mockNamespacedFetch(files);
    const storage = makeStorage({
      [storeKeys.currentLanguage]: "en",
      [storeKeys.namespaces]: JSON.stringify(["default"]),
      [storeKeys.translations]: JSON.stringify({ Bonjour: "Old hello" }),
      [storeKeys.lastRefresh]: `${Number(BUNDLE_CURSOR) - 60_000}`,
    });

    await init(config(storage));
    await flush();

    expect(getState().translationsByNamespace.default).toEqual({ Bonjour: "Hello", Merci: "Thanks" });
    expect(getState().lastRefreshByNamespace.default).toBe(BUNDLE_CURSOR);
  });

  it("never mixes in a newer stored slice written in another language", async () => {
    mockNamespacedFetch(files);
    const storage = makeStorage({
      // storage holds English, the app boots in Spanish (skipCurrentLanguageHydration)
      [storeKeys.currentLanguage]: "en",
      [storeKeys.namespaces]: JSON.stringify(["default"]),
      [storeKeys.translations]: JSON.stringify({ Bonjour: "Hello" }),
      [storeKeys.lastRefresh]: `${Number(BUNDLE_CURSOR) + 60_000}`,
    });

    await init(
      config(storage, {
        languages: { primary: "fr", supported: ["fr", "en", "es"], initWithDefault: "es", skipCurrentLanguageHydration: true },
      })
    );
    await flush();

    expect(getState().currentLanguage).toBe("es");
    expect(getState().translationsByNamespace.default).toEqual({ Bonjour: "Hola", Merci: "Gracias" });
  });

  it("falls back to the fetch when the loader throws", async () => {
    const { fetchMock } = mockNamespacedFetch(files);
    const storage = makeStorage({ [storeKeys.currentLanguage]: "en" });
    const bundle = { manifest, load: vi.fn(() => Promise.reject(new Error("missing"))) };

    await init(config(storage, { bundle }));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("language switch", () => {
  it("seeds the new language from the bundle and never mixes the previous language's slice", async () => {
    const { fetchMock, calls } = mockNamespacedFetch(files);
    const storage = makeStorage({ [storeKeys.currentLanguage]: "en" });

    await init(config(storage));
    await flush();
    await setCurrentLanguage("es");
    await flush();

    expect(getState().translationsByNamespace.default).toEqual({ Bonjour: "Hola", Merci: "Gracias" });
    expect(getState().lastRefreshByNamespace.default).toBe(BUNDLE_CURSOR);
    // checkout has no Spanish file: fetched
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toContain("namespace=checkout");
  });

  it("the delta after a miss starts from the bundle cursor", async () => {
    const { calls } = mockNamespacedFetch(files);
    const storage = makeStorage({ [storeKeys.currentLanguage]: "en" });
    await init(config(storage));
    await flush();

    // what the queue's `empty` handler does for a namespace that just had a miss
    const core = await import("i18n-keyless-core");
    const current = getState();
    await core.getAllTranslationsFromLanguage(
      current.currentLanguage,
      { ...current, lastRefresh: current.lastRefreshByNamespace["default"] ?? null },
      "default"
    );

    const lastCall = calls[calls.length - 1];
    expect(lastCall.url).toContain(`last_refresh=${BUNDLE_CURSOR}`);
  });
});

describe("without a bundle", () => {
  it("fetches exactly as before", async () => {
    const { fetchMock, calls } = mockNamespacedFetch(files);
    const storage = makeStorage({ [storeKeys.currentLanguage]: "en" });

    await init(baseConfig(storage, { languages: { primary: "fr", supported: ["fr", "en"] } }));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0].url).not.toContain("namespace=");
  });
});

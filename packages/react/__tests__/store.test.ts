import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import packageJson from "../package.json";
import { mockStore, mockStorage } from "./__mocks__/store";
import { useI18nKeyless, init, getTranslation, hydrateFromServer } from "../store";
import { runWithI18nKeyless, getUsedTranslationsSnapshot } from "../request-scope";
import {
  getTranslationCore,
  getAllTranslationsFromLanguage,
  getNamespacesToFetchAfterTranslationFinished,
  sendTranslationsUsageToI18nKeyless,
  queue,
} from "i18n-keyless-core";
// These vi.mock calls must be at the top level, outside of any function or block
vi.mock("zustand", () => ({
  create: () => ({
    getState: mockStore.getState,
    setState: mockStore.setState,
    subscribe: mockStore.subscribe,
  }),
}));

vi.mock("../store", async () => {
  const actual = await vi.importActual("../store");
  return {
    useI18nKeyless: mockStore,
    useCurrentLanguage: vi.fn(),
    getTranslationCore: vi.fn(),
    setCurrentLanguage: vi.fn(),
    getAllTranslationsFromLanguage: vi.fn(),
    clearI18nKeylessStorage: vi.fn(),
    init: actual.init,
    getTranslation: actual.getTranslation,
    hydrateFromServer: actual.hydrateFromServer,
  };
});

// Mock fetch for API calls
global.fetch = vi.fn();

describe("i18n-keyless store", () => {
  // Save original console methods
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleLog = console.log;

  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
    console.warn = vi.fn();
    console.log = vi.fn();

    useI18nKeyless.setState({ translations: {} });
    // The store is automatically reset by the zustand mock
  });

  afterEach(() => {
    // Restore original console methods
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.log = originalConsoleLog;
  });

  describe("init function", () => {
    it("should throw an error if languages is not provided", async () => {
      // @ts-expect-error Testing invalid config
      await expect(init({ storage: mockStorage })).rejects.toThrow("i18n-keyless: languages is required");
    });

    it("should throw an error if primary language is not provided", async () => {
      await expect(
        // @ts-expect-error Testing invalid config
        init({ languages: { supported: ["en", "fr"] }, storage: mockStorage })
      ).rejects.toThrow("i18n-keyless: primary is required");
    });

    it("should throw an error if storage is not provided", async () => {
      await expect(
        // @ts-expect-error Testing invalid config
        init({ languages: { primary: "en", supported: ["en", "fr"] } })
      ).rejects.toThrow("i18n-keyless: storage is required");
    });

    it("should throw an error if no API or custom handlers are provided", async () => {
      await expect(
        // @ts-expect-error Testing invalid config
        init({
          languages: { primary: "en", supported: ["en", "fr"] },
          storage: mockStorage,
        })
      ).rejects.toThrow(
        "i18n-keyless: you didn't provide an API_KEY nor an API_URL nor a handleTranslate + getAllTranslations function"
      );
    });

    it("should initialize with API_KEY correctly", async () => {
      await init({
        languages: {
          primary: "en",
          supported: ["en", "fr"],
        },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });

      expect(useI18nKeyless.getState().config).toEqual({
        addMissingTranslations: true,
        languages: {
          fallback: "en",
          initWithDefault: "en",
          primary: "en",
          supported: ["en", "fr"],
        },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });
    });

    it("should initialize with custom handlers correctly", async () => {
      const handleTranslate = vi.fn();
      const getAllTranslations = vi.fn();

      await init({
        languages: {
          primary: "en",
          supported: ["en", "fr"],
        },
        API_KEY: "test-api-key",
        storage: mockStorage,
        handleTranslate,
        getAllTranslations,
      });

      expect(useI18nKeyless.getState().config).toEqual({
        API_KEY: "test-api-key",
        addMissingTranslations: true,
        languages: {
          fallback: "en",
          initWithDefault: "en",
          primary: "en",
          supported: ["en", "fr"],
        },
        storage: mockStorage,
        handleTranslate,
        getAllTranslations,
      });
    });

    it("should add initWithDefault to supported languages if not already included", async () => {
      await init({
        languages: {
          primary: "en",
          supported: ["fr"],
          initWithDefault: "en",
        },
        API_KEY: "test-api-key",
        storage: mockStorage,
      });

      expect(useI18nKeyless.getState().config?.languages.supported).toContain("en");
    });

    it("should call onInit callback with current language", async () => {
      const onInit = vi.fn().mockImplementation((lang) => lang);

      const onInitReturned = onInit("fr");

      await act(async () => {
        await init({
          languages: {
            primary: "en",
            supported: ["en", "fr"],
          },
          storage: mockStorage,
          API_KEY: "test-api-key",
          onInit,
        });
      });

      expect(onInit.mock.calls[0][0]).toBe("fr");
      expect(onInitReturned).toBe("fr");
    });
  });

  describe("hydration", () => {
    it("should hydrate from storage correctly", async () => {
      mockStorage.getItem.mockImplementation((key) => {
        if (key === "i18n-keyless-current-language") return "fr";
        if (key === "i18n-keyless-translations") return JSON.stringify({ Hello: { fr: "Bonjour" } });
        return Promise.resolve(null);
      });

      await init({
        languages: {
          primary: "en",
          supported: ["en", "fr"],
        },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });

      expect(useI18nKeyless.getState().currentLanguage).toBe("fr");
      expect(useI18nKeyless.getState().translations).toEqual({ Hello: { fr: "Bonjour" } });
    });

    it("should use initWithDefault when no language is stored", async () => {
      mockStorage.getItem.mockResolvedValue(null);

      await init({
        languages: {
          primary: "en",
          supported: ["en", "fr"],
          initWithDefault: "fr",
        },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });

      expect(useI18nKeyless.getState().currentLanguage).toBe("fr");
    });

    it("upgrades a v2 language code persisted by a previous install", async () => {
      // v2 spelled Simplified Chinese "cn"; v3 spells it "zh-Hans".
      mockStorage.getItem.mockImplementation((key) => {
        if (key === "i18n-keyless-current-language") return "cn";
        return Promise.resolve(null);
      });

      await init({
        languages: {
          primary: "en",
          supported: ["en", "zh-Hans"],
        },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });

      // The user keeps the language they had picked instead of being reset to the fallback...
      expect(useI18nKeyless.getState().currentLanguage).toBe("zh-Hans");
      // ...and the upgrade is written back, so it only ever happens once.
      expect(mockStorage.setItem).toHaveBeenCalledWith("i18n-keyless-current-language", "zh-Hans");
    });

    it("keeps a v2 language code that did not change in v3", async () => {
      mockStorage.getItem.mockImplementation((key) => {
        if (key === "i18n-keyless-current-language") return "fr";
        return Promise.resolve(null);
      });

      await init({
        languages: {
          primary: "en",
          supported: ["en", "fr"],
        },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });

      expect(useI18nKeyless.getState().currentLanguage).toBe("fr");
    });
  });

  describe("Translation functionality", () => {
    beforeEach(async () => {
      // Reset store and initialize with basic config
      await init({
        languages: {
          primary: "en",
          supported: ["en", "fr", "es"],
        },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });
    });

    it("should return original text when current language is primary language", () => {
      useI18nKeyless.setState({ currentLanguage: "en" });
      const store = useI18nKeyless.getState();
      const result = getTranslationCore("Hello World", store);
      expect(result).toBe("Hello World");
    });

    it("should return original text when current language is primary language whatever context there is", () => {
      useI18nKeyless.setState({ currentLanguage: "en" });
      const store = useI18nKeyless.getState();
      const result = getTranslationCore("Hello World again", store, { context: "whatever" });
      expect(result).toBe("Hello World again");
    });

    it("should handle translations with context", () => {
      useI18nKeyless.setState({
        currentLanguage: "fr",
        translations: {
          Welcome__header: "Bienvenue",
          "Good bye__footer": "Au revoir",
        },
      });

      const store = useI18nKeyless.getState();
      const headerResult = getTranslationCore("Welcome", store, { context: "header" });
      const footerResult = getTranslationCore("Good bye", store, { context: "footer" });

      expect(headerResult).toBe("Bienvenue");
      expect(footerResult).toBe("Au revoir");
    });

    it("forceTemporary should works when no translation is available", () => {
      useI18nKeyless.setState({ currentLanguage: "fr" });
      const store = useI18nKeyless.getState();
      // Mock fetch for API calls
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, data: { translations: {} } }),
      });

      const result = getTranslationCore("Hungry", store, {
        forceTemporary: {
          fr: "J'ai faim",
        },
      });

      // return Hello because translation is not available in fr
      expect(result).toBe("Hungry");
      // expect fetch to have been called with the correct params
      expect(fetch).toHaveBeenCalledWith("https://api.i18n-keyless.com/translate", {
        body: JSON.stringify({
          key: "Hungry",
          forceTemporary: {
            fr: "J'ai faim",
          },
          languages: ["en", "fr", "es"],
          primaryLanguage: "en",
        }),
        headers: {
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json",
          Version: packageJson.version,
          unique_id: "",
        },
        method: "POST",
      });
    });

    it("forceTemporary should works when translation is available", () => {
      useI18nKeyless.setState({ currentLanguage: "fr", translations: { Happiness: "Joie" } });
      const store = useI18nKeyless.getState();
      // Mock fetch for API calls
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      });

      const result = getTranslationCore("Happiness", store, {
        forceTemporary: {
          fr: "Joie temporaire",
        },
      });

      // return Joie because translation forced is not there yet
      expect(result).toBe("Joie");
      // expect fetch to have been called with the correct params
      expect(fetch).toHaveBeenCalledWith("https://api.i18n-keyless.com/translate", {
        body: JSON.stringify({
          key: "Happiness",
          forceTemporary: {
            fr: "Joie temporaire",
          },
          languages: ["en", "fr", "es"],
          primaryLanguage: "en",
        }),
        headers: {
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json",
          Version: packageJson.version,
          unique_id: "",
        },
        method: "POST",
      });
    });

    it("should queue translation requests when translation is missing", () => {
      useI18nKeyless.setState({ currentLanguage: "fr" });
      const store = useI18nKeyless.getState();
      const queueSpy = vi.spyOn(queue, "add");

      getTranslationCore("Missing Translation", store);

      expect(queueSpy).toHaveBeenCalled();
    });

    it("should handle API translation errors gracefully", async () => {
      useI18nKeyless.setState({ currentLanguage: "fr" });
      const store = useI18nKeyless.getState();

      // Mock a failed API call
      global.fetch = vi.fn().mockRejectedValue(new Error("API Error"));
      useI18nKeyless.setState({ currentLanguage: "fr" });

      getTranslationCore("Test Error", store);

      // Wait for async queue to process
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("i18n-keyless: fetch all translations error:"),
        new Error("API Error")
      );
    });

    it("should not translate empty strings", () => {
      useI18nKeyless.setState({ currentLanguage: "fr" });
      const store = useI18nKeyless.getState();
      const queueSpy = vi.spyOn(queue, "add");

      getTranslationCore("", store);

      expect(queueSpy).not.toHaveBeenCalled();
    });

    it("should handle debug mode logging", async () => {
      // Clear any previous async operations
      vi.clearAllMocks();

      useI18nKeyless.setState({ currentLanguage: "fr" });
      const store = useI18nKeyless.getState();

      getTranslationCore("Debug Test", store, { debug: true });

      // Wait for any async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(console.log).toHaveBeenCalled();
    });
  });

  describe("Storage operations", () => {
    it("should handle malformed JSON in storage", async () => {
      vi.clearAllMocks();

      mockStorage.getItem.mockImplementation((key) => {
        if (key === "i18n-keyless-translations") return "invalid json";
        return null;
      });

      await init({
        languages: {
          primary: "en",
          supported: ["en", "fr"],
        },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });

      expect(useI18nKeyless.getState().translations).toEqual({});
    });
  });

  describe("namespaces", () => {
    beforeEach(async () => {
      await init({
        languages: { primary: "en", supported: ["en", "fr", "es"] },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });
    });

    it("includes a non-default namespace in the POST /translate body", () => {
      useI18nKeyless.setState({ currentLanguage: "fr", translations: {} });
      const store = useI18nKeyless.getState();
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, data: { translations: {} } }),
      });

      getTranslationCore("Pay now", store, { namespace: "checkout" });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.i18n-keyless.com/translate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            key: "Pay now",
            namespace: "checkout",
            languages: ["en", "fr", "es"],
            primaryLanguage: "en",
          }),
        })
      );
    });

    it("omits the default namespace from the POST body (unchanged wire format)", () => {
      useI18nKeyless.setState({ currentLanguage: "fr", translations: {} });
      const store = useI18nKeyless.getState();
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, data: { translations: {} } }),
      });

      getTranslationCore("Default key", store);

      const body = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string;
      expect(body).not.toContain("namespace");
    });

    it("appends &namespace= to the bulk fetch URL for a non-default namespace", async () => {
      const store = useI18nKeyless.getState();
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, data: { translations: {} } }),
      });

      await getAllTranslationsFromLanguage("fr", { ...store, lastRefresh: null }, "checkout");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/translate/fr?last_refresh=null&namespace=checkout"),
        expect.anything()
      );
    });

    it("omits the namespace from the bulk fetch URL for the default namespace", async () => {
      const store = useI18nKeyless.getState();
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, data: { translations: {} } }),
      });

      await getAllTranslationsFromLanguage("fr", { ...store, lastRefresh: null }, "default");

      const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).not.toContain("namespace");
    });

    it("hydrates and merges translations from multiple namespace storage keys", async () => {
      mockStorage.getItem.mockImplementation((key: string) => {
        if (key === "i18n-keyless-namespaces") return JSON.stringify(["default", "checkout"]);
        if (key === "i18n-keyless-translations") return JSON.stringify({ Hello: "Bonjour" });
        if (key === "i18n-keyless-translations__checkout") return JSON.stringify({ Pay: "Payer" });
        if (key === "i18n-keyless-current-language") return "fr";
        return Promise.resolve(null);
      });

      await init({
        languages: { primary: "en", supported: ["en", "fr"] },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });

      const state = useI18nKeyless.getState();
      expect(state.translations).toEqual({ Hello: "Bonjour", Pay: "Payer" });
      expect(state.translationsByNamespace).toEqual({
        default: { Hello: "Bonjour" },
        checkout: { Pay: "Payer" },
      });
      expect(state.namespaces).toEqual(["default", "checkout"]);
    });

    it("sends usage as a single map keyed by namespace, default under 'default'", async () => {
      const store = useI18nKeyless.getState();
      global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true }) });

      await sendTranslationsUsageToI18nKeyless(
        { default: { Hello: "2026-06-22" }, checkout: { Pay: "2026-06-22" } },
        store
      );
      const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
      // no legacy flat field anymore
      expect(body.translationsUsage).toBeUndefined();
      expect(body.translationsUsageByNamespace).toEqual({
        default: { Hello: "2026-06-22" },
        checkout: { Pay: "2026-06-22" },
      });
    });

    it("carries the unpersistedNamespace flag from the call through to the fetch list", () => {
      getNamespacesToFetchAfterTranslationFinished(); // drain anything queued by earlier tests
      useI18nKeyless.setState({ currentLanguage: "fr", translations: {} });
      const store = useI18nKeyless.getState();
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, data: { translations: {} } }),
      });

      getTranslationCore("Open thread", store, { namespace: "discussion-1", unpersistedNamespace: true });

      // Read synchronously, before the queue empties and the store's handler consumes it.
      const toFetch = getNamespacesToFetchAfterTranslationFinished();
      expect(toFetch).toContainEqual({ namespace: "discussion-1", unpersisted: true });
    });

    it("hydrates a pre-namespace install (legacy key, no index) as the default namespace", async () => {
      mockStorage.getItem.mockImplementation((key: string) => {
        if (key === "i18n-keyless-translations") return JSON.stringify({ Hello: "Bonjour" });
        return Promise.resolve(null); // no namespaces index → backward-compat path
      });

      await init({
        languages: { primary: "en", supported: ["en", "fr"] },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });

      const state = useI18nKeyless.getState();
      expect(state.translations).toEqual({ Hello: "Bonjour" });
      expect(state.namespaces).toEqual(["default"]);
      expect(state.translationsByNamespace).toEqual({ default: { Hello: "Bonjour" } });
    });
  });

  describe("SSR / server-side behavior", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("defaults to in-memory storage on the server when no storage is provided", async () => {
      vi.stubGlobal("window", undefined);
      await init({
        languages: { primary: "en", supported: ["en", "fr"] },
        API_KEY: "test-api-key",
      });
      const storage = useI18nKeyless.getState().config.storage;
      expect(storage).toBeDefined();
      expect(typeof storage!.getItem).toBe("function");
      expect(typeof storage!.setItem).toBe("function");
    });

    it("still throws when no storage is provided on the client", async () => {
      // window is defined under happy-dom → client behavior
      await expect(
        init({ languages: { primary: "en", supported: ["en", "fr"] }, API_KEY: "test-api-key" })
      ).rejects.toThrow("i18n-keyless: storage is required");
    });

    it("does not send usage stats on init when running on the server", async () => {
      vi.stubGlobal("window", undefined);
      const store = useI18nKeyless.getState();
      store.sendTranslationsUsage = vi.fn();
      await init({
        languages: { primary: "en", supported: ["en", "fr"] },
        API_KEY: "test-api-key",
      });
      expect(store.sendTranslationsUsage).not.toHaveBeenCalled();
    });

    it("sends usage stats on init on the client", async () => {
      const store = useI18nKeyless.getState();
      store.sendTranslationsUsage = vi.fn();
      await init({
        languages: { primary: "en", supported: ["en", "fr"] },
        storage: mockStorage,
        API_KEY: "test-api-key",
      });
      expect(store.sendTranslationsUsage).toHaveBeenCalled();
    });

    it("does not record usage in getTranslation when the ssr flag is set", () => {
      const store = useI18nKeyless.getState();
      store.setTranslationUsage = vi.fn();
      useI18nKeyless.setState({
        currentLanguage: "fr",
        config: {
          API_KEY: "test-api-key",
          ssr: true,
          languages: { primary: "en", supported: ["en", "fr"] },
          storage: mockStorage,
        },
      });
      getTranslation("Hello");
      expect(store.setTranslationUsage).not.toHaveBeenCalled();
    });

    it("records usage in getTranslation on the client — but DEFERRED, never synchronously during render", async () => {
      const store = useI18nKeyless.getState();
      store.setTranslationUsage = vi.fn();
      useI18nKeyless.setState({
        currentLanguage: "fr",
        config: {
          API_KEY: "test-api-key",
          languages: { primary: "en", supported: ["en", "fr"] },
          storage: mockStorage,
        },
      });
      getTranslation("Hello");
      // Bug 2: no synchronous store write during the caller's render (would make React
      // log "Cannot update a component while rendering").
      expect(store.setTranslationUsage).not.toHaveBeenCalled();
      // …but it is still recorded, on a microtask, after render.
      await Promise.resolve();
      expect(store.setTranslationUsage).toHaveBeenCalledWith("Hello", undefined, undefined, undefined);
    });

    it("getTranslation honors the per-request scope under runWithI18nKeyless (SSR)", async () => {
      vi.stubGlobal("window", undefined);
      // Store is on the primary language with no translations…
      useI18nKeyless.setState({
        currentLanguage: "en",
        translations: {},
        config: {
          API_KEY: "test-api-key",
          languages: { primary: "en", supported: ["en", "fr", "es"] },
          storage: mockStorage,
        },
      });
      // …but the request scope says Spanish with its own translations.
      const result = await runWithI18nKeyless(
        { lang: "es", translations: { Hello: "Hola" } },
        () => getTranslation("Hello")
      );
      expect(result).toBe("Hola");
      // Outside the scope, the store wins again (primary → source text).
      expect(getTranslation("Hello")).toBe("Hello");
    });

    it("getTranslation resolves any key from the full scope; the snapshot narrows to used keys", async () => {
      vi.stubGlobal("window", undefined);
      useI18nKeyless.setState({
        currentLanguage: "en",
        translations: {},
        config: {
          API_KEY: "test-api-key",
          languages: { primary: "fr", supported: ["fr", "en"] },
          storage: mockStorage,
        },
      });
      const out = await runWithI18nKeyless(
        { lang: "en", translations: { Accueil: "Home", Profil: "Profile", Param: "Settings" } },
        () => {
          const a = getTranslation("Accueil");
          const b = getTranslation("Profil"); // a key not seeded in the store — resolves from the full scope
          return { a, b, snapshot: getUsedTranslationsSnapshot() };
        }
      );
      expect(out.a).toBe("Home");
      expect(out.b).toBe("Profile");
      // Only the rendered keys are serialized; "Param" (never used) is excluded.
      expect(out.snapshot).toEqual({ lang: "en", translations: { Accueil: "Home", Profil: "Profile" } });
    });
  });

  describe("Language fallback behavior", () => {
    it("should use fallback language when current language is not supported", () => {
      useI18nKeyless.setState({
        currentLanguage: "fr",
        translations: {},
        config: {
          languages: {
            primary: "en",
            supported: ["en", "fr", "es"],
            fallback: "es",
          },
          API_KEY: "test-api-key",
          storage: mockStorage,
        },
      });

      useI18nKeyless.getState().setLanguage("pt"); // pt is not supported
      const store = useI18nKeyless.getState();
      expect(store.currentLanguage).toBe("es");
    });
  });

  // Kept last: hydrateFromServer flips a module flag that changes how hydrate() behaves
  // for the rest of this module's lifetime, so it must not run before other tests.
  describe("SSR snapshot hydration (hydrateFromServer)", () => {
    it("seeds currentLanguage and translations synchronously", () => {
      hydrateFromServer({ lang: "es", translations: { Hello: "Hola" } });
      expect(useI18nKeyless.getState().currentLanguage).toBe("es");
      expect(useI18nKeyless.getState().translations).toMatchObject({ Hello: "Hola" });
    });

    it("makes getTranslation return the seeded language on the first synchronous call", () => {
      useI18nKeyless.setState({
        translations: {},
        config: {
          API_KEY: "test-api-key",
          languages: { primary: "en", supported: ["en", "es"] },
          storage: mockStorage,
        },
      });
      hydrateFromServer({ lang: "es", translations: { Hello: "Hola" } });
      // Bug 1: first render must already be in the seeded language (no blink / mismatch).
      expect(getTranslation("Hello")).toBe("Hola");
    });

    it("is a no-op when given no/invalid snapshot", () => {
      useI18nKeyless.setState({ currentLanguage: "fr" });
      hydrateFromServer(undefined);
      hydrateFromServer({ translations: { Hello: "Hola" } }); // no lang
      expect(useI18nKeyless.getState().currentLanguage).toBe("fr");
    });

    it("init's async hydrate does NOT clobber the seed on a cold cache", async () => {
      mockStorage.getItem.mockResolvedValue(null); // cold cache: storage empty
      hydrateFromServer({ lang: "es", translations: { Hello: "Hola" } });
      await init({
        languages: { primary: "en", supported: ["en", "es"] },
        API_KEY: "test-api-key",
        storage: mockStorage,
      });
      // Seed survives: language stays "es" (not reset to primary), translations preserved.
      expect(useI18nKeyless.getState().currentLanguage).toBe("es");
      expect(useI18nKeyless.getState().translations).toMatchObject({ Hello: "Hola" });
    });
  });
});

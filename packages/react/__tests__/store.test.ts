import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import packageJson from "../package.json";
import { mockStore, mockStorage } from "./__mocks__/store";
import { useI18nKeyless, init } from "../store";
import { getTranslation, queue } from "i18n-keyless-core";
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
    getTranslation: vi.fn(),
    setCurrentLanguage: vi.fn(),
    fetchAllTranslations: vi.fn(),
    clearI18nKeylessStorage: vi.fn(),
    init: actual.init,
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
      const result = getTranslation("Hello World", store);
      expect(result).toBe("Hello World");
    });

    it("should return original text when current language is primary language whatever context there is", () => {
      useI18nKeyless.setState({ currentLanguage: "en" });
      const store = useI18nKeyless.getState();
      const result = getTranslation("Hello World again", store, { context: "whatever" });
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
      const headerResult = getTranslation("Welcome", store, { context: "header" });
      const footerResult = getTranslation("Good bye", store, { context: "footer" });

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

      const result = getTranslation("Hungry", store, {
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

      const result = getTranslation("Happiness", store, {
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

      getTranslation("Missing Translation", store);

      expect(queueSpy).toHaveBeenCalled();
    });

    it("should handle API translation errors gracefully", async () => {
      useI18nKeyless.setState({ currentLanguage: "fr" });
      const store = useI18nKeyless.getState();

      // Mock a failed API call
      global.fetch = vi.fn().mockRejectedValue(new Error("API Error"));
      useI18nKeyless.setState({ currentLanguage: "fr" });

      getTranslation("Test Error", store);

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

      getTranslation("", store);

      expect(queueSpy).not.toHaveBeenCalled();
    });

    it("should handle debug mode logging", async () => {
      // Clear any previous async operations
      vi.clearAllMocks();

      useI18nKeyless.setState({ currentLanguage: "fr" });
      const store = useI18nKeyless.getState();

      getTranslation("Debug Test", store, { debug: true });

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
});

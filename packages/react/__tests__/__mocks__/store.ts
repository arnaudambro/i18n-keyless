import { type TranslationStore } from "../../types";
import { vi } from "vitest";
import { validateLanguage } from "../../utils";
import type { Lang, PrimaryLang } from "i18n-keyless-core";

export const store: TranslationStore = {
  config: {
    API_KEY: "any-fucking-keyk",
    languages: {
      primary: "fr" as PrimaryLang,
      supported: ["fr"] as Lang[],
    },
  },
  currentLanguage: "fr",
  translations: {},
  lastUsedTranslations: {},
  uniqueId: null,
  lastRefresh: null,
  setTranslations: vi.fn(),
  setLanguage: vi.fn((lang) => {
    const validated = validateLanguage(lang, store.config!);
    store.currentLanguage = validated!;
  }),
  sendTranslationsUsage: vi.fn(),
  setTranslationUsage: vi.fn(),
};

// Create a function that supports the selector pattern
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const useI18nKeylessMock = ((selectorOrStore: any) => {
  // If it's a function (selector), call it with the store
  if (typeof selectorOrStore === "function") {
    return selectorOrStore(store);
  }
  // Otherwise return the store
  return store;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

// Add the getState and setState methods to the mock function
useI18nKeylessMock.getState = vi.fn(() => store);
useI18nKeylessMock.setState = vi.fn((newState) => Object.assign(store, newState));

export const mockStore = useI18nKeylessMock;

export const mockStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clearAll: vi.fn(),
};

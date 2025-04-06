import { TranslationStore } from "i18n-keyless-core";
import { validateLanguage } from "../../utils";
import { vi } from "vitest";

export const store: TranslationStore = {
  config: null,
  currentLanguage: "fr",
  translations: {},
  uniqueId: null,
  lastRefresh: null,
  setTranslations: vi.fn(),
  setLanguage: vi.fn((lang) => {
    const validated = validateLanguage(lang, store.config!);
    store.currentLanguage = validated!;
  }),
};

// Create a function that supports the selector pattern
const useI18nKeylessMock = ((selectorOrStore: any) => {
  // If it's a function (selector), call it with the store
  if (typeof selectorOrStore === "function") {
    return selectorOrStore(store);
  }
  // Otherwise return the store
  return store;
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

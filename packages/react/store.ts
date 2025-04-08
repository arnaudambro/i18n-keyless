import {
  type Lang,
  type I18nKeylessResponse,
  type Translations,
  type TranslationOptions,
  queue,
  getAllTranslationsFromLanguage,
  getTranslationCore,
} from "i18n-keyless-core";
import { type I18nConfig, type TranslationStore } from "./types";
import { create } from "zustand";
import { storeKeys, setItem, getItem, clearI18nKeylessStorage, validateLanguage } from "./utils";

queue.on("empty", () => {
  // when each word is translated, fetch the translations for the current language
  const store = useI18nKeyless.getState();
  if (store.config) {
    getAllTranslationsFromLanguage(store.currentLanguage, store).then(store.setTranslations);
  }
});

export const useI18nKeyless = create<TranslationStore>((set, get) => ({
  uniqueId: null,
  lastRefresh: null,
  translations: {},
  currentLanguage: "fr",
  config: {
    API_KEY: "",
    languages: {
      primary: "fr",
      supported: ["fr"],
    },
    storage: undefined,
  },
  setTranslations: (response: I18nKeylessResponse | void) => {
    if (!response?.ok) {
      return;
    }
    const config = get().config;
    if (!config.API_KEY) {
      throw new Error(`i18n-keyless: config is not initialized setting translations`);
    }
    const newTranslations = response.data.translations;
    const nextTranslations = { ...get().translations, ...newTranslations };
    set({ translations: nextTranslations });
    const storage = config.storage;
    if (!storage) {
      throw new Error(`i18n-keyless: storage is not initialized setting translations`);
    }
    setItem(storeKeys.translations, JSON.stringify(nextTranslations), storage);
    if (response.data.uniqueId) {
      set({ uniqueId: response.data.uniqueId });
      setItem(storeKeys.uniqueId, response.data.uniqueId, storage);
    }

    if (response.data.lastRefresh) {
      set({ lastRefresh: response.data.lastRefresh });
      setItem(storeKeys.lastRefresh, response.data.lastRefresh, storage);
    }
  },
  setLanguage: async (lang: I18nConfig["languages"]["supported"][number]) => {
    const store = get();
    if (!store.config) {
      throw new Error(`i18n-keyless: config is not initialized setting translations`);
    }
    const debug = store.config.debug;
    const validatedLang = validateLanguage(lang, store.config);
    if (validatedLang !== lang) {
      if (debug) console.log("i18n-keyless: language", lang, "is not supported, fallback to", validatedLang);
    } else {
      if (debug) console.log("i18n-keyless: setLanguage", lang);
    }

    set({ currentLanguage: validatedLang });
    if (store.config.storage) {
      setItem(storeKeys.currentLanguage, validatedLang!, store.config.storage);
    }

    // Only fetch translations if the new language is not the primary language
    if (lang !== store.config.languages.primary) {
      await getAllTranslationsFromLanguage(lang, store).then(store.setTranslations);
    }
  },
}));

async function hydrate() {
  const config = useI18nKeyless.getState().config;
  if (!config.API_KEY) {
    throw new Error(`i18n-keyless: config is not initialized hydrating`);
  }
  const storage = config.storage;
  const debug = config.debug;
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized hydrating`);
  }
  const translations = await getItem(storeKeys.translations, storage, JSON.parse);
  if (translations) {
    if (debug) console.log("i18n-keyless: _hydrate", translations);
    useI18nKeyless.setState({ translations: translations as Translations });
  } else {
    if (debug) console.log("i18n-keyless: _hydrate: no translations");
  }
  const currentLanguage = await getItem(storeKeys.currentLanguage, storage);
  if (currentLanguage) {
    if (debug) console.log("i18n-keyless: _hydrate", currentLanguage);
    useI18nKeyless.setState({ currentLanguage: currentLanguage as Lang });
  } else {
    if (debug) console.log("i18n-keyless: _hydrate: no current language");
    useI18nKeyless.setState({ currentLanguage: useI18nKeyless.getState().config?.languages.initWithDefault });
  }
  const uniqueId = await getItem(storeKeys.uniqueId, storage);
  if (uniqueId) {
    useI18nKeyless.setState({ uniqueId: uniqueId as string });
  }
  const lastRefresh = await getItem(storeKeys.lastRefresh, storage);
  if (lastRefresh) {
    useI18nKeyless.setState({ lastRefresh: lastRefresh as string });
  }
}

/**
 * Initializes the i18n configuration with defaults and validation
 * @param newConfig - The configuration object to initialize
 * @returns The validated and completed configuration
 * @throws Error if required configuration properties are missing
 */
export async function init(newConfig: Omit<I18nConfig, "getAllTranslationsForAllLanguages">) {
  if (!newConfig.languages) {
    throw new Error("i18n-keyless: languages is required");
  }
  if (!newConfig.languages.primary) {
    throw new Error("i18n-keyless: primary is required");
  }
  if (!newConfig.languages.initWithDefault) {
    newConfig.languages.initWithDefault = newConfig.languages.primary;
  }
  if (!newConfig.languages.fallback) {
    newConfig.languages.fallback = newConfig.languages.primary;
  }
  if (!newConfig.languages.supported.includes(newConfig.languages.initWithDefault)) {
    newConfig.languages.supported.push(newConfig.languages.initWithDefault);
  }
  if (!newConfig.storage) {
    console.log("storage is required", newConfig.storage);
    throw new Error(
      "i18n-keyless: storage is required. You can use react-native-mmkv, @react-native-async-storage/async-storage, or window.localStorage, or any storage that has a getItem, setItem, removeItem, or get, set, and remove method"
    );
  }
  if (!newConfig.getAllTranslations || !newConfig.handleTranslate) {
    if (!newConfig.API_KEY) {
      if (!newConfig.API_URL) {
        throw new Error(
          "i18n-keyless: you didn't provide an API_KEY nor an API_URL nor a handleTranslate + getAllTranslations function. You need to provide one of them to make i18n-keyless work"
        );
      }
    }
  }
  if (newConfig.addMissingTranslations !== false) {
    // default to true
    newConfig.addMissingTranslations = true;
  }
  if (!newConfig.API_KEY) {
    throw new Error(`i18n-keyless: API_KEY is required`);
  }

  useI18nKeyless.setState({ config: newConfig });
  await hydrate();
  const currentLanguage = useI18nKeyless.getState().currentLanguage;
  newConfig.onInit?.(currentLanguage);
}

export function useCurrentLanguage(): Lang | null {
  const currentLanguage = useI18nKeyless((state) => state.currentLanguage);
  return currentLanguage;
}

export function getTranslation(key: string, options?: TranslationOptions): string {
  const store = useI18nKeyless.getState();
  return getTranslationCore(key, store, options);
}

export function setCurrentLanguage(lang: I18nConfig["languages"]["supported"][number]) {
  return useI18nKeyless.getState().setLanguage(lang);
}

export async function clearI18nKeylessStorageAndStore() {
  useI18nKeyless.setState({
    translations: {},
    currentLanguage: "fr",
    config: undefined,
  });
  const config = useI18nKeyless.getState().config;
  if (config?.storage) {
    clearI18nKeylessStorage(config.storage);
  }
}

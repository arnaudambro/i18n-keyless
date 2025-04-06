import {
  type I18nConfig,
  type Lang,
  type TranslationStore,
  type I18nKeylessResponse,
  type Translations,
  queue,
  fetchAllTranslations,
  validateLanguage,
} from "i18n-keyless-core";
import { create } from "zustand";
import { init as initRoot, storeKeys, setItem, getItem, clearI18nKeylessStorage } from "./utils";

queue.on("empty", () => {
  // when each word is translated, fetch the translations for the current language
  const store = useI18nKeyless.getState();
  fetchAllTranslations(store.currentLanguage, store).then(store.setTranslations);
});

export const useI18nKeyless = create<TranslationStore>((set, get) => ({
  uniqueId: null,
  lastRefresh: null,
  translations: {},
  currentLanguage: "fr",
  config: null,
  setTranslations: (response: I18nKeylessResponse | void) => {
    if (!response?.ok) {
      return;
    }
    const config = get().config;
    if (!config) {
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
    const config = get().config;
    if (!config) {
      throw new Error(`i18n-keyless: config is not initialized setting translations`);
    }
    const debug = config.debug;
    const validatedLang = validateLanguage(lang, config);
    if (validatedLang !== lang) {
      if (debug) console.log("i18n-keyless: language", lang, "is not supported, fallback to", validatedLang);
    } else {
      if (debug) console.log("i18n-keyless: setLanguage", lang);
    }

    set({ currentLanguage: validatedLang });
    if (config.storage) {
      setItem(storeKeys.currentLanguage, validatedLang!, config.storage);
    }

    // Only fetch translations if the new language is not the primary language
    if (lang !== config.languages.primary) {
      await fetchAllTranslations(lang, get()).then(get().setTranslations);
    }
  },
}));

async function hydrate() {
  const config = useI18nKeyless.getState().config;
  if (!config) {
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

export async function init(newConfig: I18nConfig) {
  const config = await initRoot(newConfig);

  useI18nKeyless.setState({ config });
  await hydrate();
  const currentLanguage = useI18nKeyless.getState().currentLanguage;
  config.onInit?.(currentLanguage);
}

export function useCurrentLanguage(): Lang | null {
  const currentLanguage = useI18nKeyless((state) => state.currentLanguage);
  return currentLanguage;
}

export function setCurrentLanguage(lang: I18nConfig["languages"]["supported"][number]) {
  return useI18nKeyless.getState().setLanguage(lang);
}

export async function clearI18nKeylessStorageAndStore() {
  useI18nKeyless.setState({
    translations: {},
    currentLanguage: "fr",
    config: null,
  });
  const config = useI18nKeyless.getState().config;
  if (config?.storage) {
    clearI18nKeylessStorage(config.storage);
  }
}

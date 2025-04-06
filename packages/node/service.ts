import {
  type Lang,
  type NodeConfig,
  type TranslationOptions,
  queue,
  getTranslationCore,
  getAllTranslationsForAllLanguages,
  MinimalTranslationStore,
} from "i18n-keyless-core";

interface NodeStore extends Omit<MinimalTranslationStore, "currentLanguage" | "storage"> {
  config: NodeConfig | null;
}

const store: NodeStore = {
  translations: {},
  uniqueId: "",
  lastRefresh: "",
  config: null,
  setTranslations: () => {},
};

queue.on("empty", () => {
  // when each word is translated, fetch the translations for the current language
  getAllTranslationsForAllLanguages(store).then(store.setTranslations);
});

export async function init(newConfig: NodeConfig): Promise<NodeConfig> {
  if (!newConfig.languages) {
    throw new Error("i18n-keyless: languages is required");
  }
  if (!newConfig.languages.primary) {
    throw new Error("i18n-keyless: primary is required");
  }
  if (!newConfig.languages.fallback) {
    newConfig.languages.fallback = newConfig.languages.primary;
  }
  if (!newConfig.getAllTranslationsForAllLanguages || !newConfig.handleTranslate) {
    if (!newConfig.API_KEY) {
      if (!newConfig.API_URL) {
        throw new Error(
          "i18n-keyless: you didn't provide an API_KEY nor an API_URL nor a handleTranslate + getAllTranslationsForAllLanguages function. You need to provide one of them to make i18n-keyless work"
        );
      }
    }
  }
  if (newConfig.addMissingTranslations !== false) {
    // default to true
    newConfig.addMissingTranslations = true;
  }
  store.config = newConfig;
  store.config.onInit?.(newConfig.languages.primary);

  await getAllTranslationsForAllLanguages(store);

  return newConfig;
}

export function getTranslation(key: string, currentLanguage: Lang, options?: TranslationOptions): string {
  if (options?.debug) {
    console.log("getTranslation", key, currentLanguage, store.translations);
  }
  return getTranslationCore(key, { ...store, currentLanguage }, options);
}

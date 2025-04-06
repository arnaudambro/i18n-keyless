import {
  type I18nConfig,
  type Lang,
  type TranslationStore,
  type TranslationOptions,
  queue,
  getTranslationCore,
} from "i18n-keyless-core";
import { getAllTranslationsForAllLanguages } from "i18n-keyless-core/service";

const store: Omit<TranslationStore, "currentLanguage"> = {
  translations: {},
  uniqueId: "",
  lastRefresh: "",
  config: null,
  setTranslations: () => {},
  setLanguage: () => {},
};

queue.on("empty", () => {
  // when each word is translated, fetch the translations for the current language
  getAllTranslationsForAllLanguages(store).then(store.setTranslations);
});

export async function init(
  newConfig: Omit<I18nConfig, "getAllTranslations">
): Promise<Omit<I18nConfig, "getAllTranslations">> {
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

  return newConfig;
}

export function getTranslation(key: string, currentLanguage: Lang, options?: TranslationOptions): string {
  return getTranslationCore(key, { ...store, currentLanguage }, options);
}

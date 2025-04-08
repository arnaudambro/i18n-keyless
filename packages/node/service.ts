import {
  type Lang,
  type TranslationOptions,
  queue,
  getTranslationCore,
  I18nKeylessAllTranslationsResponse,
  api,
} from "i18n-keyless-core";
import { I18nKeylessNodeConfig, I18nKeylessNodeStore } from "types";
import packageJson from "./package.json";

const store: I18nKeylessNodeStore = {
  translations: {
    fr: {},
    en: {},
    es: {},
    nl: {},
    it: {},
    de: {},
    pl: {},
    pt: {},
    ro: {},
    sv: {},
    tr: {},
    ja: {},
    cn: {},
    ru: {},
    ko: {},
    ar: {},
  },
  uniqueId: "",
  lastRefresh: "",
  config: {
    API_KEY: "",
    languages: {
      primary: "fr",
      supported: ["fr"],
    },
  },
};

/**
 * Fetches all translations
 * @param store - The translation store
 * @returns Promise resolving to the translation response or void if failed
 */
export async function getAllTranslationsForAllLanguages(
  store: I18nKeylessNodeStore
): Promise<I18nKeylessAllTranslationsResponse | void> {
  const config = store.config;
  const lastRefresh = store.lastRefresh;
  const uniqueId = store.uniqueId;
  if (!config.API_KEY) {
    console.error("i18n-keyless: No config found");
    return;
  }
  // if (config.languages.primary === targetLanguage) {
  //   return;
  // }

  try {
    const response = config.getAllTranslationsForAllLanguages
      ? await config.getAllTranslationsForAllLanguages()
      : await api
          .fetchAllTranslationsForAllLanguages(
            `${config.API_URL || "https://api.i18n-keyless.com"}/translate/?last_refresh=${lastRefresh}`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.API_KEY}`,
                Version: packageJson.version,
                unique_id: uniqueId || "",
              },
            }
          )
          .then((res) => res as I18nKeylessAllTranslationsResponse);

    if (!response.ok) {
      throw new Error(response.error);
    }

    if (response.message) {
      console.warn("i18n-keyless: ", response.message);
    }

    return response;
  } catch (error) {
    console.error("i18n-keyless: fetch all translations error:", error);
  }
}

queue.on("empty", () => {
  // when each word is translated, fetch the translations for the current language
  getAllTranslationsForAllLanguages(store).then((res) => {
    if (res?.ok) {
      store.translations = res.data.translations;
    }
  });
});

export async function init(newConfig: I18nKeylessNodeConfig): Promise<I18nKeylessNodeConfig> {
  if (!newConfig.languages) {
    throw new Error("i18n-keyless: languages is required");
  }
  if (!newConfig.languages.primary) {
    throw new Error("i18n-keyless: primary is required");
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
  newConfig.addMissingTranslations = true;
  store.config = newConfig;
  store.config.onInit?.(newConfig.languages.primary);

  const response = await getAllTranslationsForAllLanguages(store);
  if (response?.ok) {
    store.translations = response.data.translations;
  }

  return newConfig;
}

export function getTranslation(key: string, currentLanguage: Lang, options?: TranslationOptions): string {
  if (options?.debug) {
    console.log("getTranslation", key, currentLanguage, store.translations);
  }
  return getTranslationCore(
    key,
    {
      ...store,
      config: store.config!,
      currentLanguage,
      translations: store.translations[currentLanguage],
    },
    options
  );
}

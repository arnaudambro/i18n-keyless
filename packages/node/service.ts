import {
  type Lang,
  type TranslationOptions,
  type I18nKeylessRequestBody,
  type HandleTranslateFunction,
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

/**
 * Queues a key for translation if not already translated
 * @param key - The text to translate
 * @param store - The translation store
 * @param options - Optional parameters for the translation process
 * @throws Error if config is not initialized
 */
export const awaitForTranslation = new Proxy(
  async function (key: string, currentLanguage: Lang, options?: TranslationOptions): Promise<string> {
    try {
      const config = store.config;
      const translations = store.translations;
      const uniqueId = store.uniqueId;
      if (!config.API_KEY) {
        throw new Error("i18n-keyless: config is not initialized");
      }
      const context = options?.context;
      const debug = options?.debug;
      // if (key.length > 280) {
      //   console.error("i18n-keyless: Key length exceeds 280 characters limit:", key);
      //   return;
      // }
      if (!key) {
        return "";
      }
      if (debug) {
        console.log("translateKey", key, context, debug);
      }
      const forceTemporaryLang = options?.forceTemporary?.[currentLanguage];
      const translation = context
        ? translations[currentLanguage][`${key}__${context}`]
        : translations[currentLanguage][key];
      if (translation && !forceTemporaryLang) {
        if (debug) {
          console.log("translation exists", `${key}__${context}`);
        }
        return translation;
      }
      if (config.handleTranslate) {
        await config.handleTranslate?.(key);
      } else {
        const body: I18nKeylessRequestBody = {
          key,
          context,
          forceTemporary: options?.forceTemporary,
          languages: config.languages.supported,
          primaryLanguage: config.languages.primary,
        };
        const apiUrl = config.API_URL || "https://api.i18n-keyless.com";
        const url = `${apiUrl}/translate`;
        if (debug) {
          console.log("fetching translation", url, body);
        }
        const response = await api
          .fetchTranslation(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.API_KEY}`,
              unique_id: uniqueId || "",
              Version: packageJson.version,
            },
            body: JSON.stringify(body),
          })
          .then((res) => res as ReturnType<NonNullable<HandleTranslateFunction>>);

        if (debug) {
          console.log("response", response);
        }
        if (response.message) {
          console.warn("i18n-keyless: ", response.message);
        }
        return response.data.translation[currentLanguage] || key;
      }
    } catch (error) {
      console.error("i18n-keyless: Error await translating key:", error);
    }
    return key;
  },
  {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      if (result instanceof Promise) {
        result.catch((error) => {
          console.error("awaitForTranslation was not properly awaited:", error);
          throw error;
        });
      }
      return result;
    },
  }
);

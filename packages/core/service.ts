import type {
  I18nConfig,
  I18nKeylessRequestBody,
  Lang,
  OmitCurrentLanguageTranslationStore,
  MinimalTranslationStore,
  TranslationOptions,
  I18nKeylessResponse,
} from "./types";
import MyPQueue from "./my-pqueue";
import packageJson from "./package.json";
import { api } from "./api";

export const queue = new MyPQueue({ concurrency: 5 });

/**
 * Validates the language against the supported languages
 * @param lang - The language to validate
 * @param config - The configuration object
 * @returns The validated language or the fallback language if not supported
 * @throws Error if config is not initialized
 */
export function validateLanguage(lang: I18nConfig["languages"]["supported"][number], config: I18nConfig) {
  if (!config) {
    throw new Error(`i18n-keyless: config is not initialized validating language`);
  }
  if (!config.languages.supported.includes(lang)) {
    return config.languages.fallback;
  }
  return lang;
}

/**
 * Gets a translation for the specified key from the store
 * @param key - The translation key (text in primary language)
 * @param store - The translation store containing translations and config
 * @param options - Optional parameters for translation retrieval
 * @returns The translated text or the original key if not found
 * @throws Error if config is not initialized
 */
export function getTranslationCore(key: string, store: MinimalTranslationStore, options?: TranslationOptions): string {
  const currentLanguage = store.currentLanguage;
  const config = store.config;
  const translations = store.translations;
  if (!config) {
    throw new Error("i18n-keyless: config is not initialized");
  }
  if (currentLanguage === config.languages.primary) {
    return key;
  }
  if (options?.forceTemporary?.[currentLanguage]) {
    translateKey(key, store, options);
  }
  const context = options?.context;
  const translation = context ? translations[`${key}__${context}`] : translations[key];
  if (!translation) {
    translateKey(key, store, options);
  }
  return translation || key;
}

const translating: Record<string, boolean> = {};
/**
 * Queues a key for translation if not already translated
 * @param key - The text to translate
 * @param store - The translation store
 * @param options - Optional parameters for the translation process
 * @throws Error if config is not initialized
 */
export function translateKey(key: string, store: MinimalTranslationStore, options?: TranslationOptions) {
  const currentLanguage = store.currentLanguage;
  const config = store.config;
  const translations = store.translations;
  const uniqueId = store.uniqueId;
  if (!config) {
    throw new Error("i18n-keyless: config is not initialized");
  }
  const context = options?.context;
  const debug = options?.debug;
  // if (key.length > 280) {
  //   console.error("i18n-keyless: Key length exceeds 280 characters limit:", key);
  //   return;
  // }
  if (!key) {
    return;
  }
  if (debug) {
    console.log("translateKey", key, context, debug);
  }
  const forceTemporaryLang = options?.forceTemporary?.[currentLanguage];
  const translation = context ? translations[`${key}__${context}`] : translations[key];
  if (translation && !forceTemporaryLang) {
    if (debug) {
      console.log("translation exists", `${key}__${context}`);
    }
    return;
  }
  queue.add(
    async () => {
      try {
        if (translating[key]) {
          return;
        } else {
          translating[key] = true;
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
            .then((res) => res as ReturnType<NonNullable<I18nConfig["handleTranslate"]>>);

          if (debug) {
            console.log("response", response);
          }
          if (response.message) {
            console.warn("i18n-keyless: ", response.message);
          }
        }
        translating[key] = false;
        return;
      } catch (error) {
        console.error("i18n-keyless: Error translating key:", error);
        translating[key] = false;
      }
    },
    { priority: 1, id: key }
  );
}

/**
 * Fetches all translations for a target language
 * @param targetLanguage - The language code to fetch translations for
 * @param store - The translation store
 * @returns Promise resolving to the translation response or void if failed
 */
export async function getAllTranslationsFromLanguage(
  targetLanguage: Lang,
  store: MinimalTranslationStore
): Promise<I18nKeylessResponse | void> {
  const config = store.config;
  const lastRefresh = store.lastRefresh;
  const uniqueId = store.uniqueId;
  if (!config) {
    console.error("i18n-keyless: No config found");
    return;
  }
  // if (config.languages.primary === targetLanguage) {
  //   return;
  // }

  try {
    const response = config.getAllTranslations
      ? await config.getAllTranslations()
      : await api
          .fetchTranslationsForOneLanguage(
            `${
              config.API_URL || "https://api.i18n-keyless.com"
            }/translate/${targetLanguage}?last_refresh=${lastRefresh}`,
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
          .then((res) => res as ReturnType<NonNullable<I18nConfig["getAllTranslations"]>>);

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

/**
 * Fetches all translations for a target language
 * @param targetLanguage - The language code to fetch translations for
 * @param store - The translation store
 * @returns Promise resolving to the translation response or void if failed
 */
export async function getAllTranslationsForAllLanguages(
  store: OmitCurrentLanguageTranslationStore
): Promise<I18nKeylessResponse | void> {
  const config = store.config;
  const lastRefresh = store.lastRefresh;
  const uniqueId = store.uniqueId;
  if (!config) {
    console.error("i18n-keyless: No config found");
    return;
  }
  // if (config.languages.primary === targetLanguage) {
  //   return;
  // }

  try {
    const response = config.getAllTranslations
      ? await config.getAllTranslations()
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
          .then((res) => res as ReturnType<NonNullable<I18nConfig["getAllTranslations"]>>);

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

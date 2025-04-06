import type {
  I18nConfig,
  I18nKeylessRequestBody,
  Lang,
  TranslationStore,
  TranslationOptions,
  I18nKeylessResponse,
} from "i18n-keyless-core";
import MyPQueue from "./my-pqueue";
import packageJson from "./package.json";
import { api } from "./api";

export const queue = new MyPQueue({ concurrency: 5 });

/**
 * The keys used to store i18n-keyless data in storage
 */
export const storeKeys = {
  uniqueId: "i18n-keyless-user-id" as const,
  lastRefresh: "i18n-keyless-last-refresh" as const,
  translations: "i18n-keyless-translations" as const,
  currentLanguage: "i18n-keyless-current-language" as const,
};

/**
 * Retrieves an item from storage using various storage API patterns
 * @param key - The storage key to retrieve
 * @param storage - The storage implementation to use
 * @returns Promise resolving to the stored value or null/undefined if not found
 * @throws Error if storage is not initialized
 */
export async function getItem(
  key: string,
  storage: I18nConfig["storage"],
  serializer?: (value: string) => Record<string, string>
): Promise<string | undefined | null | Record<string, string>> {
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized getting item ${key}`);
  }
  try {
    let item: string | null | undefined;
    if (storage.getItem) {
      item = await storage.getItem(key);
    } else if (storage.get) {
      item = await storage.get(key);
    } else if (storage.getString) {
      item = await storage.getString(key);
    }
    if (item) {
      return serializer ? serializer(item) : item;
    }
  } catch (error) {
    console.error("i18n-keyless: Error getting item:", error);
  }
  return null;
}

/**
 * Stores an item in the provided storage implementation
 * @param key - The storage key to set
 * @param value - The string value to store
 * @param storage - The storage implementation to use
 * @throws Error if storage is not initialized or if storage operation fails
 */
export async function setItem(key: string, value: string, storage: I18nConfig["storage"]) {
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized setting item ${key}`);
  }
  try {
    if (storage.setItem) {
      storage.setItem(key, value);
    } else if (storage.set) {
      storage.set(key, value);
    }
  } catch (error) {
    console.error("i18n-keyless: Error setting item:", error);
    throw error;
  }
}

/**
 * Removes an item from storage using various storage API patterns
 * @param key - The storage key to delete
 * @param storage - The storage implementation to use
 * @throws Error if storage is not initialized
 */
export async function deleteItem(key: string, storage: I18nConfig["storage"]) {
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized deleting item ${key}`);
  }
  try {
    if (storage.delete) {
      storage.delete(key);
    } else if (storage.del) {
      storage.del(key);
    } else if (storage.removeItem) {
      storage.removeItem(key);
    } else if (storage.remove) {
      storage.remove(key);
    }
  } catch (error) {
    console.error("i18n-keyless: Error deleting item:", error);
  }
}

/**
 * Initializes the i18n configuration with defaults and validation
 * @param newConfig - The configuration object to initialize
 * @returns The validated and completed configuration
 * @throws Error if required configuration properties are missing
 */
export async function init(newConfig: I18nConfig): Promise<I18nConfig> {
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

  return newConfig;
}

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
export function getTranslation(key: string, store: TranslationStore, options?: TranslationOptions): string {
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
export function translateKey(key: string, store: TranslationStore, options?: TranslationOptions) {
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
export async function fetchAllTranslations(
  targetLanguage: Lang,
  store: TranslationStore
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
          .fetchTranslations(
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
 * Clears all i18n-keyless data from storage
 * @param storage - The storage implementation to clear
 */
export async function clearI18nKeylessStorage(storage: I18nConfig["storage"]) {
  for (const key of Object.keys(storeKeys)) {
    deleteItem(key, storage);
  }
}

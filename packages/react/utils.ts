import type { I18nConfig } from "i18n-keyless-core";

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
 * Clears all i18n-keyless data from storage
 * @param storage - The storage implementation to clear
 */
export async function clearI18nKeylessStorage(storage: I18nConfig["storage"]) {
  for (const key of Object.keys(storeKeys)) {
    deleteItem(key, storage);
  }
}

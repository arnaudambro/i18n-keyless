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
 * Clears all i18n-keyless data from storage
 * @param storage - The storage implementation to clear
 */
export async function clearI18nKeylessStorage(storage: I18nConfig["storage"]) {
  for (const key of Object.keys(storeKeys)) {
    deleteItem(key, storage);
  }
}

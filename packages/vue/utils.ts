import type { I18nConfig } from "./types.ts";
import { DEFAULT_NAMESPACE } from "i18n-keyless-core";

/**
 * The keys used to store i18n-keyless data in storage
 */
export const storeKeys = {
  uniqueId: "i18n-keyless-user-id" as const,
  lastRefresh: "i18n-keyless-last-refresh" as const,
  translations: "i18n-keyless-translations" as const,
  currentLanguage: "i18n-keyless-current-language" as const,
  // usage keyed by namespace: { "<namespace>": { "key__context": "YYYY-MM-DD" } }
  translationsUsage: "i18n-keyless-translations-usage" as const,
  // index (JSON array) of namespaces we have persisted, so hydrate() knows which
  // per-namespace translation keys to load (storage adapters have no key enumeration).
  namespaces: "i18n-keyless-namespaces" as const,
  // index (JSON array) of namespaces that contain origin-language (UGC) keys: those need
  // a refetch even when switching to the primary language.
  originNamespaces: "i18n-keyless-origin-namespaces" as const,
};

/**
 * Storage key holding the translations slice for a given namespace.
 * The default namespace reuses the legacy `i18n-keyless-translations` key so existing
 * installs hydrate with no migration; other namespaces get a `__<namespace>` suffix.
 */
export function translationsKeyFor(namespace: string): string {
  return namespace === DEFAULT_NAMESPACE ? storeKeys.translations : `${storeKeys.translations}__${namespace}`;
}

/**
 * Storage key holding the last-refresh (delta) cursor for a given namespace.
 * The default namespace reuses the legacy `i18n-keyless-last-refresh` key.
 */
export function lastRefreshKeyFor(namespace: string): string {
  return namespace === DEFAULT_NAMESPACE ? storeKeys.lastRefresh : `${storeKeys.lastRefresh}__${namespace}`;
}

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
 * Clears all i18n-keyless data from storage, including every per-namespace
 * translations / last-refresh key (looked up from the namespaces index).
 * @param storage - The storage implementation to clear
 */
export async function clearI18nKeylessStorage(storage: I18nConfig["storage"]) {
  // Per-namespace keys first: read the index, then delete each namespace's slice.
  const namespaces = (await getItem(storeKeys.namespaces, storage, JSON.parse)) as unknown as string[] | null;
  if (Array.isArray(namespaces)) {
    for (const namespace of namespaces) {
      deleteItem(translationsKeyFor(namespace), storage);
      deleteItem(lastRefreshKeyFor(namespace), storage);
    }
  }
  // Then the fixed keys (this also covers the default namespace, whose translations /
  // last-refresh keys are the legacy values in storeKeys).
  //
  // The device id is deliberately kept: it identifies the install, not the translation
  // cache. Wiping it means the next launch generates a fresh one, and the API counts a
  // brand-new "monthly active user": so an app that clears its cache on logout would bill
  // one extra user per logout.
  for (const key of Object.values(storeKeys)) {
    if (key === storeKeys.uniqueId) {
      continue;
    }
    deleteItem(key, storage);
  }
}

/**
 * Creates an in-memory storage adapter backed by a Map.
 *
 * Used as the default storage on the server (when `typeof window === "undefined"`
 * and no `storage` is provided to `init`). It satisfies the storage interface and
 * keeps translations cached for the lifetime of the process, so a long-lived server
 * fetches each language at most once per boot. It does NOT persist across restarts :
 * which is the correct, expected behavior server-side.
 *
 * On the browser, a missing `storage` remains a loud error (a real misconfiguration),
 * so this is intentionally not used as a client default.
 */
export function createMemoryStorage(): NonNullable<I18nConfig["storage"]> {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
}

/**
 * Validates the language against the supported languages
 * @param lang - The language to validate
 * @param config - The configuration object
 * @returns The validated language or the fallback language if not supported
 * @throws Error if config is not initialized
 */
export function validateLanguage(lang: I18nConfig["languages"]["supported"][number], config: I18nConfig) {
  if (!config.API_KEY) {
    throw new Error(`i18n-keyless: config is not initialized validating language`);
  }
  if (!config.languages.supported.includes(lang)) {
    return config.languages.fallback;
  }
  return lang;
}

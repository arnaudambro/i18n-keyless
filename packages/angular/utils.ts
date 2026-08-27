import type { I18nConfig, I18nStorage } from "./types.ts";
import { DEFAULT_NAMESPACE } from "i18n-keyless-core";

/**
 * The keys used to store i18n-keyless data in storage. Identical to the react package, so
 * an app migrating from `i18n-keyless-react` keeps its cache and its device id.
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
 * (`getItem` / `get` / `getString`, sync or async).
 */
export async function getItem(
  key: string,
  storage: I18nStorage | undefined,
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
 * Stores an item in the provided storage implementation (`setItem` / `set`).
 */
export async function setItem(key: string, value: string, storage: I18nStorage | undefined) {
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
 * Removes an item from storage (`delete` / `del` / `removeItem` / `remove`).
 */
export async function deleteItem(key: string, storage: I18nStorage | undefined) {
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
 *
 * The device id is deliberately kept: it identifies the install, not the translation
 * cache. Wiping it would make the API count a brand-new user on the next launch.
 */
export async function clearI18nKeylessStorage(storage: I18nStorage | undefined) {
  const namespaces = (await getItem(storeKeys.namespaces, storage, JSON.parse)) as unknown as string[] | null;
  if (Array.isArray(namespaces)) {
    for (const namespace of namespaces) {
      deleteItem(translationsKeyFor(namespace), storage);
      deleteItem(lastRefreshKeyFor(namespace), storage);
    }
  }
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
 * Used as the default storage on the server (no `window`). It keeps translations cached
 * for the lifetime of the process, so a long-lived server fetches each language at most
 * once per boot. It does NOT persist across restarts, which is the expected server behavior.
 */
export function createMemoryStorage(): I18nStorage {
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
 * The default browser storage: `window.localStorage`, or an in-memory adapter when the
 * browser refuses access to it (sandboxed iframe, some private modes).
 */
export function createDefaultBrowserStorage(): I18nStorage {
  try {
    const storage = window.localStorage;
    if (storage) {
      return storage;
    }
  } catch (error) {
    console.warn("i18n-keyless: window.localStorage is not available, falling back to memory storage", error);
  }
  return createMemoryStorage();
}

/**
 * Validates the language against the supported languages: returns the fallback language
 * when `lang` is not supported.
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

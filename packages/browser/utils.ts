import { DEFAULT_NAMESPACE } from "i18n-keyless-core";
import type { I18nConfig, StorageAdapter } from "./types.ts";

/**
 * The keys used to store i18n-keyless data in storage. Identical to the react package, so
 * a page can move from one SDK to the other and keep its cache.
 */
export const storeKeys = {
  uniqueId: "i18n-keyless-user-id" as const,
  lastRefresh: "i18n-keyless-last-refresh" as const,
  translations: "i18n-keyless-translations" as const,
  currentLanguage: "i18n-keyless-current-language" as const,
  translationsUsage: "i18n-keyless-translations-usage" as const,
  namespaces: "i18n-keyless-namespaces" as const,
  originNamespaces: "i18n-keyless-origin-namespaces" as const,
};

/** Storage key of the translations slice of one namespace. */
export function translationsKeyFor(namespace: string): string {
  return namespace === DEFAULT_NAMESPACE ? storeKeys.translations : `${storeKeys.translations}__${namespace}`;
}

/** Storage key of the delta cursor of one namespace. */
export function lastRefreshKeyFor(namespace: string): string {
  return namespace === DEFAULT_NAMESPACE ? storeKeys.lastRefresh : `${storeKeys.lastRefresh}__${namespace}`;
}

export async function getItem(
  key: string,
  storage: StorageAdapter | undefined,
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

export async function setItem(key: string, value: string, storage: StorageAdapter | undefined) {
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized setting item ${key}`);
  }
  try {
    if (storage.setItem) {
      await storage.setItem(key, value);
    } else if (storage.set) {
      await storage.set(key, value);
    }
  } catch (error) {
    console.error("i18n-keyless: Error setting item:", error);
    throw error;
  }
}

export async function deleteItem(key: string, storage: StorageAdapter | undefined) {
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized deleting item ${key}`);
  }
  try {
    if (storage.delete) {
      await storage.delete(key);
    } else if (storage.del) {
      await storage.del(key);
    } else if (storage.removeItem) {
      await storage.removeItem(key);
    } else if (storage.remove) {
      await storage.remove(key);
    }
  } catch (error) {
    console.error("i18n-keyless: Error deleting item:", error);
  }
}

/**
 * Clears every i18n-keyless key from storage, except the device id: the id identifies the
 * install, and a new id is a new billed user.
 */
export async function clearI18nKeylessStorage(storage: StorageAdapter | undefined) {
  const namespaces = (await getItem(storeKeys.namespaces, storage, JSON.parse)) as unknown as string[] | null;
  if (Array.isArray(namespaces)) {
    for (const namespace of namespaces) {
      await deleteItem(translationsKeyFor(namespace), storage);
      await deleteItem(lastRefreshKeyFor(namespace), storage);
    }
  }
  for (const key of Object.values(storeKeys)) {
    if (key === storeKeys.uniqueId) {
      continue;
    }
    await deleteItem(key, storage);
  }
}

/** An in-memory storage adapter backed by a Map. */
export function createMemoryStorage(): StorageAdapter {
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
 * The default storage of a browser page: `localStorage`. Reading `window.localStorage` can
 * throw (storage disabled, sandboxed iframe), so the in-memory adapter is the fallback.
 */
export function createDefaultStorage(): StorageAdapter {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const probeKey = "i18n-keyless-probe";
      window.localStorage.setItem(probeKey, "1");
      window.localStorage.removeItem(probeKey);
      return window.localStorage;
    }
  } catch {
    // fall through
  }
  return createMemoryStorage();
}

/** The language itself when it is supported, the fallback language otherwise. */
export function validateLanguage(lang: I18nConfig["languages"]["supported"][number], config: I18nConfig) {
  if (!config.API_KEY) {
    throw new Error(`i18n-keyless: config is not initialized validating language`);
  }
  if (!config.languages.supported.includes(lang)) {
    return config.languages.fallback;
  }
  return lang;
}

/** True in a development build (bundlers inline `process.env.NODE_ENV`) or with `debug`. */
export function isDevelopment(debug?: boolean): boolean {
  if (debug) {
    return true;
  }
  const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
  return env === "development";
}

/** Same rule as the react package: whitespace around the source changes the key. */
export function warnAboutWhitespace(text: string, debug?: boolean) {
  if (isDevelopment(debug) && text !== text.trim()) {
    console.warn(
      `i18n-keyless received text with leading/trailing whitespace: "${text}". ` +
        "This may cause inconsistencies in translations. Consider trimming the text."
    );
  }
}

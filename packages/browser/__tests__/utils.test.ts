import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  storeKeys,
  translationsKeyFor,
  lastRefreshKeyFor,
  getItem,
  setItem,
  deleteItem,
  clearI18nKeylessStorage,
  createMemoryStorage,
  createDefaultStorage,
  validateLanguage,
  isDevelopment,
  warnAboutWhitespace,
} from "../utils.ts";
import type { StorageAdapter } from "../types.ts";
import { baseConfig, silenceConsole } from "./helpers.ts";

beforeEach(() => {
  silenceConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("storage keys", () => {
  it("names the default namespace slice like the legacy single key", () => {
    expect(translationsKeyFor("default")).toBe(storeKeys.translations);
    expect(lastRefreshKeyFor("default")).toBe(storeKeys.lastRefresh);
    expect(translationsKeyFor("shop")).toBe(`${storeKeys.translations}__shop`);
    expect(lastRefreshKeyFor("shop")).toBe(`${storeKeys.lastRefresh}__shop`);
  });
});

describe("getItem", () => {
  it("throws without a storage", async () => {
    await expect(getItem("k", undefined)).rejects.toThrow(/storage is not initialized getting item k/);
  });

  it("reads through getItem, get or getString", async () => {
    const withGetItem: StorageAdapter = { getItem: (key) => `item:${key}` };
    const withGet: StorageAdapter = { get: async (key) => `get:${key}` };
    const mmkv: StorageAdapter = { getString: (key) => `string:${key}` };
    expect(await getItem("k", withGetItem)).toBe("item:k");
    expect(await getItem("k", withGet)).toBe("get:k");
    expect(await getItem("k", mmkv)).toBe("string:k");
  });

  it("returns null for a missing value and for a storage without a reader", async () => {
    expect(await getItem("k", { getItem: () => null })).toBeNull();
    expect(await getItem("k", { getItem: () => undefined })).toBeNull();
    expect(await getItem("k", { setItem: () => {} })).toBeNull();
  });

  it("applies the serializer", async () => {
    const storage: StorageAdapter = { getItem: () => JSON.stringify({ a: "1" }) };
    expect(await getItem("k", storage, JSON.parse)).toEqual({ a: "1" });
  });

  it("logs and returns null when the storage throws", async () => {
    const storage: StorageAdapter = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(await getItem("k", storage)).toBeNull();
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error getting item:", expect.any(Error));
  });
});

describe("setItem", () => {
  it("throws without a storage", async () => {
    await expect(setItem("k", "v", undefined)).rejects.toThrow(/storage is not initialized setting item k/);
  });

  it("writes through setItem or set", async () => {
    const setItemFn = vi.fn();
    const setFn = vi.fn(async () => {});
    await setItem("k", "v", { setItem: setItemFn });
    await setItem("k", "v", { set: setFn });
    expect(setItemFn).toHaveBeenCalledWith("k", "v");
    expect(setFn).toHaveBeenCalledWith("k", "v");
  });

  it("does nothing on a storage without a writer", async () => {
    await expect(setItem("k", "v", { getItem: () => null })).resolves.toBeUndefined();
  });

  it("logs and rethrows when the storage throws", async () => {
    const storage: StorageAdapter = {
      setItem: () => {
        throw new Error("quota");
      },
    };
    await expect(setItem("k", "v", storage)).rejects.toThrow("quota");
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error setting item:", expect.any(Error));
  });
});

describe("deleteItem", () => {
  it("throws without a storage", async () => {
    await expect(deleteItem("k", undefined)).rejects.toThrow(/storage is not initialized deleting item k/);
  });

  it("removes through delete, del, removeItem or remove", async () => {
    const shapes = {
      delete: vi.fn(),
      del: vi.fn(async () => {}),
      removeItem: vi.fn(),
      remove: vi.fn(),
    };
    for (const [method, fn] of Object.entries(shapes)) {
      await deleteItem("k", { [method]: fn } as StorageAdapter);
      expect(fn).toHaveBeenCalledWith("k");
    }
  });

  it("does nothing on a storage without a remover", async () => {
    await expect(deleteItem("k", { getItem: () => null })).resolves.toBeUndefined();
  });

  it("logs and swallows when the storage throws", async () => {
    const storage: StorageAdapter = {
      removeItem: () => {
        throw new Error("denied");
      },
    };
    await expect(deleteItem("k", storage)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error deleting item:", expect.any(Error));
  });
});

describe("clearI18nKeylessStorage", () => {
  it("removes every key and every namespace slice, keeps the device id", async () => {
    const storage = createMemoryStorage();
    storage.setItem!(storeKeys.uniqueId, "id");
    storage.setItem!(storeKeys.namespaces, JSON.stringify(["default", "shop"]));
    storage.setItem!(storeKeys.translations, "{}");
    storage.setItem!(`${storeKeys.translations}__shop`, "{}");
    storage.setItem!(`${storeKeys.lastRefresh}__shop`, "1");
    storage.setItem!(storeKeys.currentLanguage, "en");
    await clearI18nKeylessStorage(storage);
    expect(storage.getItem!(storeKeys.uniqueId)).toBe("id");
    for (const key of [
      storeKeys.namespaces,
      storeKeys.translations,
      `${storeKeys.translations}__shop`,
      `${storeKeys.lastRefresh}__shop`,
      storeKeys.currentLanguage,
    ]) {
      expect(storage.getItem!(key)).toBeNull();
    }
  });

  it("works without a namespaces index", async () => {
    const removeItem = vi.fn();
    await clearI18nKeylessStorage({ getItem: () => null, removeItem });
    expect(removeItem).toHaveBeenCalledTimes(Object.keys(storeKeys).length - 1);
    expect(removeItem).not.toHaveBeenCalledWith(storeKeys.uniqueId);
  });
});

describe("createMemoryStorage", () => {
  it("is a Map behind getItem/setItem/removeItem/clear", () => {
    const storage = createMemoryStorage();
    expect(storage.getItem!("a")).toBeNull();
    storage.setItem!("a", "1");
    storage.setItem!("b", "2");
    expect(storage.getItem!("a")).toBe("1");
    storage.removeItem!("a");
    expect(storage.getItem!("a")).toBeNull();
    expect(storage.getItem!("b")).toBe("2");
    storage.clear!();
    expect(storage.getItem!("b")).toBeNull();
  });
});

describe("createDefaultStorage", () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!;

  afterEach(() => {
    Object.defineProperty(window, "localStorage", descriptor);
  });

  it("returns localStorage when it is usable and leaves no probe behind", () => {
    expect(createDefaultStorage()).toBe(window.localStorage);
    expect(window.localStorage.getItem("i18n-keyless-probe")).toBeNull();
  });

  it("falls back to memory when reading localStorage throws", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    const storage = createDefaultStorage();
    storage.setItem!("a", "1");
    expect(storage.getItem!("a")).toBe("1");
    expect(storage).not.toBe(descriptor.get!.call(window));
  });

  it("falls back to memory when writing to localStorage throws", () => {
    const real = descriptor.get!.call(window) as Storage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
      },
    });
    const storage = createDefaultStorage();
    expect(storage).not.toBe(window.localStorage);
    expect(storage).not.toBe(real);
    storage.setItem!("a", "1");
    expect(storage.getItem!("a")).toBe("1");
  });

  it("falls back to memory when localStorage is null", () => {
    Object.defineProperty(window, "localStorage", { configurable: true, value: null });
    const storage = createDefaultStorage();
    expect(storage).not.toBeNull();
    storage.setItem!("a", "1");
    expect(storage.getItem!("a")).toBe("1");
  });

  it("falls back to memory without a window", () => {
    vi.stubGlobal("window", undefined);
    try {
      const storage = createDefaultStorage();
      storage.setItem!("a", "1");
      expect(storage.getItem!("a")).toBe("1");
    } finally {
      // restore `window` before the localStorage descriptor is put back on it
      vi.unstubAllGlobals();
    }
  });
});

describe("validateLanguage", () => {
  it("throws without an API_KEY", () => {
    expect(() => validateLanguage("en", baseConfig(undefined, { API_KEY: "" }))).toThrow(
      /config is not initialized validating language/
    );
  });

  it("returns the language when supported, the fallback otherwise", () => {
    const config = baseConfig(undefined, { languages: { primary: "fr", supported: ["fr", "en"], fallback: "en" } });
    expect(validateLanguage("en", config)).toBe("en");
    expect(validateLanguage("de", config)).toBe("en");
  });
});

describe("isDevelopment", () => {
  it("is true with debug, or in a development build", () => {
    expect(isDevelopment(true)).toBe(true);
    expect(isDevelopment()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevelopment()).toBe(true);
  });
});

describe("warnAboutWhitespace", () => {
  it("warns only in development and only when the text has surrounding whitespace", () => {
    warnAboutWhitespace(" Bonjour ");
    expect(console.warn).not.toHaveBeenCalled();
    warnAboutWhitespace("Bonjour", true);
    expect(console.warn).not.toHaveBeenCalled();
    warnAboutWhitespace(" Bonjour ", true);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('" Bonjour "');
  });
});

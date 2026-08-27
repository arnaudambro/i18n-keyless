import { describe, it, expect, vi, afterEach } from "vitest";
import {
  storeKeys,
  translationsKeyFor,
  lastRefreshKeyFor,
  getItem,
  setItem,
  deleteItem,
  clearI18nKeylessStorage,
  createMemoryStorage,
  createDefaultBrowserStorage,
  validateLanguage,
} from "../utils.ts";
import type { I18nConfig, I18nStorage } from "../types.ts";

const silence = () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
};

describe("storage keys", () => {
  it("reuses the legacy keys for the default namespace and suffixes the others", () => {
    expect(translationsKeyFor("default")).toBe(storeKeys.translations);
    expect(lastRefreshKeyFor("default")).toBe(storeKeys.lastRefresh);
    expect(translationsKeyFor("shop")).toBe(`${storeKeys.translations}__shop`);
    expect(lastRefreshKeyFor("shop")).toBe(`${storeKeys.lastRefresh}__shop`);
  });
});

describe("getItem", () => {
  it("throws when the storage is missing", async () => {
    await expect(getItem("k", undefined)).rejects.toThrow(/storage is not initialized getting item k/);
  });

  it("reads a localStorage-like adapter (getItem)", async () => {
    const storage: I18nStorage = { getItem: (key) => (key === "k" ? "v" : null) };
    expect(await getItem("k", storage)).toBe("v");
    expect(await getItem("missing", storage)).toBeNull();
  });

  it("reads a get/set adapter (get)", async () => {
    const storage: I18nStorage = { get: () => "from-get" };
    expect(await getItem("k", storage)).toBe("from-get");
  });

  it("reads an MMKV-like adapter (getString)", async () => {
    const storage: I18nStorage = { getString: () => "from-mmkv" };
    expect(await getItem("k", storage)).toBe("from-mmkv");
  });

  it("awaits an AsyncStorage-like adapter", async () => {
    const storage: I18nStorage = { getItem: async (key) => `async:${key}` };
    expect(await getItem("k", storage)).toBe("async:k");
  });

  it("applies the serializer to a present value only", async () => {
    const storage: I18nStorage = { getItem: (key) => (key === "json" ? '{"a":"b"}' : null) };
    expect(await getItem("json", storage, JSON.parse)).toEqual({ a: "b" });
    expect(await getItem("missing", storage, JSON.parse)).toBeNull();
  });

  it("returns null for an adapter without any getter", async () => {
    expect(await getItem("k", {})).toBeNull();
  });

  it("logs and returns null when the adapter throws", async () => {
    silence();
    const storage: I18nStorage = {
      getItem: () => {
        throw new Error("quota");
      },
    };
    expect(await getItem("k", storage)).toBeNull();
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error getting item:", expect.any(Error));
  });
});

describe("setItem", () => {
  it("throws when the storage is missing", async () => {
    await expect(setItem("k", "v", undefined)).rejects.toThrow(/storage is not initialized setting item k/);
  });

  it("writes through setItem or set, and ignores an adapter without a setter", async () => {
    const setItemSpy = vi.fn();
    const setSpy = vi.fn();
    await setItem("k", "v", { setItem: setItemSpy });
    await setItem("k", "v", { set: setSpy });
    await setItem("k", "v", {});
    expect(setItemSpy).toHaveBeenCalledWith("k", "v");
    expect(setSpy).toHaveBeenCalledWith("k", "v");
  });

  it("logs and rethrows when the adapter throws", async () => {
    silence();
    const storage: I18nStorage = {
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    await expect(setItem("k", "v", storage)).rejects.toThrow(/quota exceeded/);
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error setting item:", expect.any(Error));
  });
});

describe("deleteItem", () => {
  it("throws when the storage is missing", async () => {
    await expect(deleteItem("k", undefined)).rejects.toThrow(/storage is not initialized deleting item k/);
  });

  it("removes through delete, del, removeItem or remove, in that order", async () => {
    const del = vi.fn();
    const remove = vi.fn();
    await deleteItem("k", { delete: del });
    expect(del).toHaveBeenCalledWith("k");
    del.mockClear();
    await deleteItem("k", { del });
    expect(del).toHaveBeenCalledWith("k");
    await deleteItem("k", { removeItem: remove });
    expect(remove).toHaveBeenCalledWith("k");
    remove.mockClear();
    await deleteItem("k", { remove });
    expect(remove).toHaveBeenCalledWith("k");
    // no remover at all: nothing to do, no error
    await deleteItem("k", {});
  });

  it("logs and swallows when the adapter throws", async () => {
    silence();
    const storage: I18nStorage = {
      removeItem: () => {
        throw new Error("locked");
      },
    };
    await expect(deleteItem("k", storage)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error deleting item:", expect.any(Error));
  });
});

describe("clearI18nKeylessStorage", () => {
  it("deletes every namespaced key and every store key except the device id", async () => {
    const memory = createMemoryStorage();
    memory.setItem!(storeKeys.uniqueId, "device-1");
    memory.setItem!(storeKeys.namespaces, JSON.stringify(["default", "shop"]));
    memory.setItem!(translationsKeyFor("default"), "{}");
    memory.setItem!(translationsKeyFor("shop"), "{}");
    memory.setItem!(lastRefreshKeyFor("shop"), "2025-01-01");
    memory.setItem!(storeKeys.currentLanguage, "en");
    memory.setItem!(storeKeys.translationsUsage, "{}");

    await clearI18nKeylessStorage(memory);

    expect(memory.getItem!(storeKeys.uniqueId)).toBe("device-1");
    expect(memory.getItem!(storeKeys.namespaces)).toBeNull();
    expect(memory.getItem!(translationsKeyFor("default"))).toBeNull();
    expect(memory.getItem!(translationsKeyFor("shop"))).toBeNull();
    expect(memory.getItem!(lastRefreshKeyFor("shop"))).toBeNull();
    expect(memory.getItem!(storeKeys.currentLanguage)).toBeNull();
    expect(memory.getItem!(storeKeys.translationsUsage)).toBeNull();
  });

  it("works without a namespaces index", async () => {
    const memory = createMemoryStorage();
    memory.setItem!(storeKeys.currentLanguage, "en");
    await clearI18nKeylessStorage(memory);
    expect(memory.getItem!(storeKeys.currentLanguage)).toBeNull();
  });
});

describe("createMemoryStorage", () => {
  it("stores, reads, removes and clears in memory", () => {
    const memory = createMemoryStorage();
    expect(memory.getItem!("k")).toBeNull();
    memory.setItem!("k", "v");
    expect(memory.getItem!("k")).toBe("v");
    memory.removeItem!("k");
    expect(memory.getItem!("k")).toBeNull();
    memory.setItem!("a", "1");
    memory.clear!();
    expect(memory.getItem!("a")).toBeNull();
  });
});

describe("createDefaultBrowserStorage", () => {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");

  afterEach(() => {
    if (original) {
      Object.defineProperty(window, "localStorage", original);
    }
  });

  it("returns window.localStorage when it is reachable", () => {
    expect(createDefaultBrowserStorage()).toBe(window.localStorage);
  });

  it("falls back to memory storage when the browser refuses access", () => {
    silence();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    const storage = createDefaultBrowserStorage();
    expect(storage).not.toBe(original?.value);
    storage.setItem!("k", "v");
    expect(storage.getItem!("k")).toBe("v");
    expect(console.warn).toHaveBeenCalledWith(
      "i18n-keyless: window.localStorage is not available, falling back to memory storage",
      expect.any(Error)
    );
  });

  it("falls back to memory storage when localStorage is null", () => {
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => null });
    const storage = createDefaultBrowserStorage();
    storage.setItem!("k", "v");
    expect(storage.getItem!("k")).toBe("v");
  });
});

describe("validateLanguage", () => {
  const config: I18nConfig = {
    API_KEY: "key",
    languages: { primary: "fr", supported: ["fr", "en"], fallback: "en" },
  };

  it("throws when the config is not initialized", () => {
    expect(() => validateLanguage("en", { ...config, API_KEY: "" })).toThrow(/config is not initialized/);
  });

  it("returns the language when supported and the fallback otherwise", () => {
    expect(validateLanguage("en", config)).toBe("en");
    expect(validateLanguage("de", config)).toBe("en");
  });
});

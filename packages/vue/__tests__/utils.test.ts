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
  validateLanguage,
} from "../utils.ts";
import type { I18nConfig } from "../types.ts";

type Storage = NonNullable<I18nConfig["storage"]>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("storage keys per namespace", () => {
  it("reuses the legacy keys for the default namespace and suffixes the others", () => {
    expect(translationsKeyFor("default")).toBe(storeKeys.translations);
    expect(translationsKeyFor("shop")).toBe(`${storeKeys.translations}__shop`);
    expect(lastRefreshKeyFor("default")).toBe(storeKeys.lastRefresh);
    expect(lastRefreshKeyFor("shop")).toBe(`${storeKeys.lastRefresh}__shop`);
  });
});

describe("getItem", () => {
  it("throws without a storage", async () => {
    await expect(getItem("k", undefined)).rejects.toThrow(/storage is not initialized getting item k/);
  });

  it("reads a localStorage-like adapter (getItem)", async () => {
    const storage = { getItem: vi.fn(() => "v") } as unknown as Storage;
    expect(await getItem("k", storage)).toBe("v");
    expect(storage.getItem).toHaveBeenCalledWith("k");
  });

  it("reads an idb-keyval-like adapter (get)", async () => {
    const storage = { get: vi.fn(() => "v") } as unknown as Storage;
    expect(await getItem("k", storage)).toBe("v");
    expect(storage.get).toHaveBeenCalledWith("k");
  });

  it("reads an MMKV-like adapter (getString)", async () => {
    const storage = { getString: vi.fn(() => "v"), set: vi.fn(), delete: vi.fn() } as unknown as Storage;
    expect(await getItem("k", storage)).toBe("v");
    expect(storage.getString).toHaveBeenCalledWith("k");
  });

  it("reads an AsyncStorage-like adapter (async getItem)", async () => {
    const storage = { getItem: vi.fn(async () => "v") } as unknown as Storage;
    expect(await getItem("k", storage)).toBe("v");
  });

  it("returns null for a missing key, and for an adapter with no read method", async () => {
    expect(await getItem("k", { getItem: () => null } as unknown as Storage)).toBeNull();
    expect(await getItem("k", { setItem: () => {} } as unknown as Storage)).toBeNull();
  });

  it("applies the serializer to a hit", async () => {
    const storage = { getItem: () => JSON.stringify({ a: "b" }) } as unknown as Storage;
    expect(await getItem("k", storage, JSON.parse)).toEqual({ a: "b" });
  });

  it("returns null and logs when the adapter or the serializer throws", async () => {
    const throwing = {
      getItem: () => {
        throw new Error("quota");
      },
    } as unknown as Storage;
    expect(await getItem("k", throwing)).toBeNull();
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error getting item:", expect.any(Error));

    const corrupt = { getItem: () => "{not json" } as unknown as Storage;
    expect(await getItem("k", corrupt, JSON.parse)).toBeNull();
  });
});

describe("setItem", () => {
  it("throws without a storage", async () => {
    await expect(setItem("k", "v", undefined)).rejects.toThrow(/storage is not initialized setting item k/);
  });

  it("writes through a localStorage-like adapter (setItem)", async () => {
    const storage = { setItem: vi.fn() } as unknown as Storage;
    await setItem("k", "v", storage);
    expect(storage.setItem).toHaveBeenCalledWith("k", "v");
  });

  it("writes through an MMKV-like adapter (set)", async () => {
    const storage = { getString: vi.fn(), set: vi.fn(), delete: vi.fn() } as unknown as Storage;
    await setItem("k", "v", storage);
    expect(storage.set).toHaveBeenCalledWith("k", "v");
  });

  it("is a no-op for an adapter with no write method", async () => {
    await expect(setItem("k", "v", { getItem: () => null } as unknown as Storage)).resolves.toBeUndefined();
  });

  it("logs and rethrows when the adapter throws", async () => {
    const storage = {
      setItem: () => {
        throw new Error("quota exceeded");
      },
    } as unknown as Storage;
    await expect(setItem("k", "v", storage)).rejects.toThrow(/quota exceeded/);
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error setting item:", expect.any(Error));
  });
});

describe("deleteItem", () => {
  it("throws without a storage", async () => {
    await expect(deleteItem("k", undefined)).rejects.toThrow(/storage is not initialized deleting item k/);
  });

  it.each([
    ["delete (MMKV)", "delete"],
    ["del", "del"],
    ["removeItem (localStorage)", "removeItem"],
    ["remove", "remove"],
  ])("deletes through %s", async (_label, method) => {
    const storage = { [method]: vi.fn() } as unknown as Storage;
    await deleteItem("k", storage);
    expect((storage as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]).toHaveBeenCalledWith("k");
  });

  it("prefers delete, then del, then removeItem, then remove", async () => {
    const storage = { delete: vi.fn(), del: vi.fn(), removeItem: vi.fn(), remove: vi.fn() } as unknown as Storage;
    await deleteItem("k", storage);
    expect(storage.delete).toHaveBeenCalledWith("k");
    expect(storage.del).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("is a no-op for an adapter with no delete method", async () => {
    await expect(deleteItem("k", { getItem: () => null } as unknown as Storage)).resolves.toBeUndefined();
  });

  it("logs and swallows when the adapter throws", async () => {
    const storage = {
      removeItem: () => {
        throw new Error("boom");
      },
    } as unknown as Storage;
    await expect(deleteItem("k", storage)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error deleting item:", expect.any(Error));
  });
});

describe("clearI18nKeylessStorage", () => {
  it("deletes every per-namespace slice from the index and the fixed keys, but keeps the device id", async () => {
    const storage = createMemoryStorage();
    storage.setItem!(storeKeys.uniqueId, "device-id-0001");
    storage.setItem!(storeKeys.namespaces, JSON.stringify(["default", "shop"]));
    storage.setItem!(storeKeys.translations, "{}");
    storage.setItem!(`${storeKeys.translations}__shop`, "{}");
    storage.setItem!(`${storeKeys.lastRefresh}__shop`, "2025-01-01");
    storage.setItem!(storeKeys.currentLanguage, "en");

    await clearI18nKeylessStorage(storage);

    expect(storage.getItem!(storeKeys.uniqueId)).toBe("device-id-0001");
    expect(storage.getItem!(storeKeys.namespaces)).toBeNull();
    expect(storage.getItem!(storeKeys.translations)).toBeNull();
    expect(storage.getItem!(`${storeKeys.translations}__shop`)).toBeNull();
    expect(storage.getItem!(`${storeKeys.lastRefresh}__shop`)).toBeNull();
    expect(storage.getItem!(storeKeys.currentLanguage)).toBeNull();
  });

  it("works without a namespaces index", async () => {
    const storage = createMemoryStorage();
    storage.setItem!(storeKeys.translations, "{}");
    await clearI18nKeylessStorage(storage);
    expect(storage.getItem!(storeKeys.translations)).toBeNull();
  });
});

describe("createMemoryStorage", () => {
  it("gets, sets, removes and clears", () => {
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

describe("validateLanguage", () => {
  const config = {
    API_KEY: "k",
    languages: { primary: "fr", supported: ["fr", "en"], fallback: "en" },
  } as unknown as I18nConfig;

  it("throws when the config is not initialized", () => {
    expect(() => validateLanguage("en", { ...config, API_KEY: "" })).toThrow(/config is not initialized validating language/);
  });

  it("returns the language when supported, the fallback otherwise", () => {
    expect(validateLanguage("fr", config)).toBe("fr");
    expect(validateLanguage("de", config)).toBe("en");
  });
});

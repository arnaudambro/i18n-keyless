import { describe, it, expect, vi, beforeEach } from "vitest";
import { getItem, setItem, deleteItem, clearI18nKeylessStorage, createMemoryStorage } from "../utils";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/**
 * The storage adapter normalises the shapes of localStorage, MMKV and AsyncStorage.
 * Each of these covers one of the API flavours it accepts.
 */
describe("getItem", () => {
  it("throws when no storage is configured", async () => {
    await expect(getItem("k", undefined)).rejects.toThrow(/storage is not initialized/);
  });

  it("reads through getItem (localStorage, AsyncStorage)", async () => {
    const storage = { getItem: vi.fn().mockResolvedValue("v"), setItem: vi.fn() };
    await expect(getItem("k", storage as never)).resolves.toBe("v");
  });

  it("reads through get", async () => {
    const storage = { get: vi.fn().mockReturnValue("v"), set: vi.fn() };
    await expect(getItem("k", storage as never)).resolves.toBe("v");
  });

  it("reads through getString (MMKV)", async () => {
    const storage = { getString: vi.fn().mockReturnValue("v"), set: vi.fn() };
    await expect(getItem("k", storage as never)).resolves.toBe("v");
  });

  it("applies the serializer when one is given", async () => {
    const storage = { getItem: vi.fn().mockResolvedValue('{"a":"b"}'), setItem: vi.fn() };
    await expect(getItem("k", storage as never, JSON.parse)).resolves.toEqual({ a: "b" });
  });

  it("returns null for a missing value", async () => {
    const storage = { getItem: vi.fn().mockResolvedValue(null), setItem: vi.fn() };
    await expect(getItem("k", storage as never)).resolves.toBeNull();
  });

  it("returns null when the storage throws, instead of breaking the caller", async () => {
    const storage = {
      getItem: vi.fn().mockRejectedValue(new Error("quota")),
      setItem: vi.fn(),
    };
    await expect(getItem("k", storage as never)).resolves.toBeNull();
  });

  it("returns null when the storage exposes no readable method", async () => {
    await expect(getItem("k", { setItem: vi.fn() } as never)).resolves.toBeNull();
  });
});

describe("setItem", () => {
  it("throws when no storage is configured", async () => {
    await expect(setItem("k", "v", undefined)).rejects.toThrow(/storage is not initialized/);
  });

  it("writes through setItem", async () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn() };
    await setItem("k", "v", storage as never);
    expect(storage.setItem).toHaveBeenCalledWith("k", "v");
  });

  it("writes through set (MMKV)", async () => {
    const storage = { set: vi.fn(), getString: vi.fn() };
    await setItem("k", "v", storage as never);
    expect(storage.set).toHaveBeenCalledWith("k", "v");
  });

  it("rethrows a write failure — a full quota must not pass silently", async () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new Error("QuotaExceededError");
      }),
      getItem: vi.fn(),
    };
    await expect(setItem("k", "v", storage as never)).rejects.toThrow(/QuotaExceededError/);
  });
});

describe("deleteItem", () => {
  it("throws when no storage is configured", async () => {
    await expect(deleteItem("k", undefined)).rejects.toThrow(/storage is not initialized/);
  });

  it.each([
    ["delete", { delete: vi.fn() }],
    ["del", { del: vi.fn() }],
    ["removeItem", { removeItem: vi.fn() }],
    ["remove", { remove: vi.fn() }],
  ])("removes through %s", async (method, storage) => {
    await deleteItem("k", storage as never);
    expect((storage as Record<string, ReturnType<typeof vi.fn>>)[method]).toHaveBeenCalledWith("k");
  });

  it("swallows a delete failure", async () => {
    const storage = {
      delete: vi.fn(() => {
        throw new Error("nope");
      }),
    };
    await expect(deleteItem("k", storage as never)).resolves.toBeUndefined();
  });
});

describe("createMemoryStorage", () => {
  it("round-trips a value", async () => {
    const storage = createMemoryStorage();
    await setItem("k", "v", storage);
    await expect(getItem("k", storage)).resolves.toBe("v");
  });

  it("forgets a deleted value", async () => {
    const storage = createMemoryStorage();
    await setItem("k", "v", storage);
    await deleteItem("k", storage);
    await expect(getItem("k", storage)).resolves.toBeNull();
  });

  it("starts empty for each instance, so SSR requests never share state", async () => {
    const a = createMemoryStorage();
    const b = createMemoryStorage();
    await setItem("k", "v", a);
    await expect(getItem("k", b)).resolves.toBeNull();
  });
});

describe("clearI18nKeylessStorage", () => {
  it("removes the namespaced keys as well as the fixed ones", async () => {
    const storage = createMemoryStorage();
    await setItem("i18n-keyless-namespaces", JSON.stringify(["checkout"]), storage);
    await setItem("i18n-keyless-translations__checkout", '{"Payer":"Pay"}', storage);
    await setItem("i18n-keyless-translations", '{"Bonjour":"Hello"}', storage);
    await setItem("i18n-keyless-current-language", "en", storage);

    await clearI18nKeylessStorage(storage);

    await expect(getItem("i18n-keyless-translations__checkout", storage)).resolves.toBeNull();
    await expect(getItem("i18n-keyless-translations", storage)).resolves.toBeNull();
    await expect(getItem("i18n-keyless-current-language", storage)).resolves.toBeNull();
  });

  it("works when there is no namespace index at all", async () => {
    const storage = createMemoryStorage();
    await setItem("i18n-keyless-translations", "{}", storage);
    await expect(clearI18nKeylessStorage(storage)).resolves.toBeUndefined();
  });
});

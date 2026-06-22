import { describe, it, expect, vi } from "vitest";
import { createMemoryStorage, translationsKeyFor, lastRefreshKeyFor, clearI18nKeylessStorage } from "../utils";

describe("createMemoryStorage", () => {
  it("returns null for a missing key", async () => {
    const storage = createMemoryStorage();
    expect(await storage.getItem!("missing")).toBeNull();
  });

  it("stores and retrieves a value", async () => {
    const storage = createMemoryStorage();
    storage.setItem!("k", "v");
    expect(await storage.getItem!("k")).toBe("v");
  });

  it("overwrites an existing value", async () => {
    const storage = createMemoryStorage();
    storage.setItem!("k", "v1");
    storage.setItem!("k", "v2");
    expect(await storage.getItem!("k")).toBe("v2");
  });

  it("removes a value", async () => {
    const storage = createMemoryStorage();
    storage.setItem!("k", "v");
    storage.removeItem!("k");
    expect(await storage.getItem!("k")).toBeNull();
  });

  it("clears all values", async () => {
    const storage = createMemoryStorage();
    storage.setItem!("a", "1");
    storage.setItem!("b", "2");
    storage.clear!();
    expect(await storage.getItem!("a")).toBeNull();
    expect(await storage.getItem!("b")).toBeNull();
  });

  it("creates independent instances (no shared state)", async () => {
    const a = createMemoryStorage();
    const b = createMemoryStorage();
    a.setItem!("k", "from-a");
    expect(await b.getItem!("k")).toBeNull();
  });
});

describe("namespace storage keys", () => {
  it("the default namespace reuses the legacy keys (backward compat)", () => {
    expect(translationsKeyFor("default")).toBe("i18n-keyless-translations");
    expect(lastRefreshKeyFor("default")).toBe("i18n-keyless-last-refresh");
  });

  it("other namespaces get a __<namespace> suffix", () => {
    expect(translationsKeyFor("checkout")).toBe("i18n-keyless-translations__checkout");
    expect(lastRefreshKeyFor("checkout")).toBe("i18n-keyless-last-refresh__checkout");
  });
});

describe("clearI18nKeylessStorage", () => {
  it("deletes every per-namespace key (from the index) plus the fixed keys", async () => {
    const deleted: string[] = [];
    const storage = {
      getItem: vi.fn((key: string) =>
        key === "i18n-keyless-namespaces" ? JSON.stringify(["default", "checkout"]) : null
      ),
      setItem: vi.fn(),
      removeItem: vi.fn((key: string) => {
        deleted.push(key);
      }),
    };

    await clearI18nKeylessStorage(storage);

    // per-namespace slices (default → legacy key, checkout → suffixed)
    expect(deleted).toContain("i18n-keyless-translations");
    expect(deleted).toContain("i18n-keyless-last-refresh");
    expect(deleted).toContain("i18n-keyless-translations__checkout");
    expect(deleted).toContain("i18n-keyless-last-refresh__checkout");
    // fixed keys (incl. the namespaces index itself)
    expect(deleted).toContain("i18n-keyless-user-id");
    expect(deleted).toContain("i18n-keyless-translations-usage");
    expect(deleted).toContain("i18n-keyless-namespaces");
  });
});

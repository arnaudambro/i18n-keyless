import { describe, it, expect } from "vitest";
import { createMemoryStorage } from "../utils";

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

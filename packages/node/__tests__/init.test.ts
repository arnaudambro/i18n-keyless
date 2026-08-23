import { describe, it, expect, vi, beforeEach } from "vitest";
import { init, getSupportedLanguages } from "../service.ts";
import { api } from "i18n-keyless-core";

const okAll = (translations: Record<string, Record<string, string>> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "1" },
  error: "",
  message: "",
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("init", () => {
  it("requires languages", async () => {
    // @ts-expect-error deliberately invalid config
    await expect(init({})).rejects.toThrow(/languages is required/);
  });

  it("requires a primary language", async () => {
    // @ts-expect-error deliberately invalid config
    await expect(init({ languages: { supported: ["en"] } })).rejects.toThrow(/primary is required/);
  });

  it("requires an API_KEY, an API_URL, or custom handlers", async () => {
    await expect(
      // @ts-expect-error deliberately invalid config
      init({ languages: { primary: "fr", supported: ["en"] } })
    ).rejects.toThrow(/API_KEY.*API_URL.*handleTranslate/s);
  });

  it("accepts a valid config and exposes the supported languages", async () => {
    vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll());

    await init({ languages: { primary: "fr", supported: ["en", "es"] }, API_KEY: "k" });

    expect(getSupportedLanguages()).toEqual(["en", "es"]);
  });

  it("boots with the configured default namespace", async () => {
    const spy = vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll());

    await init({
      languages: { primary: "fr", supported: ["en"] },
      API_KEY: "k",
      defaultNamespace: "app",
    });

    expect(spy.mock.calls[0][0]).toContain("namespace=app");
  });

  it("seeds the store from the boot fetch", async () => {
    vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(
      okAll({ en: { Bonjour: "Hello" } })
    );

    await init({ languages: { primary: "fr", supported: ["en"] }, API_KEY: "k" });

    const { awaitForTranslation } = await import("../service.ts");
    await expect(awaitForTranslation("Bonjour", "en")).resolves.toBe("Hello");
  });

  it("survives a failing boot fetch", async () => {
    vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockRejectedValue(new Error("offline"));

    await expect(
      init({ languages: { primary: "fr", supported: ["en"] }, API_KEY: "k" })
    ).resolves.toBeTruthy();
  });

  it("calls onInit with the primary language", async () => {
    vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll());
    const onInit = vi.fn();

    await init({ languages: { primary: "fr", supported: ["en"] }, API_KEY: "k", onInit });

    expect(onInit).toHaveBeenCalledWith("fr");
  });
});

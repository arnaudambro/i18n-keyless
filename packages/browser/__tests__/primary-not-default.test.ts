import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetUniqueIdState } from "i18n-keyless-core";
import { init, getState, getTranslation, resolveTranslation, watchTranslation, setCurrentLanguage, resetStore } from "../store.ts";
import { makeStorage, mockFetch, flush, baseConfig, silenceConsole } from "./helpers.ts";
import type { StorageAdapter } from "../types.ts";

/**
 * Every other suite uses the primary "fr", the same value the store holds before `init()`.
 * A code path that falls back to that default passes those suites for the wrong reason.
 * Here the app's primary is "en" and the target language is "fr": a fallback to the default
 * gives an answer these tests can see.
 */
const enPrimary = (storage: StorageAdapter) =>
  baseConfig(storage, { languages: { primary: "en", supported: ["en", "fr"] } });

beforeEach(() => {
  resetStore();
  resetUniqueIdState();
  silenceConsole();
  window.localStorage.clear();
});

afterEach(async () => {
  await flush();
  vi.restoreAllMocks();
});

describe("a primary language other than the store default", () => {
  it("before init, delivers the source text and requests nothing", async () => {
    const { calls } = mockFetch();
    // The default this file guards against.
    expect(getState().config.languages.primary).toBe("fr");
    expect(resolveTranslation("Hello")).toBe("Hello");
    const seen: string[] = [];
    const stop = watchTranslation("Hello", {}, (text) => seen.push(text));
    await flush();
    stop();
    expect(seen).toEqual(["Hello"]);
    expect(calls).toEqual([]);
  });

  it("renders the source text in the primary language and the dictionary in the store's default one", async () => {
    const { calls } = mockFetch({ fr: { Hello: "Bonjour" } });
    await init(enPrimary(makeStorage()));
    await flush();
    expect(getState().config.languages.primary).toBe("en");
    expect(getTranslation("Hello")).toBe("Hello");

    await setCurrentLanguage("fr");
    await flush();
    expect(getTranslation("Hello")).toBe("Bonjour");
    expect(resolveTranslation("Hello")).toBe("Bonjour");

    await setCurrentLanguage("en");
    await flush();
    expect(getTranslation("Hello")).toBe("Hello");
    // No miss left: the primary language never asks, and the dictionary had the key.
    expect(calls.filter((call) => call.method === "POST" && call.url.endsWith("/translate"))).toEqual([]);
  });
});

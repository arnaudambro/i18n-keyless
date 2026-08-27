import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyReplace, normalizeSourceText, requestTranslation, resolveTranslation } from "../resolve.ts";
import { init, store, setCurrentLanguage } from "../store.ts";
import { runWithI18nKeyless } from "../request-scope.ts";
import { baseConfig, mockFetch, resetAll, flush, EN, withoutWindow } from "./helpers.ts";

beforeEach(() => {
  resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("applyReplace", () => {
  it("returns the text untouched without a replace map or with an empty one", () => {
    expect(applyReplace("Bonjour {name}", undefined)).toBe("Bonjour {name}");
    expect(applyReplace("Bonjour {name}", {})).toBe("Bonjour {name}");
  });

  it("replaces every occurrence, regex-safely, and keeps a match whose value is empty", () => {
    expect(applyReplace("{a} et {a} (b) [c]", { "{a}": "x", "(b)": "y", "[c]": "" })).toBe("x et x y [c]");
  });
});

describe("normalizeSourceText", () => {
  it("trims and warns in dev mode about surrounding whitespace", () => {
    expect(normalizeSourceText("  Bonjour ")).toBe("Bonjour");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('leading/trailing whitespace: "  Bonjour "'));
  });

  it("does not warn for clean text, for whitespace-only text, or when warn is false", () => {
    expect(normalizeSourceText("Bonjour")).toBe("Bonjour");
    expect(normalizeSourceText("   ")).toBe("");
    expect(normalizeSourceText("  Bonjour ", false)).toBe("Bonjour");
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("requestTranslation", () => {
  it("queues a miss once the config is in the store, in the browser only", async () => {
    const api = mockFetch({ en: {} });
    // before init: nothing to call
    requestTranslation("Au revoir");
    await flush();
    expect(api.to("/translate")).toHaveLength(0);

    await init(baseConfig());
    await setCurrentLanguage("en");
    requestTranslation("");
    await flush();
    expect(api.to("/translate")).toHaveLength(0);

    await withoutWindow(() => requestTranslation("Au revoir"));
    await flush();
    expect(api.to("/translate")).toHaveLength(0);

    requestTranslation("Au revoir", { replace: { "{x}": "y" }, context: "ctx" });
    await vi.waitFor(() => expect(api.to("/translate")).toHaveLength(1));
    expect(api.to("/translate")[0].body).toMatchObject({ key: "Au revoir", context: "ctx" });
  });
});

describe("resolveTranslation", () => {
  it("reads the store, then an explicit scope, then the runWithI18nKeyless scope", async () => {
    mockFetch();
    await init(baseConfig());
    expect(resolveTranslation("Bonjour", undefined, undefined)).toEqual({ text: "Bonjour", lang: "fr" });

    await setCurrentLanguage("en");
    expect(resolveTranslation("Bonjour", undefined, null)).toEqual({ text: "Hello", lang: "en" });
    expect(resolveTranslation("Inconnu", undefined, null).text).toBe("Inconnu");

    expect(resolveTranslation("Bonjour", undefined, { lang: "es", translations: { Bonjour: "Hola" } })).toEqual({
      text: "Hola",
      lang: "es",
    });
    await runWithI18nKeyless({ lang: "es", translations: { Bonjour: "Hola" } }, () => {
      expect(resolveTranslation("Bonjour", undefined, undefined).text).toBe("Hola");
    });
  });

  it("treats originLanguage as the source language for UGC", async () => {
    mockFetch();
    await init(baseConfig());
    store.setState({ translations: { Hola: "Bonjour (UGC)" } });
    // written in Spanish, rendered in French: looked up
    expect(resolveTranslation("Hola", { originLanguage: "es" }, undefined).text).toBe("Bonjour (UGC)");
    // originLanguage equal to the primary language: the regular flow
    expect(resolveTranslation("Hola", { originLanguage: "fr" }, undefined).text).toBe("Hola");
    await setCurrentLanguage("es");
    // rendered in the language it is written in: as-is
    expect(resolveTranslation("Hola", { originLanguage: "es" }, undefined).text).toBe("Hola");
  });

  it("applies context and replace", async () => {
    mockFetch();
    await init(baseConfig());
    await setCurrentLanguage("en");
    expect(resolveTranslation("8 heures", { context: "durée" }, undefined).text).toBe(EN["8 heures__durée"]);
    expect(resolveTranslation("Bonjour {name}", { replace: { "{name}": "Ada" } }, undefined).text).toBe("Hello Ada");
  });
});

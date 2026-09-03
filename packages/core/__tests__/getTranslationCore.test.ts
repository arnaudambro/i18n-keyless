import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTranslationCore } from "../service.ts";
import { makeStore } from "./helpers.ts";

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, data: {} }) }) as never;
});

describe("getTranslationCore", () => {
  it("returns the key, interpolated, when the config was never initialised", () => {
    const store = makeStore({ currentLanguage: "en", translations: { Bonjour: "Hello" } });
    store.config.API_KEY = "";
    expect(getTranslationCore("Bonjour", store)).toBe("Bonjour");
    expect(getTranslationCore("Bonjour {name}", store, { replace: { "{name}": "Ada" } })).toBe("Bonjour Ada");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns the key as-is when the current language IS the primary one", () => {
    const store = makeStore({ currentLanguage: "fr" });
    expect(getTranslationCore("Bonjour", store)).toBe("Bonjour");
  });

  it("returns the stored translation for another language", () => {
    const store = makeStore({ translations: { Bonjour: "Hello" } });
    expect(getTranslationCore("Bonjour", store)).toBe("Hello");
  });

  it("falls back to the key when the translation has not arrived yet", () => {
    const store = makeStore({ translations: {} });
    expect(getTranslationCore("Bonjour", store)).toBe("Bonjour");
  });

  it("looks the key up under its context", () => {
    const store = makeStore({ translations: { "8 heures__time": "8 AM", "8 heures": "8 hours" } });
    expect(getTranslationCore("8 heures", store, { context: "time" })).toBe("8 AM");
    expect(getTranslationCore("8 heures", store)).toBe("8 hours");
  });

  describe("the `replace` option", () => {
    it("substitutes placeholders in the translation", () => {
      const store = makeStore({ translations: { "Hello {{name}}": "Bonjour {{name}}" } });
      const out = getTranslationCore("Hello {{name}}", store, { replace: { "{{name}}": "Arnaud" } });
      expect(out).toBe("Bonjour Arnaud");
    });

    it("substitutes into the KEY when no translation exists yet", () => {
      // regression: this path used to throw "Cannot read properties of undefined"
      const store = makeStore({ translations: {} });
      const out = getTranslationCore("Hello {{name}}", store, { replace: { "{{name}}": "Arnaud" } });
      expect(out).toBe("Hello Arnaud");
    });

    it("treats regex metacharacters in a placeholder literally", () => {
      const store = makeStore({ currentLanguage: "fr" });
      const out = getTranslationCore("Cost: $9.99 (net)", store, {
        replace: { "$9.99 (net)": "10 EUR" },
      });
      expect(out).toBe("Cost: 10 EUR");
    });

    it("replaces every occurrence, not just the first", () => {
      const store = makeStore({ currentLanguage: "fr" });
      expect(getTranslationCore("{{x}} and {{x}}", store, { replace: { "{{x}}": "A" } })).toBe("A and A");
    });

    it("leaves a placeholder that has no replacement alone", () => {
      const store = makeStore({ currentLanguage: "fr" });
      expect(getTranslationCore("{{a}} {{b}}", store, { replace: { "{{a}}": "A" } })).toBe("A {{b}}");
    });
  });

  describe("user generated content (originLanguage)", () => {
    it("renders the key as-is when viewing it in its own origin language", () => {
      const store = makeStore({ currentLanguage: "es" });
      expect(getTranslationCore("Hola mundo", store, { originLanguage: "es" })).toBe("Hola mundo");
    });

    it("still looks up a translation when viewing UGC in the PRIMARY language", () => {
      // the primary version of a UGC row is an AI translation, not the key itself
      const store = makeStore({
        currentLanguage: "fr",
        translations: { "Hola mundo": "Bonjour le monde" },
      });
      expect(getTranslationCore("Hola mundo", store, { originLanguage: "es" })).toBe("Bonjour le monde");
    });

    it("looks up a translation for a third language", () => {
      const store = makeStore({
        currentLanguage: "en",
        translations: { "Hola mundo": "Hello world" },
      });
      expect(getTranslationCore("Hola mundo", store, { originLanguage: "es" })).toBe("Hello world");
    });

    it("treats an originLanguage equal to the primary as the regular flow", () => {
      const store = makeStore({ currentLanguage: "fr" });
      expect(getTranslationCore("Bonjour", store, { originLanguage: "fr" })).toBe("Bonjour");
    });
  });
});

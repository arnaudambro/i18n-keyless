import { describe, it, expect } from "vitest";
import {
  AVAILABLE_LANGS,
  APP_STORE_LOCALES,
  resolveLang,
  toAppStoreLocale,
  type Lang,
} from "../types.ts";

/** The 19 languages i18n-keyless v2 shipped, as they were spelled on the wire. */
const V2_LANGS = [
  "fr",
  "en",
  "nl",
  "it",
  "de",
  "es",
  "pl",
  "pt",
  "ro",
  "hu",
  "sv",
  "tr",
  "ja",
  "cn",
  "cz",
  "ru",
  "ko",
  "ar",
  "el",
];

describe("AVAILABLE_LANGS", () => {
  it("has no duplicates", () => {
    expect(new Set(AVAILABLE_LANGS).size).toBe(AVAILABLE_LANGS.length);
  });

  it("has no bare `zh` — Chinese is selected by script", () => {
    expect(AVAILABLE_LANGS).not.toContain("zh");
    expect(AVAILABLE_LANGS).toContain("zh-Hans");
    expect(AVAILABLE_LANGS).toContain("zh-Hant");
  });

  it("regionalizes only where the translation really differs", () => {
    const regionalized = AVAILABLE_LANGS.filter((lang) => lang.includes("-"));
    expect([...regionalized].sort()).toEqual(["en-GB", "es-MX", "fr-CA", "pt-BR", "zh-Hans", "zh-Hant"]);
  });
});

describe("v2 language codes", () => {
  // v3 drops them: the backend ships v3 before the lib does, so a v3 client never meets a
  // v2 backend, and nothing translates the old spellings any more.
  it("no longer accepts cn or cz", () => {
    expect(AVAILABLE_LANGS).not.toContain("cn");
    expect(AVAILABLE_LANGS).not.toContain("cz");
    expect(resolveLang("cn")).toBeUndefined();
    expect(resolveLang("cz")).toBeUndefined();
  });

  it("keeps the 17 v2 codes that did not change", () => {
    const unchanged = V2_LANGS.filter((lang) => lang !== "cn" && lang !== "cz");
    for (const lang of unchanged) {
      expect(AVAILABLE_LANGS, `"${lang}" should still exist`).toContain(lang as Lang);
    }
    expect(unchanged).toHaveLength(17);
  });
});

describe("toAppStoreLocale", () => {
  it("maps every language onto an App Store slot", () => {
    for (const lang of AVAILABLE_LANGS) {
      expect(toAppStoreLocale(lang), `"${lang}" should have a slot`).toBeTruthy();
    }
  });

  it("adds the region Apple expects on its qualified slots", () => {
    expect(toAppStoreLocale("fr")).toBe("fr-FR");
    expect(toAppStoreLocale("en")).toBe("en-US");
    expect(toAppStoreLocale("de")).toBe("de-DE");
    expect(toAppStoreLocale("nl")).toBe("nl-NL");
    expect(toAppStoreLocale("ar")).toBe("ar-SA");
    expect(toAppStoreLocale("pt")).toBe("pt-PT");
    expect(toAppStoreLocale("es")).toBe("es-ES");
  });

  it("leaves Apple's bare slots bare", () => {
    expect(toAppStoreLocale("it")).toBe("it");
    expect(toAppStoreLocale("ja")).toBe("ja");
    expect(toAppStoreLocale("pl")).toBe("pl");
  });

  it("passes variants through untouched", () => {
    expect(toAppStoreLocale("pt-BR")).toBe("pt-BR");
    expect(toAppStoreLocale("es-MX")).toBe("es-MX");
    expect(toAppStoreLocale("fr-CA")).toBe("fr-CA");
    expect(toAppStoreLocale("en-GB")).toBe("en-GB");
    expect(toAppStoreLocale("zh-Hans")).toBe("zh-Hans");
    expect(toAppStoreLocale("zh-Hant")).toBe("zh-Hant");
  });

  it("covers 48 of Apple's 50 slots — en-AU and en-CA are served by `en`", () => {
    const slots = new Set(Object.values(APP_STORE_LOCALES));
    expect(slots.size).toBe(AVAILABLE_LANGS.length);
    expect(slots.has("en-AU")).toBe(false);
    expect(slots.has("en-CA")).toBe(false);
  });
});

describe("resolveLang", () => {
  it("returns an exact match", () => {
    expect(resolveLang("fr")).toBe("fr");
    expect(resolveLang("pt-BR")).toBe("pt-BR");
    expect(resolveLang("en-GB")).toBe("en-GB");
  });

  it("falls back to the bare language when the region has no variant", () => {
    expect(resolveLang("pt-AO")).toBe("pt");
    expect(resolveLang("fr-CH")).toBe("fr");
    expect(resolveLang("fr-BE")).toBe("fr");
    expect(resolveLang("en-AU")).toBe("en");
    expect(resolveLang("de-AT")).toBe("de");
  });

  it("resolves Chinese by script, never to a bare language", () => {
    expect(resolveLang("zh-TW")).toBe("zh-Hant");
    expect(resolveLang("zh-HK")).toBe("zh-Hant");
    expect(resolveLang("zh-MO")).toBe("zh-Hant");
    expect(resolveLang("zh-Hant")).toBe("zh-Hant");
    expect(resolveLang("zh-CN")).toBe("zh-Hans");
    expect(resolveLang("zh-SG")).toBe("zh-Hans");
    expect(resolveLang("zh")).toBe("zh-Hans");
  });

  it("accepts underscores and any casing", () => {
    expect(resolveLang("zh_CN")).toBe("zh-Hans");
    expect(resolveLang("pt_BR")).toBe("pt-BR");
    expect(resolveLang("PT-br")).toBe("pt-BR");
    expect(resolveLang("FR")).toBe("fr");
  });

  it("understands the UN M49 code for Latin America", () => {
    expect(resolveLang("es-419")).toBe("es-MX");
  });

  it("still maps the zh-CN region tag, which is a real locale", () => {
    // "zh-CN" is a BCP-47 tag a device can report; the bare "cn" of v2 is not.
    expect(resolveLang("zh-CN")).toBe("zh-Hans");
  });

  it("only returns a language the app actually ships", () => {
    // a Brazilian device on an app that only ships generic Portuguese
    expect(resolveLang("pt-BR", { supported: ["pt", "en"] })).toBe("pt");
    // ...and on one that ships both
    expect(resolveLang("pt-BR", { supported: ["pt", "pt-BR", "en"] })).toBe("pt-BR");
    // a Québécois device on an app shipping only French
    expect(resolveLang("fr-CA", { supported: ["fr"] })).toBe("fr");
  });

  it("uses the fallback when nothing matches", () => {
    expect(resolveLang("ja", { supported: ["pt", "en"], fallback: "en" })).toBe("en");
    expect(resolveLang("xx", { fallback: "en" })).toBe("en");
    expect(resolveLang(null, { fallback: "en" })).toBe("en");
  });

  it("returns undefined rather than guessing when there is no fallback", () => {
    expect(resolveLang("xx")).toBeUndefined();
    expect(resolveLang("")).toBeUndefined();
    expect(resolveLang(undefined)).toBeUndefined();
  });

  it("resolves every language it ships from its own code", () => {
    for (const lang of AVAILABLE_LANGS) {
      expect(resolveLang(lang), `"${lang}" should resolve to itself`).toBe(lang);
    }
  });
});

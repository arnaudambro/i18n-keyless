import { getTranslation, useI18nKeyless, hydrateFromServer } from "i18n-keyless-react";

// Runs in the React Native runtime (jest-expo preset). Proves i18n-keyless resolves
// translations natively. The visual <I18nKeylessText> render is the same component the web
// examples cover; here we assert the translation logic (no react-test-renderer needed).

const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
};

const EN = {
  "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.":
    "Here is a phrase available in all your languages, you can change it if you want.",
  "8 heures__heure": "8 AM",
  "8 heures__durée": "8 hours",
};

beforeEach(() => {
  useI18nKeyless.setState({
    config: {
      API_KEY: "demo",
      API_URL: "http://localhost:8787",
      languages: { primary: "fr", supported: ["fr", "en", "es"] },
      storage,
    },
  });
  hydrateFromServer({ lang: "en", translations: EN });
});

describe("expo example", () => {
  it("translates a string via getTranslation()", () => {
    expect(
      getTranslation(
        "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez."
      )
    ).toBe("Here is a phrase available in all your languages, you can change it if you want.");
  });

  it("resolves getTranslation() with context", () => {
    expect(getTranslation("8 heures", { context: "heure" })).toBe("8 AM");
    expect(getTranslation("8 heures", { context: "durée" })).toBe("8 hours");
  });

  it("returns the French source for the primary language", () => {
    hydrateFromServer({ lang: "fr", translations: {} });
    useI18nKeyless.setState({ currentLanguage: "fr" });
    expect(getTranslation("8 heures", { context: "heure" })).toBe("8 heures");
  });
});

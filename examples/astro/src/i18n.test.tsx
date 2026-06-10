import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nKeylessProvider, useI18nKeyless, hydrateFromServer } from "i18n-keyless-react";
import { HomeContent } from "./components/HomeContent";
import { AboutContent } from "./components/AboutContent";

const EN = {
  "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.":
    "Here is a phrase available in all your languages, you can change it if you want.",
  "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>.":
    "This text is rendered with the getTranslation() function instead of the <T> component.",
  "8 heures__heure": "8 AM",
  "8 heures__durée": "8 hours",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  useI18nKeyless.setState({
    config: {
      API_KEY: "demo",
      API_URL: "http://localhost:8787",
      languages: { primary: "fr", supported: ["fr", "en", "es"] },
      storage: window.localStorage,
    },
  });
});

describe("astro example (React island)", () => {
  it("translates <I18nKeylessText> via the provider", () => {
    render(
      <I18nKeylessProvider lang="en" translations={EN}>
        <HomeContent />
      </I18nKeylessProvider>
    );
    expect(
      screen.getByText("Here is a phrase available in all your languages, you can change it if you want.")
    ).toBeInTheDocument();
  });

  it("translates getTranslation() once the store is seeded", () => {
    hydrateFromServer({ lang: "en", translations: EN });
    render(<AboutContent />);
    expect(screen.getByText("8 AM")).toBeInTheDocument();
  });
});

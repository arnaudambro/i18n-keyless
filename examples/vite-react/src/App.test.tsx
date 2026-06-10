import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useI18nKeyless, hydrateFromServer } from "i18n-keyless-react";
import { App } from "./App";
import { Home } from "./pages/Home";
import { About } from "./pages/About";

// English translations of the French source strings used by the two pages.
const EN = {
  "Changer de langue": "Switch language",
  "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.":
    "Here is a phrase available in all your languages, you can change it if you want.",
  "À propos de cette démo": "About this demo",
  "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>.":
    "This text is rendered with the getTranslation() function instead of the <T> component.",
  "8 heures__heure": "8 AM",
  "8 heures__durée": "8 hours",
};

beforeEach(() => {
  // setLanguage's background fetch has no server in the test env — silence the error.
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Seed the store directly (no network), exactly as if hydrating an English SSR snapshot.
  useI18nKeyless.setState({
    config: {
      API_KEY: "demo",
      API_URL: "http://localhost:8787", // keep any background fetch off the real service
      languages: { primary: "fr", supported: ["fr", "en", "es"] },
      storage: window.localStorage,
    },
  });
  hydrateFromServer({ lang: "en", translations: EN });
});

describe("vite-react example", () => {
  it("translates <I18nKeylessText> content (Home / component path)", () => {
    render(<Home />);
    expect(
      screen.getByText("Here is a phrase available in all your languages, you can change it if you want.")
    ).toBeInTheDocument();
  });

  it("translates getTranslation() content + context (About / function path)", () => {
    render(<About />);
    expect(
      screen.getByText("This text is rendered with the getTranslation() function instead of the <T> component.")
    ).toBeInTheDocument();
    expect(screen.getByText("8 AM")).toBeInTheDocument(); // 8 heures / heure
    expect(screen.getByText("8 hours")).toBeInTheDocument(); // 8 heures / durée
  });

  it("switches language with the switcher", () => {
    render(<App />);
    expect(useI18nKeyless.getState().currentLanguage).toBe("en");
    fireEvent.click(screen.getByRole("button", { name: /switch language/i }));
    expect(useI18nKeyless.getState().currentLanguage).toBe("es"); // en -> next supported
  });
});

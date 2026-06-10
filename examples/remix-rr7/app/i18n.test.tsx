import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import {
  useI18nKeyless,
  hydrateFromServer,
  runWithI18nKeyless,
  getUsedTranslationsSnapshot,
} from "i18n-keyless-react";
import { HomeContent } from "./components/HomeContent";
import { AboutContent } from "./components/AboutContent";

const EN_FULL = {
  "À propos de cette démo": "About this demo",
  "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.":
    "Here is a phrase available in all your languages, you can change it if you want.",
  "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>.":
    "This text is rendered with the getTranslation() function instead of the <T> component.",
  "Cette page utilise des chaînes différentes de la page d'accueil — en SSR, chaque page ne sérialise que ses propres clés.":
    "This page uses different strings than the home page — under SSR, each page serializes only its own keys.",
  "8 heures__heure": "8 AM",
  "8 heures__durée": "8 hours",
};

function seedConfig(storage?: Storage) {
  useI18nKeyless.setState({
    config: {
      API_KEY: "demo",
      API_URL: "http://localhost:8787",
      languages: { primary: "fr", supported: ["fr", "en", "es"] },
      storage,
    },
  });
}

describe("remix-rr7 example", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    seedConfig(window.localStorage);
  });

  it("renders a page translated after hydrateFromServer", () => {
    hydrateFromServer({ lang: "en", translations: EN_FULL });
    render(<HomeContent />);
    expect(
      screen.getByText("Here is a phrase available in all your languages, you can change it if you want.")
    ).toBeInTheDocument();
  });

  describe("server render (SSR scope)", () => {
    beforeEach(() => {
      vi.stubGlobal("window", undefined);
      seedConfig();
    });
    afterEach(() => vi.unstubAllGlobals());

    it("renders English HTML and a per-page snapshot", async () => {
      let snapshot: ReturnType<typeof getUsedTranslationsSnapshot>;
      const html = await runWithI18nKeyless({ lang: "en", translations: EN_FULL }, () => {
        const out = renderToString(<AboutContent />);
        snapshot = getUsedTranslationsSnapshot();
        return out;
      });
      expect(html).toContain("About this demo");
      expect(html).toContain("8 AM");
      const keys = Object.keys(snapshot!.translations);
      expect(keys).toContain("8 heures__heure");
      expect(keys).not.toContain(
        "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez."
      );
    });
  });
});

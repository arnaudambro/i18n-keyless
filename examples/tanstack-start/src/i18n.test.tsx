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

// Full English language set (as getServerTranslations would return on the server).
const EN_FULL = {
  "À propos de cette démo": "About this demo",
  "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.":
    "Here is a phrase available in all your languages, you can change it if you want.",
  "Attention, vous traduisez en 15 langues, cela prend plus de temps que 2 ou 5, qui sont des cas d'usage plus courants.":
    "Beware you are translating in 15 languages, it takes more time than only 2 or 5, which are more common use cases.",
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
      storage, // server (SSR test) has no DOM storage; client uses localStorage
    },
  });
}

describe("tanstack-start example", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    seedConfig(window.localStorage);
  });

  it("renders a page translated after a client-side hydrateFromServer seed", () => {
    hydrateFromServer({ lang: "en", translations: EN_FULL });
    render(<HomeContent />);
    expect(
      screen.getByText("Here is a phrase available in all your languages, you can change it if you want.")
    ).toBeInTheDocument();
  });

  describe("server render (SSR scope)", () => {
    beforeEach(() => {
      vi.stubGlobal("window", undefined); // simulate the server so AsyncLocalStorage activates
      seedConfig(); // no storage on the server (in-memory)
    });
    afterEach(() => vi.unstubAllGlobals());

    it("renders English HTML and the snapshot contains ONLY the page's keys", async () => {
      let snapshot: ReturnType<typeof getUsedTranslationsSnapshot>;
      const html = await runWithI18nKeyless({ lang: "en", translations: EN_FULL }, () => {
        const out = renderToString(<AboutContent />);
        snapshot = getUsedTranslationsSnapshot();
        return out;
      });

      // The whole page server-rendered in English (both <T> and getTranslation paths).
      expect(html).toContain("About this demo");
      expect(html).toContain("8 AM");
      expect(html).toContain("8 hours");

      // Per-page snapshot: only About's keys, NOT Home's.
      const keys = Object.keys(snapshot!.translations);
      expect(keys).toContain("8 heures__heure");
      expect(keys).toContain("Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>.");
      expect(keys).not.toContain(
        "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez."
      );
    });
  });
});

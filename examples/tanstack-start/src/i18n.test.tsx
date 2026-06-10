import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import {
  useI18nKeyless,
  I18nKeylessProvider,
  getTranslation,
  runWithI18nKeyless,
} from "i18n-keyless-react";
import { HomeContent } from "./components/HomeContent";
import { AboutContent } from "./components/AboutContent";

// Full English language set (as getServerTranslations would return on the server).
const EN_FULL = {
  "Langue : {{current_lang}}": "Language: {{current_lang}}",
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

const aboutLoaderData = () => ({
  intro: getTranslation("Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>."),
  note: getTranslation(
    "Cette page utilise des chaînes différentes de la page d'accueil — en SSR, chaque page ne sérialise que ses propres clés."
  ),
  asTime: getTranslation("8 heures", { context: "heure" }),
  asDuration: getTranslation("8 heures", { context: "durée" }),
});

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

  // COMPONENT PATH: <I18nKeylessText> resolves via <I18nKeylessProvider> (React context),
  // independent of the ALS — this is what makes the body render correctly in TanStack Start,
  // whose component tree renders outside the request scope.
  it("renders the component path in the provider's language", () => {
    render(
      <I18nKeylessProvider lang="en" translations={EN_FULL}>
        <HomeContent />
      </I18nKeylessProvider>
    );
    expect(
      screen.getByText(
        "Here is a phrase available in all your languages, you can change it if you want."
      )
    ).toBeInTheDocument();
    // The `replace` value uses the PROVIDER's language, not the global store's.
    expect(screen.getByText("Language: en")).toBeInTheDocument();
  });

  describe("server render (SSR scope)", () => {
    beforeEach(() => {
      vi.stubGlobal("window", undefined); // simulate the server so AsyncLocalStorage activates
      seedConfig(); // no storage on the server (in-memory)
    });
    afterEach(() => vi.unstubAllGlobals());

    // FUNCTION PATH: getTranslation() (as called from a route loader) resolves in the
    // request's language via the ALS set by runWithI18nKeyless.
    it("resolves imperative getTranslation() inside the request scope", async () => {
      const data = await runWithI18nKeyless({ lang: "en", translations: EN_FULL }, aboutLoaderData);
      expect(data.intro).toBe(
        "This text is rendered with the getTranslation() function instead of the <T> component."
      );
      expect(data.asTime).toBe("8 AM"); // context: heure
      expect(data.asDuration).toBe("8 hours"); // context: durée
    });

    // The two paths together: <h2> (component path, via provider) + loader strings (function
    // path, via ALS) all render in English on the server.
    it("server-renders the About page in English across both paths", async () => {
      const html = await runWithI18nKeyless({ lang: "en", translations: EN_FULL }, () =>
        renderToString(
          <I18nKeylessProvider lang="en" translations={EN_FULL}>
            <AboutContent {...aboutLoaderData()} />
          </I18nKeylessProvider>
        )
      );
      expect(html).toContain("About this demo"); // component path
      expect(html).toContain("8 AM"); // function path
      expect(html).toContain("8 hours");
    });
  });
});

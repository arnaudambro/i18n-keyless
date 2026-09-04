import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nKeylessProvider, useI18nKeyless, hydrateFromServer } from "i18n-keyless-react";
import { HomeContent } from "./components/HomeContent";
import { AboutContent } from "./components/AboutContent";
import { Providers } from "./app/Providers";
import Page from "./app/[lang]/page";

const EN = {
  "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.":
    "Here is a phrase available in all your languages, you can change it if you want.",
  "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>.":
    "This text is rendered with the getTranslation() function instead of the <T> component.",
  "8 heures__heure": "8 AM",
  "8 heures__durée": "8 hours",
  "Ce paragraphe est rendu par un composant serveur.": "This paragraph is rendered by a server component.",
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

describe("nextjs example", () => {
  // The <T> component is SSR-correct via <I18nKeylessProvider> (the Next pattern).
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

  // getTranslation reads the store — seeded by hydrateFromServer on the client.
  it("translates getTranslation() once the store is seeded", () => {
    hydrateFromServer({ lang: "en", translations: EN });
    render(<AboutContent />);
    expect(
      screen.getByText("This text is rendered with the getTranslation() function instead of the <T> component.")
    ).toBeInTheDocument();
    expect(screen.getByText("8 AM")).toBeInTheDocument();
  });

  // Next renders client components on the server in a module graph where the layout's
  // init() never ran: the store there is a fresh instance. <Providers> passes `primary`, so
  // the resolution never reads the store's config. Simulated here with a store whose config
  // disagrees with the app (primary "en", no key): the provider's "fr" must win.
  it("<Providers> resolves from its own primary, not the store's", () => {
    useI18nKeyless.setState({
      config: { API_KEY: "", languages: { primary: "en", supported: ["en"] } },
      currentLanguage: "en",
    });
    render(
      <Providers lang="en" translations={EN}>
        <HomeContent />
      </Providers>
    );
    expect(
      screen.getByText("Here is a phrase available in all your languages, you can change it if you want.")
    ).toBeInTheDocument();
  });

  it("the primary language renders the source text through <Providers>", () => {
    render(
      <Providers lang="fr" translations={{}}>
        <HomeContent />
      </Providers>
    );
    expect(
      screen.getByText(
        "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez."
      )
    ).toBeInTheDocument();
  });

  // The page is a Server Component that renders <T> directly (the SDK ships "use client").
  it("a server component page renders <T> through the provider", () => {
    render(
      <I18nKeylessProvider lang="en" primary="fr" translations={EN}>
        <Page />
      </I18nKeylessProvider>
    );
    expect(screen.getByText("This paragraph is rendered by a server component.")).toBeInTheDocument();
  });
});

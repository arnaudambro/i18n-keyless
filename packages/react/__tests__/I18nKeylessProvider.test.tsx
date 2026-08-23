import React from "react";
import { render, screen } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { getTranslationCore, type PrimaryLang, type Lang } from "i18n-keyless-core";
import { I18nKeylessText } from "../I18nKeylessText";
import { I18nKeylessProvider } from "../I18nKeylessProvider";

// Same store-mock shape as I18nKeylessText.test.tsx: the store is pinned to the primary
// language ("en") with no translations, so anything the provider renders in another
// language proves the per-request context overrides the global store.
const mockStore = vi.hoisted(() => {
  const store = {
    config: {
      API_KEY: "any-fucking-key",
      languages: {
        primary: "en" as PrimaryLang,
        supported: ["en", "fr", "es"] as Lang[],
      },
    },
    currentLanguage: "en" as Lang,
    translations: {} as Record<string, string>,
    uniqueId: null,
    lastRefresh: null,
    setTranslations: vi.fn(),
    setLanguage: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useI18nKeylessMock = (selectorOrStore: any) =>
    typeof selectorOrStore === "function" ? selectorOrStore(store) : store;
  useI18nKeylessMock.getState = vi.fn(() => store);
  // zustand's setState takes a partial OR an updater function; the provider uses the
  // updater form to merge into existing translations, so the mock must accept both.
  useI18nKeylessMock.setState = vi.fn((newState) =>
    Object.assign(store, typeof newState === "function" ? newState(store) : newState)
  );
  return useI18nKeylessMock;
});

vi.mock("../store", async () => ({
  useI18nKeyless: mockStore,
  getTranslation: vi.fn((key, options) => getTranslationCore(key, mockStore.getState(), options)),
}));

vi.mock("../utils", () => ({
  validateLanguage: vi.fn((lang) => lang),
}));

describe("I18nKeylessProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.setState({
      translations: {},
      currentLanguage: "en",
      config: {
        API_KEY: "any-fucking-key",
        languages: { primary: "en" as PrimaryLang, supported: ["en", "fr", "es"] as Lang[] },
      },
    });
  });

  it("renders text in the provider language using provider translations (overriding the store)", () => {
    render(
      <I18nKeylessProvider lang="es" translations={{ "Hello World": "Hola Mundo" }}>
        <I18nKeylessText>Hello World</I18nKeylessText>
      </I18nKeylessProvider>
    );
    expect(screen.getByText("Hola Mundo")).toBeInTheDocument();
  });

  it("renders the source text when the provider language is the primary language", () => {
    render(
      <I18nKeylessProvider lang="en" translations={{}}>
        <I18nKeylessText>Hello World</I18nKeylessText>
      </I18nKeylessProvider>
    );
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("falls back to the source text when the key is missing from provider translations", () => {
    render(
      <I18nKeylessProvider lang="fr" translations={{ Other: "Autre" }}>
        <I18nKeylessText>Hello World</I18nKeylessText>
      </I18nKeylessProvider>
    );
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("resolves context-specific translations from the provider (key__context)", () => {
    render(
      <I18nKeylessProvider lang="fr" translations={{ Welcome__header: "Bienvenue" }}>
        <I18nKeylessText context="header">Welcome</I18nKeylessText>
      </I18nKeylessProvider>
    );
    expect(screen.getByText("Bienvenue")).toBeInTheDocument();
  });

  it("provider translations win even when the store holds a different value", () => {
    mockStore.setState({ currentLanguage: "fr", translations: { "Hello World": "Bonjour le monde" } });
    render(
      <I18nKeylessProvider lang="es" translations={{ "Hello World": "Hola Mundo" }}>
        <I18nKeylessText>Hello World</I18nKeylessText>
      </I18nKeylessProvider>
    );
    expect(screen.getByText("Hola Mundo")).toBeInTheDocument();
    expect(screen.queryByText("Bonjour le monde")).not.toBeInTheDocument();
  });

  it("without a provider, <T> still reads from the store (SPA mode unaffected)", () => {
    mockStore.setState({ currentLanguage: "fr", translations: { "Hello World": "Bonjour le monde" } });
    render(<I18nKeylessText>Hello World</I18nKeylessText>);
    expect(screen.getByText("Bonjour le monde")).toBeInTheDocument();
  });

  // The provider also seeds the global store in an effect, so that reads AFTER hydration —
  // notably the imperative getTranslation(), which cannot read React context — match what
  // the server rendered.
  it("seeds the global store with the server snapshot after mount", () => {
    mockStore.setState({ currentLanguage: "fr", translations: {} });

    render(
      <I18nKeylessProvider lang="es" translations={{ "Hello World": "Hola Mundo" }}>
        <span>child</span>
      </I18nKeylessProvider>
    );

    expect(mockStore.getState().currentLanguage).toBe("es");
    expect(mockStore.getState().translations).toMatchObject({ "Hello World": "Hola Mundo" });
  });

  it("merges the snapshot into what the store already had", () => {
    mockStore.setState({ currentLanguage: "fr", translations: { Existing: "Déjà là" } });

    render(
      <I18nKeylessProvider lang="es" translations={{ "Hello World": "Hola Mundo" }}>
        <span>child</span>
      </I18nKeylessProvider>
    );

    expect(mockStore.getState().translations).toMatchObject({
      Existing: "Déjà là",
      "Hello World": "Hola Mundo",
    });
  });
});

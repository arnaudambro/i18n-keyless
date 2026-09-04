import React from "react";
import { render, screen } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { getTranslationCore, type PrimaryLang, type Lang } from "i18n-keyless-core";
import { useTranslation } from "../useTranslation";
import { I18nKeylessText } from "../I18nKeylessText";
import { I18nKeylessProvider } from "../I18nKeylessProvider";
import { runWithI18nKeyless, getUsedTranslationsSnapshot } from "../request-scope";

// Same store-mock shape as I18nKeylessText.test.tsx.
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
  useI18nKeylessMock.setState = vi.fn((newState) =>
    Object.assign(store, typeof newState === "function" ? newState(store) : newState)
  );
  return useI18nKeylessMock;
});

const getTranslationMock = vi.hoisted(() => vi.fn());

// The hooks live in their own client module (hooks.ts); the components read the store
// through it, so the same mock serves both.
vi.mock("../hooks", async () => ({ useI18nKeyless: mockStore }));

vi.mock("../store", async () => ({
  useI18nKeyless: mockStore,
  getTranslation: getTranslationMock,
}));

vi.mock("../utils", () => ({
  validateLanguage: vi.fn((lang) => lang),
}));

/** The hook's consumer: an attribute, which is the one place an element cannot go. */
function Placeholder({ text, options }: { text: string; options?: Parameters<typeof useTranslation>[1] }) {
  return <input placeholder={useTranslation(text, options)} />;
}

describe("useTranslation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTranslationMock.mockImplementation((key, options) => getTranslationCore(key, mockStore.getState(), options));
    mockStore.setState({
      translations: {},
      currentLanguage: "en",
      config: {
        API_KEY: "any-fucking-key",
        languages: { primary: "en" as PrimaryLang, supported: ["en", "fr", "es"] as Lang[] },
      },
    });
  });

  it("returns the source text in the primary language", () => {
    render(<Placeholder text="Your email" />);
    expect(screen.getByPlaceholderText("Your email")).toBeInTheDocument();
  });

  it("returns the store translation in a non-primary language", () => {
    mockStore.setState({ currentLanguage: "fr", translations: { "Your email": "Votre email" } });
    render(<Placeholder text="Your email" />);
    expect(screen.getByPlaceholderText("Votre email")).toBeInTheDocument();
  });

  it("falls back to the source text when the key has no translation yet", () => {
    mockStore.setState({ currentLanguage: "fr", translations: {} });
    render(<Placeholder text="Brand new sentence" />);
    expect(screen.getByPlaceholderText("Brand new sentence")).toBeInTheDocument();
  });

  it("looks the key up with its context, like the component does", () => {
    mockStore.setState({ currentLanguage: "fr", translations: { Welcome__header: "Bienvenue" } });
    render(<Placeholder text="Welcome" options={{ context: "header" }} />);
    expect(screen.getByPlaceholderText("Bienvenue")).toBeInTheDocument();
  });

  it("substitutes `replace` values and escapes regex characters in placeholders", () => {
    mockStore.setState({ currentLanguage: "fr", translations: { "Total: {a.b}": "Total : {a.b}" } });
    render(<Placeholder text="Total: {a.b}" options={{ replace: { "{a.b}": "42" } }} />);
    expect(screen.getByPlaceholderText("Total : 42")).toBeInTheDocument();
  });

  it("queues a miss for translation with every option, exactly as the component does", () => {
    mockStore.setState({ currentLanguage: "fr" });
    const options = { context: "form", namespace: "auth", originLanguage: "es" as Lang };
    render(<Placeholder text=" Your email " options={options} />);
    expect(getTranslationMock).toHaveBeenCalledWith(
      "Your email",
      expect.objectContaining({ context: "form", namespace: "auth", originLanguage: "es" })
    );
  });

  it("renders UGC as-is when the current language is its origin language", () => {
    // A key written in Spanish, shown to a Spanish reader: the raw text, no lookup.
    mockStore.setState({ currentLanguage: "es", translations: { "Hola a todos": "SHOULD NOT SHOW" } });
    render(<Placeholder text="Hola a todos" options={{ originLanguage: "es" }} />);
    expect(screen.getByPlaceholderText("Hola a todos")).toBeInTheDocument();
  });

  it("looks a UGC key up even in the primary language", () => {
    // Same key, English reader: the primary-language cell the API filled in.
    mockStore.setState({ currentLanguage: "en", translations: { "Hola a todos": "Hello everyone" } });
    render(<Placeholder text="Hola a todos" options={{ originLanguage: "es" }} />);
    expect(screen.getByPlaceholderText("Hello everyone")).toBeInTheDocument();
  });

  it("reads the provider before the store, so SSR resolves in the request language", () => {
    // The store is pinned to English with nothing in it; only the provider knows Spanish.
    render(
      <I18nKeylessProvider lang="es" translations={{ "Your email": "Tu correo" }}>
        <Placeholder text="Your email" />
      </I18nKeylessProvider>
    );
    expect(screen.getByPlaceholderText("Tu correo")).toBeInTheDocument();
  });

  it("records its key in the per-request SSR snapshot, like the component", async () => {
    // Two keys in scope, one used: the per-page subset is only the used one.
    const snapshot = await runWithI18nKeyless(
      { lang: "fr", translations: { "Your email": "Votre email", Title: "Titre" } },
      async () => {
        render(<Placeholder text="Your email" />);
        return getUsedTranslationsSnapshot();
      }
    );
    expect(snapshot).toEqual({ lang: "fr", translations: { "Your email": "Votre email" } });
  });

  it("is what <I18nKeylessText> renders — the two cannot drift", () => {
    mockStore.setState({ currentLanguage: "fr", translations: { "Hello {name}__greeting": "Bonjour {name}" } });
    const options = { context: "greeting", replace: { "{name}": "Ada" } };
    render(
      <>
        <Placeholder text="Hello {name}" options={options} />
        <p>
          <I18nKeylessText {...options}>Hello {"{name}"}</I18nKeylessText>
        </p>
      </>
    );
    expect(screen.getByPlaceholderText("Bonjour Ada")).toBeInTheDocument();
    expect(screen.getByText("Bonjour Ada")).toBeInTheDocument();
  });
});

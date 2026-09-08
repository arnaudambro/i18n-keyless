import React from "react";
import { render, screen } from "@testing-library/react";
import { I18nKeylessText } from "../I18nKeylessText";
import { vi, beforeEach, describe, it, expect, afterEach } from "vitest";
import { getTranslationCore, type PrimaryLang, type Lang } from "i18n-keyless-core";

// Create a mock store before vi.mock call using vi.hoisted
const mockStore = vi.hoisted(() => {
  const store = {
    config: {
      API_KEY: "any-fucking-key",
      languages: {
        primary: "en" as PrimaryLang,
        supported: ["en"] as Lang[],
      },
    },
    currentLanguage: "en" as Lang,
    translations: {},
    uniqueId: null,
    lastRefresh: null,
    setTranslations: vi.fn(),
    setLanguage: vi.fn((lang) => {
      store.currentLanguage = lang;
    }),
  };

  // Create a function that supports the selector pattern
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useI18nKeylessMock = (selectorOrStore: any) => {
    // If it's a function (selector), call it with the store
    if (typeof selectorOrStore === "function") {
      return selectorOrStore(store);
    }
    // Otherwise return the store
    return store;
  };

  // Add the getState and setState methods to the mock function
  useI18nKeylessMock.getState = vi.fn(() => store);
  useI18nKeylessMock.setState = vi.fn((newState) => Object.assign(store, newState));

  return useI18nKeylessMock;
});

// Mock the store module - this is hoisted to the top of the file
// The hooks live in their own client module (hooks.ts); the components read the store
// through it, so the same mock serves both.
vi.mock("../hooks", async () => ({ useI18nKeyless: mockStore }));

vi.mock("../store", async () => {
  return {
    useI18nKeyless: mockStore,
    getTranslation: vi.fn((key, options) => {
      return getTranslationCore(key, mockStore.getState(), options);
    }),
  };
});

vi.mock("../utils", () => ({
  validateLanguage: vi.fn((lang) => lang),
}));

describe("I18nKeylessText", () => {
  // Save original console methods
  const originalConsoleWarn = console.warn;
  const originalConsoleLog = console.log;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console methods for testing
    console.warn = vi.fn();
    console.log = vi.fn();

    // Reset store to default state
    mockStore.setState({
      translations: {},
      currentLanguage: "en",
      config: {
        API_KEY: "any-fucking-key",
        languages: {
          primary: "en" as PrimaryLang,
          supported: ["en"] as Lang[],
        },
      },
    });
  });

  afterEach(() => {
    // Restore original console methods
    console.warn = originalConsoleWarn;
    console.log = originalConsoleLog;
  });

  it("renders the original text when language is primary", () => {
    render(<I18nKeylessText>Hello World</I18nKeylessText>);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("renders translated text when available", () => {
    mockStore.setState({
      currentLanguage: "fr",
      translations: {
        "Hello World": "Bonjour le monde",
      },
    });

    render(<I18nKeylessText>Hello World</I18nKeylessText>);
    expect(screen.getByText("Bonjour le monde")).toBeInTheDocument();
  });

  it("handles whitespace trimming and warns in development", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    render(<I18nKeylessText> Hello World </I18nKeylessText>);

    expect(screen.getByText("Hello World")).toBeInTheDocument();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("received text with leading/trailing whitespace")
    );

    process.env.NODE_ENV = originalNodeEnv;
  });

  it("handles text replacement", () => {
    render(<I18nKeylessText replace={{ "{{name}}": "John" }}>{`Hello {{name}}`}</I18nKeylessText>);

    expect(screen.getByText("Hello John")).toBeInTheDocument();
  });

  describe("count / ordinal / select", () => {
    const EN = "{count, plural, one {{count} item} other {{count} items}}";
    const RU = "{count, plural, one {{count} товар} few {{count} товара} many {{count} товаров} other {{count} товара}}";

    it("renders the model's form in the primary language too, from the store", () => {
      mockStore.setState({ translations: { "{count} items": EN } });
      const { rerender } = render(<I18nKeylessText count={1}>{"{count} items"}</I18nKeylessText>);
      expect(screen.getByText("1 item")).toBeInTheDocument();
      rerender(<I18nKeylessText count={3}>{"{count} items"}</I18nKeylessText>);
      expect(screen.getByText("3 items")).toBeInTheDocument();
    });

    it("renders the source form, count filled, while the row is not there yet", () => {
      render(<I18nKeylessText count={1}>{"{count} items"}</I18nKeylessText>);
      expect(screen.getByText("1 items")).toBeInTheDocument();
    });

    it("picks the Russian category with Intl.PluralRules", () => {
      mockStore.setState({ currentLanguage: "ru", translations: { "{count} items": RU } });
      const { rerender } = render(<I18nKeylessText count={3}>{"{count} items"}</I18nKeylessText>);
      expect(screen.getByText("3 товара")).toBeInTheDocument();
      rerender(<I18nKeylessText count={5}>{"{count} items"}</I18nKeylessText>);
      expect(screen.getByText("5 товаров")).toBeInTheDocument();
      rerender(<I18nKeylessText count={21}>{"{count} items"}</I18nKeylessText>);
      expect(screen.getByText("21 товар")).toBeInTheDocument();
    });

    it("renders ordinals", () => {
      mockStore.setState({
        translations: { "You are {count}th": "You are {count, selectordinal, one {{count}st} two {{count}nd} few {{count}rd} other {{count}th}}" },
      });
      render(<I18nKeylessText count={22} ordinal>{"You are {count}th"}</I18nKeylessText>);
      expect(screen.getByText("You are 22nd")).toBeInTheDocument();
    });

    it("renders a select by value, and the other branch for a value the row never saw", () => {
      mockStore.setState({
        translations: { "He is online": "{gender, select, male {He is online} female {She is online} other {Online}}" },
      });
      const { rerender } = render(<I18nKeylessText select={{ gender: "female" }}>He is online</I18nKeylessText>);
      expect(screen.getByText("She is online")).toBeInTheDocument();
      rerender(<I18nKeylessText select={{ gender: "nonbinary" }}>He is online</I18nKeylessText>);
      expect(screen.getByText("Online")).toBeInTheDocument();
    });

    it("lets the caller's replace format the number", () => {
      mockStore.setState({ translations: { "{count} items": EN } });
      render(
        <I18nKeylessText count={1000} replace={{ "{count}": "1,000" }}>
          {"{count} items"}
        </I18nKeylessText>
      );
      expect(screen.getByText("1,000 items")).toBeInTheDocument();
    });
  });

  it("handles context-specific translations", () => {
    mockStore.setState({
      currentLanguage: "fr",
      translations: {
        Welcome__header: "Bienvenue",
      },
    });

    render(<I18nKeylessText context="header">Welcome</I18nKeylessText>);

    expect(screen.getByText("Bienvenue")).toBeInTheDocument();
  });

  it("logs debug information when debug is true", () => {
    render(<I18nKeylessText debug>Hello World</I18nKeylessText>);

    expect(console.log).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Hello World",
        sourceText: "Hello World",
        currentLanguage: "en",
      })
    );
  });

  it("handles force temporary translations", () => {
    const forceTemp = {
      fr: "Bonjour temporaire",
    };

    render(<I18nKeylessText forceTemporary={forceTemp}>Hello World</I18nKeylessText>);

    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("falls back to source text when translation is missing", () => {
    mockStore.setState({
      currentLanguage: "fr",
      translations: {}, // Empty translations
    });

    render(<I18nKeylessText>Hello World</I18nKeylessText>);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("handles multiple replacements in text", () => {
    render(
      <I18nKeylessText
        replace={{
          "{{name}}": "John",
          "{{age}}": "30",
        }}
      >
        {`{{name}} is {{age}} years old`}
      </I18nKeylessText>
    );

    expect(screen.getByText("John is 30 years old")).toBeInTheDocument();
  });

  it("renders UGC as-is when the current language is its origin language", () => {
    mockStore.setState({
      currentLanguage: "es",
      translations: {}, // no lookup needed: the text is already in the viewer's language
    });

    render(<I18nKeylessText originLanguage="es">Hola mundo</I18nKeylessText>);
    expect(screen.getByText("Hola mundo")).toBeInTheDocument();
  });

  it("looks up the UGC translation even when the current language is the primary language", () => {
    mockStore.setState({
      currentLanguage: "en", // primary
      translations: {
        "Hola mundo": "Hello world",
      },
    });

    render(<I18nKeylessText originLanguage="es">Hola mundo</I18nKeylessText>);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders the UGC translation for a third language", () => {
    mockStore.setState({
      currentLanguage: "fr",
      translations: {
        "Hola mundo": "Bonjour le monde",
      },
    });

    render(<I18nKeylessText originLanguage="es">Hola mundo</I18nKeylessText>);
    expect(screen.getByText("Bonjour le monde")).toBeInTheDocument();
  });

  it("treats originLanguage equal to the primary language as the regular flow", () => {
    mockStore.setState({
      currentLanguage: "en", // primary
      translations: {},
    });

    render(<I18nKeylessText originLanguage="en">Hello World</I18nKeylessText>);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("preserves special characters in replacements", () => {
    render(
      <I18nKeylessText
        replace={{
          "{{special}}": "$@#!",
        }}
      >
        {`Special chars: {{special}}`}
      </I18nKeylessText>
    );

    expect(screen.getByText("Special chars: $@#!")).toBeInTheDocument();
  });
});

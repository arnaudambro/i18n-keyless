import React from "react";
import { render, screen } from "@testing-library/react";
import { I18nKeylessText } from "../I18nKeylessText";
import { vi, beforeEach, describe, it, expect, afterEach } from "vitest";
import { getTranslationCore, type Lang } from "i18n-keyless-core";

// Create a mock store before vi.mock call using vi.hoisted
const mockStore = vi.hoisted(() => {
  const store = {
    config: null,
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
        languages: {
          primary: "en",
          supported: ["en", "fr"],
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
        children: "Hello World",
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

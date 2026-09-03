import React from "react";
import { act, render, screen } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import type { PrimaryLang, Lang } from "i18n-keyless-core";
import { useTranslation } from "../useTranslation";
import { I18nKeylessProvider } from "../I18nKeylessProvider";

// `useTranslation()` without a text: the function form. Same store mock as
// useTranslation.test.tsx; `getTranslation` is mocked so the SPA path is observable.
const mockStore = vi.hoisted(() => {
  const listeners = new Set<() => void>();
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
  const useI18nKeylessMock = (selectorOrStore: any) => {
    // A minimal external-store subscription so the hook re-renders on setState.
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
      listeners.add(force);
      return () => void listeners.delete(force);
    }, [force]);
    return typeof selectorOrStore === "function" ? selectorOrStore(store) : store;
  };
  useI18nKeylessMock.getState = vi.fn(() => store);
  useI18nKeylessMock.setState = vi.fn((newState) => {
    Object.assign(store, typeof newState === "function" ? newState(store) : newState);
    listeners.forEach((l) => l());
  });
  return useI18nKeylessMock;
});

const getTranslationMock = vi.hoisted(() => vi.fn((text: string) => `t:${text}`));

vi.mock("../store", async () => ({
  useI18nKeyless: mockStore,
  getTranslation: getTranslationMock,
}));

function Nav({ items, context }: { items: string[]; context?: string }) {
  const t = useTranslation(context ? { context } : undefined);
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{t(item)}</li>
      ))}
    </ul>
  );
}

beforeEach(() => {
  getTranslationMock.mockClear();
  mockStore.setState({ currentLanguage: "en", translations: {} });
});

describe("useTranslation() — the function form", () => {
  it("returns a t function usable inside a map, resolved through getTranslation", () => {
    render(<Nav items={["Dashboard", "Inbox"]} />);
    expect(screen.getByText("t:Dashboard")).toBeInTheDocument();
    expect(screen.getByText("t:Inbox")).toBeInTheDocument();
    expect(getTranslationMock).toHaveBeenCalledWith("Dashboard", {});
  });

  it("merges the hook options under each call's options, and trims the text", () => {
    function Row() {
      const t = useTranslation({ context: "nav", namespace: "chrome" });
      return <span>{t("  Inbox  ", { context: "mail" })}</span>;
    }
    render(<Row />);
    expect(getTranslationMock).toHaveBeenCalledWith("Inbox", { context: "mail", namespace: "chrome" });
  });

  it("re-renders when the language changes or a translation batch lands", () => {
    getTranslationMock.mockImplementation((text: string) =>
      mockStore.getState().currentLanguage === "en" ? text : (mockStore.getState().translations[text] ?? text)
    );
    render(<Nav items={["Dashboard"]} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();

    act(() => {
      mockStore.setState({ currentLanguage: "fr" });
    });
    expect(screen.getByText("Dashboard")).toBeInTheDocument();

    act(() => {
      mockStore.setState({ translations: { Dashboard: "Tableau de bord" } });
    });
    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
  });

  it("reads the <I18nKeylessProvider> scope instead of the store, like <T> does", () => {
    render(
      <I18nKeylessProvider lang="fr" translations={{ Dashboard: "Tableau de bord", Inbox__nav: "Boîte" }}>
        <Nav items={["Dashboard"]} />
        <Nav items={["Inbox"]} context="nav" />
      </I18nKeylessProvider>
    );
    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
    expect(screen.getByText("Boîte")).toBeInTheDocument();
    expect(getTranslationMock).not.toHaveBeenCalled();
  });

  it("keeps the string form untouched", () => {
    function Field() {
      const placeholder = useTranslation("Search");
      return <input placeholder={placeholder} />;
    }
    render(<Field />);
    expect(screen.getByPlaceholderText("Search")).toBeInTheDocument();
  });
});

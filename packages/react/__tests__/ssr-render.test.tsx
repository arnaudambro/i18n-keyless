import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { type Lang, type PrimaryLang } from "i18n-keyless-core";

// The REAL store and the REAL zustand: this file reproduces what `renderToString` does to
// a zustand selector, which the store mocks in the other files cannot show.
vi.mock("zustand", async () => vi.importActual("zustand"));

const { useI18nKeyless, useCurrentLanguage } = await import("../hooks");
const { createMemoryStorage } = await import("../utils");
const { I18nKeylessProvider } = await import("../I18nKeylessProvider");
const { I18nKeylessText } = await import("../I18nKeylessText");
const { useTranslation } = await import("../useTranslation");
const { runWithI18nKeyless } = await import("../request-scope");

function Placeholder({ text }: { text: string }) {
  return <input placeholder={useTranslation(text)} />;
}

/**
 * React hands `useSyncExternalStore` the *server snapshot* during `renderToString` (and
 * during hydration on the client). zustand implements that snapshot as `getInitialState()`
 * — the store's defaults, `primary: "fr"` — not the config `init()` set. A component that
 * read the config through a selector therefore thought a French request was a request for
 * the source language, and rendered the source text. This is the regression test.
 */
describe("server render (renderToString)", () => {
  beforeEach(() => {
    // What `init()` leaves in the store, minus the network: an English-primary project.
    useI18nKeyless.setState({
      config: {
        API_KEY: "any-key",
        languages: { primary: "en" as PrimaryLang, supported: ["en", "fr", "es"] as Lang[] },
        storage: createMemoryStorage(),
      },
      currentLanguage: "en",
      translations: {},
    });
  });

  it("renders French through the provider — the language equal to zustand's default primary", () => {
    const html = renderToString(
      <I18nKeylessProvider lang="fr" translations={{ Hello: "Bonjour" }}>
        <p>
          <I18nKeylessText>Hello</I18nKeylessText>
        </p>
        <Placeholder text="Hello" />
      </I18nKeylessProvider>
    );
    expect(html).toContain("<p>Bonjour</p>");
    expect(html).toContain('placeholder="Bonjour"');
  });

  it("renders Spanish through the provider", () => {
    const html = renderToString(
      <I18nKeylessProvider lang="es" translations={{ Hello: "Hola" }}>
        <I18nKeylessText>Hello</I18nKeylessText>
      </I18nKeylessProvider>
    );
    expect(html).toContain("Hola");
  });

  it("renders the source text when the provider language is the real primary", () => {
    const html = renderToString(
      <I18nKeylessProvider lang="en" translations={{ Hello: "SHOULD NOT SHOW" }}>
        <I18nKeylessText>Hello</I18nKeylessText>
      </I18nKeylessProvider>
    );
    expect(html).toContain("Hello");
    expect(html).not.toContain("SHOULD NOT SHOW");
  });

  it("gives every store selector the real state, not zustand's initial one", () => {
    function Primary() {
      return <span>{useI18nKeyless((s) => s.config.languages.primary)}</span>;
    }
    expect(renderToString(<Primary />)).toContain("<span>en</span>");
  });

  it("useCurrentLanguage is the provider's language on the server", () => {
    function Current() {
      return <span>{useCurrentLanguage()}</span>;
    }
    const html = renderToString(
      <I18nKeylessProvider lang="fr" translations={{}}>
        <Current />
      </I18nKeylessProvider>
    );
    expect(html).toContain("<span>fr</span>");
  });

  it("useCurrentLanguage is the provider's language on the client too, and the store's without one", () => {
    function Current() {
      return <span data-testid="lang">{useCurrentLanguage()}</span>;
    }
    const { unmount } = render(
      <I18nKeylessProvider lang="es" translations={{}}>
        <Current />
      </I18nKeylessProvider>
    );
    expect(screen.getByTestId("lang")).toHaveTextContent("es");
    unmount();
    useI18nKeyless.setState({ currentLanguage: "en" });
    render(<Current />);
    expect(screen.getByTestId("lang")).toHaveTextContent("en");
  });

  it("renders French through the request scope, without a provider", async () => {
    const html = await runWithI18nKeyless({ lang: "fr", translations: { Hello: "Bonjour" } }, async () =>
      renderToString(<I18nKeylessText>Hello</I18nKeylessText>)
    );
    expect(html).toContain("Bonjour");
  });

});

/**
 * Next.js App Router renders client components on the server in a second module graph (the
 * SSR layer), separate from the one where the page called `init()`. The store there is a
 * fresh instance: default config, no API key, primary "fr". A French request under a
 * `<I18nKeylessProvider lang="fr">` therefore rendered the English source text, because the
 * hooks compared the request language with the *store's* primary. The provider now carries
 * the primary itself. This is the regression test: nothing initialises the store.
 */
describe("server render on a store that never ran init() (Next's SSR module graph)", () => {
  function Labels() {
    const t = useTranslation();
    return <span>{t("Hello")}</span>;
  }

  beforeEach(() => {
    useI18nKeyless.setState(useI18nKeyless.getInitialState(), true);
  });

  it("renders French for an English-primary app when the provider carries the primary", () => {
    const html = renderToString(
      <I18nKeylessProvider lang="fr" primary="en" translations={{ Hello: "Bonjour" }}>
        <p>
          <I18nKeylessText>Hello</I18nKeylessText>
        </p>
        <Placeholder text="Hello" />
        <Labels />
      </I18nKeylessProvider>
    );
    expect(html).toContain("<p>Bonjour</p>");
    expect(html).toContain('placeholder="Bonjour"');
    expect(html).toContain("<span>Bonjour</span>");
  });

  it("renders the source text when the request language is the provider's primary", () => {
    const html = renderToString(
      <I18nKeylessProvider lang="en" primary="en" translations={{ Hello: "SHOULD NOT SHOW" }}>
        <I18nKeylessText>Hello</I18nKeylessText>
        <Labels />
      </I18nKeylessProvider>
    );
    expect(html).toContain("Hello");
    expect(html).not.toContain("SHOULD NOT SHOW");
  });

  it("without `primary`, falls back to the store's default and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = renderToString(
      <I18nKeylessProvider lang="de" translations={{ Hello: "Hallo" }}>
        <I18nKeylessText>Hello</I18nKeylessText>
      </I18nKeylessProvider>
    );
    expect(html).toContain("Hallo");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("primary");
    renderToString(
      <I18nKeylessProvider lang="de" translations={{}}>
        <I18nKeylessText>Hello</I18nKeylessText>
      </I18nKeylessProvider>
    );
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

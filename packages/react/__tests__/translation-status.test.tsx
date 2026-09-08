import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
vi.unmock("zustand");

import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import type { I18nKeylessResponse, PrimaryLang, Lang } from "i18n-keyless-core";
import { useI18nKeyless } from "../hooks.ts";
import { I18nKeylessText as T } from "../I18nKeylessText.tsx";
import { useTranslationStatus } from "../useTranslation.ts";
import { getTranslationStatus, getTranslation } from "../store.ts";
import { createMemoryStorage } from "../utils.ts";
import { runWithI18nKeyless } from "../request-scope.ts";

// This suite uses the REAL store, the REAL zustand and the REAL queue (like
// __tests__/render-count.test.tsx): the pending -> ready lifecycle is exactly what
// `translateKey` and the `queue.on("empty")` handler in store.ts drive, and a mocked
// `getTranslation` (as in useTranslation.test.tsx) would never mark anything pending.

function okResponse(translations: Record<string, string>): I18nKeylessResponse {
  return { ok: true, data: { translations } } as I18nKeylessResponse;
}

/** A project with primary "en" — every case here is deliberately primary en / target fr, per
 * CLAUDE.md's "keep a suite with the primary en and the target language fr" rule. */
function seedStore(overrides: Record<string, unknown> = {}) {
  useI18nKeyless.setState({
    config: {
      API_KEY: "test-key",
      storage: createMemoryStorage(),
      languages: { primary: "en" as PrimaryLang, supported: ["en", "fr"] as Lang[], fallback: "en", initWithDefault: "en" },
      handleTranslate: vi.fn(async () => okResponse({})),
      getAllTranslations: vi.fn(async () => okResponse({})),
      sendTranslationsUsage: vi.fn(async () => undefined),
    },
    currentLanguage: "en",
    translations: {},
    translationsByNamespace: {},
    namespaces: [],
    unpersistedNamespaces: [],
    lastRefreshByNamespace: {},
    translationsUsageByNamespace: {},
    ...overrides,
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useTranslationStatus", () => {
  beforeEach(() => {
    seedStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is ready in the key's own language (primary en), nothing queued", async () => {
    function Probe() {
      const { status, text } = useTranslationStatus("Hello");
      return <span data-testid="status">{`${status}:${text}`}</span>;
    }
    render(<Probe />);
    await settle();
    expect(screen.getByTestId("status")).toHaveTextContent("ready:Hello");
    expect(useI18nKeyless.getState().config.handleTranslate).not.toHaveBeenCalled();
  });

  it("flips pending -> ready when the fetch merges (primary en, target fr)", async () => {
    let resolveTranslate: (v: I18nKeylessResponse) => void = () => {};
    let resolveAll: (v: I18nKeylessResponse) => void = () => {};
    seedStore({
      currentLanguage: "fr",
      config: {
        ...useI18nKeyless.getState().config,
        handleTranslate: vi.fn(
          () =>
            new Promise<I18nKeylessResponse>((resolve) => {
              resolveTranslate = resolve;
            })
        ),
        getAllTranslations: vi.fn(
          () =>
            new Promise<I18nKeylessResponse>((resolve) => {
              resolveAll = resolve;
            })
        ),
      },
    });

    function Probe() {
      const { status, text } = useTranslationStatus("Hello");
      return <span data-testid="status">{`${status}:${text}`}</span>;
    }
    render(<Probe />);

    // Missing cell, translate-on-miss queued by the mount effect: pending, source text meanwhile.
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("pending:Hello"));

    // The POST resolves; the row itself only lands via the bulk fetch the queue's "empty"
    // handler triggers next, so the status is still pending.
    await act(async () => {
      resolveTranslate(okResponse({}));
    });
    await settle();
    expect(screen.getByTestId("status")).toHaveTextContent("pending:Hello");

    // The bulk fetch resolves with the row: `settlePendingTranslationsAfter`'s returned
    // settle() runs right after `setTranslations`, so status flips to ready in the same batch.
    await act(async () => {
      resolveAll(okResponse({ Hello: "Bonjour" }));
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready:Bonjour"));
  });

  it("becomes unavailable — not stuck pending — after a settle that did not bring the cell", async () => {
    let resolveTranslate: (v: I18nKeylessResponse) => void = () => {};
    seedStore({
      currentLanguage: "fr",
      config: {
        ...useI18nKeyless.getState().config,
        handleTranslate: vi.fn(
          () =>
            new Promise<I18nKeylessResponse>((resolve) => {
              resolveTranslate = resolve;
            })
        ),
        // The bulk fetch itself fails (network down): getAllTranslationsFromLanguage catches
        // and resolves `void`, and the react store's `.then` still calls `settle()`.
        getAllTranslations: vi.fn(async () => {
          throw new Error("network down");
        }),
      },
    });

    function Probe() {
      const { status } = useTranslationStatus("Hello");
      return <span data-testid="status">{status}</span>;
    }
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("pending"));

    await act(async () => {
      resolveTranslate(okResponse({}));
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unavailable"));
  });

  it("re-renders only the key whose pending flag actually flipped, not an unrelated one", async () => {
    seedStore({
      currentLanguage: "fr",
      translations: { Hi: "Salut" }, // already translated: never queued, never pending
      config: {
        ...useI18nKeyless.getState().config,
        handleTranslate: vi.fn(async () => okResponse({})),
        // Never resolves: "Hello" stays pending for the whole assertion window instead of
        // racing straight through to "unavailable".
        getAllTranslations: vi.fn(() => new Promise<I18nKeylessResponse>(() => {})),
      },
    });
    const renders: string[] = [];
    function Probe({ label, text }: { label: string; text: string }) {
      const { status } = useTranslationStatus(text);
      renders.push(label);
      return <span data-testid={label}>{status}</span>;
    }
    render(
      <>
        <Probe label="settled" text="Hi" />
        <Probe label="missing" text="Hello" />
      </>
    );
    await waitFor(() => expect(screen.getByTestId("missing")).toHaveTextContent("pending"));
    const settledRendersAfterMissingFlips = renders.filter((l) => l === "settled").length;
    // "Hi" already had a cell and was never marked pending: its own pending flag never
    // flipped, so its subscription must not have re-rendered it because "Hello" flipped.
    expect(settledRendersAfterMissingFlips).toBe(1);
  });
});

describe("getTranslationStatus — plain, non-reactive, no side effect", () => {
  beforeEach(() => {
    seedStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is ready in the primary language", () => {
    expect(getTranslationStatus("Hello")).toBe("ready");
  });

  it("is unavailable for a missing cell, and never queues a translation itself", async () => {
    seedStore({ currentLanguage: "fr" });
    expect(getTranslationStatus("Hello")).toBe("unavailable");
    await settle();
    expect(useI18nKeyless.getState().config.handleTranslate).not.toHaveBeenCalled();
  });

  it("is pending once getTranslation queued the same key", () => {
    seedStore({ currentLanguage: "fr" });
    // `markTranslationPending` runs synchronously inside `translateKey`, so the pending
    // flag is already set the instant `getTranslation` returns — no microtask flush needed
    // (only the reactive *notification* to subscribers is deferred, not the state itself).
    getTranslation("Hello");
    expect(getTranslationStatus("Hello")).toBe("pending");
  });

  it("resolves under the AsyncLocalStorage request scope, like getTranslation", async () => {
    const status = await runWithI18nKeyless({ lang: "fr", translations: { Hello: "Bonjour" } }, async () =>
      getTranslationStatus("Hello")
    );
    expect(status).toBe("ready");
  });
});

describe("<I18nKeylessText pending>", () => {
  beforeEach(() => {
    seedStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the text as before when no pending placeholder is given", async () => {
    seedStore({ currentLanguage: "fr" });
    render(<T>Hello</T>);
    await settle();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders the pending placeholder while queued, then the translation once it lands", async () => {
    let resolveTranslate: (v: I18nKeylessResponse) => void = () => {};
    let resolveAll: (v: I18nKeylessResponse) => void = () => {};
    seedStore({
      currentLanguage: "fr",
      config: {
        ...useI18nKeyless.getState().config,
        handleTranslate: vi.fn(
          () =>
            new Promise<I18nKeylessResponse>((resolve) => {
              resolveTranslate = resolve;
            })
        ),
        getAllTranslations: vi.fn(
          () =>
            new Promise<I18nKeylessResponse>((resolve) => {
              resolveAll = resolve;
            })
        ),
      },
    });

    render(<T pending="Translating…">Hello</T>);
    await waitFor(() => expect(screen.getByText("Translating…")).toBeInTheDocument());

    await act(async () => {
      resolveTranslate(okResponse({}));
    });
    await act(async () => {
      resolveAll(okResponse({ Hello: "Bonjour" }));
    });
    await waitFor(() => expect(screen.getByText("Bonjour")).toBeInTheDocument());
    expect(screen.queryByText("Translating…")).not.toBeInTheDocument();
  });

  it("accepts a function form, called with the trimmed source text", async () => {
    seedStore({
      currentLanguage: "fr",
      config: {
        ...useI18nKeyless.getState().config,
        handleTranslate: vi.fn(async () => okResponse({})),
        // Never resolves: the bulk fetch stays in flight, so the status stays pending —
        // deterministic for this assertion.
        getAllTranslations: vi.fn(() => new Promise<I18nKeylessResponse>(() => {})),
      },
    });
    render(<T pending={(sourceText) => `Translating "${sourceText}"…`}> Hello </T>);
    await waitFor(() => expect(screen.getByText('Translating "Hello"…')).toBeInTheDocument());
  });
});

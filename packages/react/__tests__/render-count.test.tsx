import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
vi.unmock("zustand");

import React from "react";
import { render, act } from "@testing-library/react";
import { useI18nKeyless } from "../hooks.ts";
import { I18nKeylessText as T } from "../I18nKeylessText.tsx";
import { createMemoryStorage } from "../utils.ts";
import type { I18nKeylessResponse } from "i18n-keyless-core";

/**
 * How many <T> components a page has. Real landing pages sit in this range.
 */
const PAGE_SIZE = 50;

/** Renders per <T>, keyed by the source text. */
const renders = new Map<string, number>();

/**
 * Counts commits of the <T> subtree. The counter cannot live in a wrapper component:
 * <T> subscribes to the store itself, so it re-renders without its parent re-rendering.
 * React.Profiler fires once per commit of the subtree it wraps, which is exactly one
 * <T> render.
 */
function CountedText({ children, namespace }: { children: string; namespace?: string }) {
  return (
    <React.Profiler id={children} onRender={(id) => renders.set(id, (renders.get(id) ?? 0) + 1)}>
      <T namespace={namespace}>{children}</T>
    </React.Profiler>
  );
}

function totalRenders() {
  let total = 0;
  for (const n of renders.values()) {
    total += n;
  }
  return total;
}

const appKeys = Array.from({ length: PAGE_SIZE }, (_, i) => `Texte numéro ${i}`);

function okResponse(translations: Record<string, string>): I18nKeylessResponse {
  return { ok: true, data: { translations } } as I18nKeylessResponse;
}

function seedStore(translations: Record<string, string>) {
  useI18nKeyless.setState({
    config: {
      API_KEY: "test-key",
      storage: createMemoryStorage(),
      languages: { primary: "fr", supported: ["fr", "en"], fallback: "fr", initWithDefault: "fr" },
      // Custom handlers: never touch the network from a test. They must return a
      // well-formed response, otherwise the queue's bulk fetch logs a parse error.
      handleTranslate: vi.fn(async () => okResponse({})),
      getAllTranslations: vi.fn(async () => okResponse({})),
      sendTranslationsUsage: vi.fn(async () => undefined),
    },
    currentLanguage: "en",
    translations,
    translationsByNamespace: {},
    namespaces: [],
    unpersistedNamespaces: [],
    lastRefreshByNamespace: {},
    translationsUsageByNamespace: {},
  });
}

/** Flush the queueMicrotask that getTranslation uses for deferred usage writes. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("<T> re-render cost when a translation batch lands", () => {
  beforeEach(() => {
    renders.clear();
    // <T> queues a translateKey per mounted key; when that queue drains it bulk-fetches.
    // That drain can land after the test finished, once the seeded config is gone, and
    // then it falls through to a real HTTP call. Stub fetch so no test escapes to the
    // network. The assertions never depend on it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(okResponse({})), { headers: { "content-type": "application/json" } }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a batch for ANOTHER namespace re-renders nothing on this page", async () => {
    seedStore(Object.fromEntries(appKeys.map((k) => [k, `EN ${k}`])));

    render(
      <>
        {appKeys.map((k) => (
          <CountedText key={k} namespace="app">
            {k}
          </CountedText>
        ))}
      </>
    );
    await settle();
    const afterMount = totalRenders();

    // A discussion / checkout / UGC namespace finishes translating. Not one key on this
    // page changes. Before v3.1.0, <T> selected the whole `translations` map, which
    // setTranslations replaces with a new object — so all 50 re-rendered for nothing.
    await act(async () => {
      useI18nKeyless.getState().setTranslations(okResponse({ "Bonjour, ça va ?": "Hi, how are you?" }), "chat");
    });
    await settle();

    const caused = totalRenders() - afterMount;
    // eslint-disable-next-line no-console
    console.log(`[cross-namespace] mount=${afterMount} re-renders caused by the chat batch=${caused}`);
    expect(caused).toBe(0);
  });

  it("a batch adding ONE key re-renders only the <T> that changed", async () => {
    // All keys translated except the last one.
    seedStore(Object.fromEntries(appKeys.slice(0, -1).map((k) => [k, `EN ${k}`])));
    const missing = appKeys[appKeys.length - 1];

    render(
      <>
        {appKeys.map((k) => (
          <CountedText key={k} namespace="app">
            {k}
          </CountedText>
        ))}
      </>
    );
    await settle();
    const afterMount = totalRenders();

    await act(async () => {
      useI18nKeyless.getState().setTranslations(okResponse({ [missing]: `EN ${missing}` }), "app");
    });
    await settle();

    const caused = totalRenders() - afterMount;
    // eslint-disable-next-line no-console
    console.log(`[one-new-key] mount=${afterMount} re-renders caused by 1 new key=${caused}`);
    // Exactly one: the <T> whose translation just arrived. Was PAGE_SIZE before v3.1.0.
    expect(caused).toBe(1);
    expect(renders.get(missing)).toBe(2); // mount + the arrival
  });

  it("a language switch re-renders every <T> (this one is legitimate)", async () => {
    seedStore(Object.fromEntries(appKeys.map((k) => [k, `EN ${k}`])));

    render(
      <>
        {appKeys.map((k) => (
          <CountedText key={k} namespace="app">
            {k}
          </CountedText>
        ))}
      </>
    );
    await settle();
    const afterMount = totalRenders();

    await act(async () => {
      useI18nKeyless.setState({ currentLanguage: "fr" });
    });
    await settle();

    const caused = totalRenders() - afterMount;
    // eslint-disable-next-line no-console
    console.log(`[language switch] mount=${afterMount} re-renders=${caused}`);
    expect(caused).toBe(PAGE_SIZE);
  });
});

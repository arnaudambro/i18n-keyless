import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  markTranslationPending,
  isTranslationPending,
  settlePendingTranslationsAfter,
  subscribeToPendingTranslations,
  resetPendingTranslations,
  resolveTranslationStatus,
  getTranslationStatusCore,
} from "../translation-status.ts";
import { translateKey } from "../service.ts";
import { api } from "../api.ts";
import { setSdkRuntime, resetUniqueIdState } from "../unique-id.ts";
import { makeStore, okResponse } from "./helpers.ts";

const flush = () => new Promise((r) => setTimeout(r, 10));
const microtask = () => Promise.resolve();
/** Two microtask turns: the notify's own `queueMicrotask` plus this promise's own `.then`. */
const flushMicrotasks = async () => {
  await microtask();
  await microtask();
};

beforeEach(() => {
  resetPendingTranslations();
  resetUniqueIdState();
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  resetPendingTranslations();
  resetUniqueIdState();
  vi.restoreAllMocks();
});

describe("mark / is / settle lifecycle", () => {
  it("is not pending before it is marked", () => {
    expect(isTranslationPending("default", "Bonjour")).toBe(false);
  });

  it("is pending once marked", () => {
    markTranslationPending("default", "Bonjour");
    expect(isTranslationPending("default", "Bonjour")).toBe(true);
  });

  it("settling deletes exactly the ids snapshotted for that namespace, other namespaces untouched", () => {
    markTranslationPending("default", "Bonjour");
    markTranslationPending("checkout", "Pay");
    const settle = settlePendingTranslationsAfter("default");
    settle();
    expect(isTranslationPending("default", "Bonjour")).toBe(false);
    expect(isTranslationPending("checkout", "Pay")).toBe(true);
  });

  it("a key marked pending AFTER the snapshot survives the settle", () => {
    markTranslationPending("default", "Bonjour");
    const settle = settlePendingTranslationsAfter("default");
    // Queued while the fetch the snapshot is guarding is still in flight.
    markTranslationPending("default", "Au revoir");
    settle();
    expect(isTranslationPending("default", "Bonjour")).toBe(false);
    expect(isTranslationPending("default", "Au revoir")).toBe(true);
  });

  it("settling an empty snapshot is a no-op", () => {
    const settle = settlePendingTranslationsAfter("default");
    expect(() => settle()).not.toThrow();
  });

  it("resetPendingTranslations clears the whole set", () => {
    markTranslationPending("default", "Bonjour");
    resetPendingTranslations();
    expect(isTranslationPending("default", "Bonjour")).toBe(false);
  });
});

describe("subscribeToPendingTranslations — microtask batching", () => {
  // `resetPendingTranslations()` keeps the listeners (a store subscribes once at module
  // load), so each test drops its own.
  const unsubscribers: Array<() => void> = [];
  const subscribe = (listener: () => void) => {
    const unsubscribe = subscribeToPendingTranslations(listener);
    unsubscribers.push(unsubscribe);
    return unsubscribe;
  };
  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  });

  it("a reset keeps the listeners", async () => {
    const listener = vi.fn();
    subscribe(listener);
    resetPendingTranslations();
    markTranslationPending("default", "A");
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies in a microtask, once per batch of synchronous marks", async () => {
    const listener = vi.fn();
    subscribe(listener);
    markTranslationPending("default", "A");
    markTranslationPending("default", "B");
    markTranslationPending("default", "C");
    expect(listener).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies again for a later batch, including a settle", async () => {
    const listener = vi.fn();
    subscribe(listener);
    markTranslationPending("default", "A");
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);

    settlePendingTranslationsAfter("default")();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("settling an empty snapshot does not notify", async () => {
    const listener = vi.fn();
    subscribe(listener);
    settlePendingTranslationsAfter("default")();
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPendingTranslations(listener);
    unsubscribe();
    markTranslationPending("default", "A");
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("resolveTranslationStatus — the rule table", () => {
  const base: Parameters<typeof resolveTranslationStatus>[0] = {
    translation: undefined,
    currentLanguage: "en",
    primary: "en",
    pending: false,
    initialized: true,
  };
  const resolve = (overrides: Partial<typeof base>) => resolveTranslationStatus({ ...base, ...overrides });

  it("rule 1: the viewer reads the key's own language, no count/select → ready", () => {
    expect(resolve({})).toBe("ready");
  });

  it("rule 1 holds for a primary other than the SDK default (en primary, viewed in en)", () => {
    // `primary` here stands for the resolved source language, whatever the project's own
    // primary is — the resolver never hardcodes "fr".
    expect(resolve({ currentLanguage: "fr", primary: "fr" })).toBe("ready");
  });

  it("rule 1 does not apply once count/select is requested, even in the source language", () => {
    expect(resolve({ options: { count: 1 }, pending: true })).toBe("pending");
  });

  it("rule 2: a usable cell in another language is ready", () => {
    expect(resolve({ currentLanguage: "fr", translation: "Bonjour" })).toBe("ready");
  });

  it("rule 2: count without the ICU cell is NOT ready", () => {
    const status = resolve({
      currentLanguage: "fr",
      translation: "3 articles", // plain text, no ICU plural block yet
      options: { count: 3 },
      pending: true,
    });
    expect(status).toBe("pending");
  });

  it("rule 2: a forceTemporary key with a cell present is ready", () => {
    expect(
      resolve({
        currentLanguage: "fr",
        translation: "MINE",
        options: { forceTemporary: { fr: "MINE" } },
      }),
    ).toBe("ready");
  });

  it("rule 3: never initialized is unavailable, even when pending", () => {
    expect(resolve({ currentLanguage: "fr", initialized: false, pending: true })).toBe("unavailable");
  });

  it("rule 4: a server runtime is never pending", () => {
    setSdkRuntime("node");
    expect(resolve({ currentLanguage: "fr", pending: true })).toBe("unavailable");
  });

  it("rule 5: queued and not yet settled is pending", () => {
    expect(resolve({ currentLanguage: "fr", pending: true })).toBe("pending");
  });

  it("rule 6: nothing usable, nothing pending → unavailable", () => {
    expect(resolve({ currentLanguage: "fr" })).toBe("unavailable");
  });
});

describe("getTranslationStatusCore — store-based, no side effect", () => {
  it("is ready in the key's own origin language (UGC), no lookup needed", () => {
    const store = makeStore({ currentLanguage: "es" });
    expect(getTranslationStatusCore("Hola mundo", store, { originLanguage: "es" })).toBe("ready");
  });

  it("looks up UGC in the primary language too, like getTranslationCore does", () => {
    const store = makeStore({
      currentLanguage: "fr",
      translations: { "Hola mundo": "Bonjour le monde" },
    });
    expect(getTranslationStatusCore("Hola mundo", store, { originLanguage: "es" })).toBe("ready");
  });

  it("is unavailable, then pending, once translateKey actually queues UGC in a third language", () => {
    vi.spyOn(api, "fetchTranslation").mockImplementation(() => new Promise(() => {}));
    const store = makeStore({ currentLanguage: "en", translations: {} });
    expect(getTranslationStatusCore("Hola mundo", store, { originLanguage: "es" })).toBe("unavailable");
    translateKey("Hola mundo", store, { originLanguage: "es" });
    expect(getTranslationStatusCore("Hola mundo", store, { originLanguage: "es" })).toBe("pending");
  });

  it("primary en, target fr: ready in the primary language even if the map holds a stray value", () => {
    const store = makeStore({
      config: { API_KEY: "test-key", languages: { primary: "en", supported: ["en", "fr"] } },
      currentLanguage: "en",
      translations: { Hello: "SHOULD NOT MATTER" },
    });
    expect(getTranslationStatusCore("Hello", store)).toBe("ready");
  });

  it("never queues a translation itself, even when the status is unavailable", async () => {
    const spy = vi.spyOn(api, "fetchTranslation");
    const store = makeStore({ currentLanguage: "en", translations: {} });
    expect(getTranslationStatusCore("Bonjour", store)).toBe("unavailable");
    getTranslationStatusCore("Bonjour", store);
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it("is unavailable without an API key", () => {
    const store = makeStore({ currentLanguage: "en" });
    store.config.API_KEY = "";
    expect(getTranslationStatusCore("Bonjour", store)).toBe("unavailable");
  });
});

describe("translateKey marks the pending id exactly when it queues", () => {
  it("marks pending when a task is actually queued", async () => {
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    const store = makeStore({ translations: {} });
    expect(isTranslationPending("default", "Bonjour")).toBe(false);
    translateKey("Bonjour", store);
    expect(isTranslationPending("default", "Bonjour")).toBe(true);
    await flush();
  });

  it("does not mark pending when the key is skipped (already translated, no forceTemporary)", async () => {
    const spy = vi.spyOn(api, "fetchTranslation");
    const store = makeStore({ translations: { Bonjour: "Hello" } });
    translateKey("Bonjour", store);
    await flush();
    expect(spy).not.toHaveBeenCalled();
    expect(isTranslationPending("default", "Bonjour")).toBe(false);
  });

  it("does not mark pending for an empty key", () => {
    const store = makeStore();
    translateKey("", store);
    expect(isTranslationPending("default", "")).toBe(false);
  });

  it("marks pending under the call's own namespace, not the default one", () => {
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    const store = makeStore({ translations: {} });
    translateKey("Bonjour", store, { namespace: "checkout" });
    expect(isTranslationPending("checkout", "Bonjour")).toBe(true);
    expect(isTranslationPending("default", "Bonjour")).toBe(false);
  });

  it("marks pending again when forceTemporary re-queues an already-translated key", () => {
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    const store = makeStore({ translations: { Bonjour: "Hello" } });
    translateKey("Bonjour", store, { forceTemporary: { en: "MINE" } });
    expect(isTranslationPending("default", "Bonjour")).toBe(true);
  });
});

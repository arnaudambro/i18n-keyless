import { vi } from "vitest";
import { Input, type Type } from "@angular/core";
import type { ComponentFixture } from "@angular/core/testing";
import { resetUniqueIdState } from "i18n-keyless-core";
import { resetStoreForTests } from "../store.ts";
import { I18nKeylessTextComponent } from "../text.component.ts";
import type { I18nConfig } from "../types.ts";

/**
 * JIT cannot see `input()` signal inputs by itself: the Angular CLI rewrites them into
 * `@Input({ isSignal: true })` metadata with a TypeScript transform before JIT compiles a
 * class, and vitest does not run that transform. This registers the same metadata the
 * transform would, through the real `Input` decorator factory, before the first compile.
 * AOT (ngtsc) reads the `input()` initializers directly and needs nothing.
 *
 * A signal input missing from this list fails loudly (NG0303 "Can't bind to ...").
 */
function declareSignalInputsForJit(type: Type<unknown>, fields: string[]): void {
  for (const field of fields) {
    // `isSignal` is not part of the public `Input` type: it is what the CLI transform emits.
    (Input as unknown as (meta: object) => PropertyDecorator)({ isSignal: true, alias: field, required: false })(
      type.prototype,
      field
    );
  }
}

declareSignalInputsForJit(I18nKeylessTextComponent, [
  "context",
  "replace",
  "namespace",
  "unpersistedNamespace",
  "debug",
  "forceTemporary",
  "originLanguage",
]);

/** English translations of the French source strings used across the suites. */
export const EN: Record<string, string> = {
  Bonjour: "Hello",
  "Bonjour {name}": "Hello {name}",
  "8 heures__heure": "8 AM",
  "8 heures__durée": "8 hours",
  "Changer de langue": "Switch language",
};

export const ES: Record<string, string> = {
  Bonjour: "Hola",
  "Changer de langue": "Cambiar de idioma",
};

const DICTIONARIES: Record<string, Record<string, string>> = { en: EN, es: ES };

export type FetchCall = { url: string; method: string; body: unknown };

/**
 * A `fetch` double speaking the i18n-keyless protocol: `GET /translate/:lang` answers the
 * canned dictionary, `POST /translate` acknowledges, the usage sink acknowledges. Every
 * call is recorded so a test can assert what left the SDK.
 */
export function mockFetch(dictionaries: Record<string, Record<string, string>> = DICTIONARIES) {
  const calls: FetchCall[] = [];
  const json = (body: unknown, status = 200) => ({
    status,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => body,
  });
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const { pathname } = new URL(url);
    if (method === "POST" && pathname === "/translate/last-used-translations") {
      return json({ ok: true, message: "" });
    }
    if (method === "POST" && pathname === "/translate") {
      return json({ ok: true, data: { translation: {} }, error: "", message: "" });
    }
    const single = pathname.match(/^\/translate\/([a-zA-Z-]+)$/);
    if (method === "GET" && single) {
      return json({
        ok: true,
        data: { translations: dictionaries[single[1]] ?? {}, uniqueId: "srv-id", lastRefresh: "2025-01-01" },
        error: "",
        message: "",
      });
    }
    return json({ ok: false, error: "not found", message: "" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    fetchMock,
    /** The recorded calls to one path, e.g. `"/translate/last-used-translations"`. */
    to: (path: string) => calls.filter((call) => new URL(call.url).pathname === path),
  };
}

export function makeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
}

export function baseConfig(extra: Partial<I18nConfig> = {}): I18nConfig {
  return {
    API_KEY: "test-key",
    API_URL: "http://i18n.test",
    languages: { primary: "fr", supported: ["fr", "en", "es"] },
    storage: makeStorage(),
    ...extra,
  };
}

/** Resets every module-level singleton the store and the core keep between tests. */
export function resetAll() {
  resetStoreForTests();
  resetUniqueIdState();
  vi.unstubAllGlobals();
}

/** Lets pending microtasks and macrotasks (the store's fire-and-forget fetches) settle. */
export async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * The text `<i18n-t>` renders: its last child node. The first child is the hidden span
 * that keeps the projected source.
 */
export function renderedText(fixture: ComponentFixture<unknown>, selector = "i18n-t"): string {
  const element = (fixture.nativeElement as HTMLElement).querySelector(selector);
  if (!element) {
    throw new Error(`no <${selector}> in the fixture`);
  }
  return element.lastChild?.textContent ?? "";
}

/** The text of the hidden source span inside `<i18n-t>`. */
export function sourceText(fixture: ComponentFixture<unknown>, selector = "i18n-t"): string {
  const element = (fixture.nativeElement as HTMLElement).querySelector(selector);
  return element?.firstChild?.textContent ?? "";
}

/**
 * Runs `fn` with `window` undefined (what the store's `isServerEnv()` sees on a server),
 * then restores it. Unlike `vi.stubGlobal` + `vi.unstubAllGlobals`, it leaves every other
 * stub (the `fetch` mock) in place.
 */
export async function withoutWindow<R>(fn: () => R | Promise<R>): Promise<R> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: undefined });
  try {
    return await fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
}

import { vi } from "vitest";
import type { I18nConfig, StorageAdapter } from "../types.ts";

export function makeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
}

export const okResponse = (translations: Record<string, string> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "111" },
  error: "",
  message: "",
});

export type FetchCall = { url: string; method: string; body?: Record<string, unknown> };

/**
 * A `fetch` that speaks the i18n-keyless protocol: `GET /translate/:lang` answers from
 * `translationsByLang`, both POSTs answer `ok`. Every call is recorded in `calls`.
 */
export function mockFetch(translationsByLang: Record<string, Record<string, string>> = {}) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, options: RequestInit = {}) => {
    const method = options.method ?? "GET";
    const body = options.body ? (JSON.parse(options.body as string) as Record<string, unknown>) : undefined;
    calls.push({ url, method, body });
    let payload: unknown;
    if (method === "POST" && url.endsWith("/translate/last-used-translations")) {
      payload = { ok: true, message: "" };
    } else if (method === "POST" && url.endsWith("/translate")) {
      payload = { ok: true, data: { translation: {} }, message: "" };
    } else {
      const lang = url.match(/\/translate\/([^/?]+)/)?.[1] ?? "";
      payload = okResponse(translationsByLang[lang] ?? {});
    }
    return {
      status: 200,
      ok: true,
      json: async () => payload,
      headers: { get: () => null },
    };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
}

/** Lets the pending promises (storage reads, queue tasks, fetches) settle. */
export async function flush(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export const baseConfig = (storage?: StorageAdapter, extra: Partial<I18nConfig> = {}): I18nConfig => ({
  API_KEY: "k",
  languages: { primary: "fr", supported: ["fr", "en"] },
  storage,
  ...extra,
});

export function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

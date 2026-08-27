import { vi } from "vitest";
import type { Lang } from "i18n-keyless-core";

export type FetchCall = { url: string; method: string; body?: Record<string, unknown> };

/**
 * A `fetch` double that speaks the i18n-keyless protocol:
 *  - GET  /translate/:lang                     -> the canned map for that language
 *  - POST /translate                           -> ok (the miss is "translated")
 *  - POST /translate/last-used-translations    -> ok (usage sink)
 */
export function mockFetch(translationsByLang: Record<string, Record<string, string>> = {}) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: string | URL, options: RequestInit = {}) => {
    const url = String(input);
    const method = options.method ?? "GET";
    calls.push({ url, method, body: options.body ? JSON.parse(String(options.body)) : undefined });
    let json: unknown;
    if (url.includes("/translate/last-used-translations")) {
      json = { ok: true, message: "" };
    } else if (method === "POST") {
      json = { ok: true, data: { translation: {} }, message: "" };
    } else {
      const lang = new URL(url).pathname.split("/").pop() as string;
      json = {
        ok: true,
        data: { translations: translationsByLang[lang] ?? {}, uniqueId: "server-minted-id", lastRefresh: "2025-01-01" },
        message: "",
      };
    }
    return { status: 200, headers: { get: () => null }, json: async () => json };
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
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

/** A fresh copy of the package (the store is module state) plus the core it links to. */
export async function load() {
  vi.resetModules();
  const lib = await import("../index.ts");
  const core = await import("i18n-keyless-core");
  core.resetUniqueIdState();
  return { ...lib, core };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

export const baseConfig = (storage: unknown, extra: Record<string, unknown> = {}) => ({
  API_KEY: "test-api-key",
  API_URL: "http://localhost:8787",
  languages: { primary: "fr" as Lang, supported: ["fr", "en", "es"] as Lang[] },
  storage,
  ...extra,
});

/**
 * Replays the language-neutral conformance vectors (conformance/vectors/*.json) against the
 * TypeScript core. Every port of i18n-keyless replays the same files; this suite is what
 * keeps the reference implementation and the vectors in agreement. See docs/PROTOCOL.md.
 *
 * Nothing here re-implements a rule: every assertion runs the real core function.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getTranslationCore,
  translateKey,
  getAllTranslationsFromLanguage,
  sendTranslationsUsageToI18nKeyless,
  getNamespacesToFetchAfterTranslationFinished,
  resolveNamespace,
  resolveOriginLanguage,
  storageKeyFor,
  queueIdFor,
  applyReplace,
  buildDictionaryUrl,
  etagCacheKey,
  DEFAULT_API_URL,
} from "../service.ts";
import { api, TIMEOUT_MS, RETRY_DELAYS_MS, MAX_ATTEMPTS, isRetryableStatus, httpErrorMessage } from "../api.ts";
import {
  AVAILABLE_LANGS,
  APP_STORE_LOCALES,
  DEFAULT_NAMESPACE,
  resolveLang,
  toAppStoreLocale,
  type Lang,
  type FetchTranslationParams,
} from "../types.ts";
import {
  generateUniqueId,
  isUniqueId,
  identityHeaders,
  resolveSdkRuntime,
  isServerRuntime,
  isUsageReportingEnabled,
  setSdkRuntime,
  resetUniqueIdState,
  UNIQUE_ID_ALPHABET,
  UNIQUE_ID_LENGTH,
  type SdkRuntime,
} from "../unique-id.ts";
import packageJson from "../package.json" with { type: "json" };
import { makeStore, okResponse } from "./helpers.ts";

const VECTORS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "conformance", "vectors");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): any => JSON.parse(readFileSync(join(VECTORS_DIR, `${name}.json`), "utf8"));

const flush = () => new Promise((r) => setTimeout(r, 10));
const SEMVER = /^\d+\.\d+\.\d+/;
const DEVICE_ID = /^[0-9A-Z_a-z]{16}$/;

type ConfigInput = {
  API_KEY: string;
  API_URL?: string;
  defaultNamespace?: string;
  languages: { primary: Lang; supported: Lang[] };
};

function configFrom(input: ConfigInput, extra: Partial<FetchTranslationParams["config"]> = {}) {
  return {
    API_KEY: input.API_KEY,
    API_URL: input.API_URL,
    defaultNamespace: input.defaultNamespace,
    languages: input.languages,
    ...extra,
  };
}

/** Asserts the exact header set, resolving the `$SDK_VERSION` / `$DEVICE_ID` placeholders. */
function expectHeaders(actual: Record<string, string>, expected: Record<string, string>) {
  for (const [name, value] of Object.entries(expected)) {
    if (value === "$SDK_VERSION") {
      expect(actual[name]).toBe(packageJson.version);
      expect(actual[name]).toMatch(SEMVER);
    } else if (value === "$DEVICE_ID") {
      expect(actual[name]).toMatch(DEVICE_ID);
    } else {
      expect(actual[name]).toBe(value);
    }
  }
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
}

type WireAnswer = {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  invalidJson?: boolean;
  networkError?: string;
  timeout?: boolean;
};

/** A `fetch` that answers each attempt with the next scripted transport outcome. */
function scriptedFetch(answers: WireAnswer[], onAttempt: () => void = () => {}) {
  let index = 0;
  return vi.fn((_url: string, init: RequestInit) => {
    onAttempt();
    const answer = answers[Math.min(index++, answers.length - 1)];
    if (answer.networkError) {
      return Promise.reject(new Error(answer.networkError));
    }
    if (answer.timeout) {
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }
    return Promise.resolve({
      status: answer.status,
      statusText: answer.statusText ?? "",
      headers: { get: (name: string) => answer.headers?.[name.toLowerCase()] ?? null },
      json: async () => {
        if (answer.invalidJson) throw new SyntaxError("Unexpected token");
        return answer.body ?? {};
      },
    });
  });
}

const realFetch = global.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  resetUniqueIdState();
  setSdkRuntime("react-client");
  getNamespacesToFetchAfterTranslationFinished();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = realFetch;
  resetUniqueIdState();
  vi.restoreAllMocks();
});

describe("vectors/storage-key", () => {
  const { cases } = load("storage-key");
  it.each(cases)("$name", ({ input, expected }) => {
    expect(storageKeyFor(input.key, input.context)).toBe(expected);
  });
});

describe("vectors/replace", () => {
  const { cases } = load("replace");
  it.each(cases)("$name", ({ input, expected }) => {
    expect(applyReplace(input.text, input.replace ?? undefined)).toBe(expected);
  });

  it("is the same function getTranslationCore applies", () => {
    const store = makeStore({ currentLanguage: "fr" });
    for (const { input, expected } of cases) {
      expect(getTranslationCore(input.text, store, { replace: input.replace ?? undefined })).toBe(expected);
    }
  });
});

describe("vectors/translation-lookup", () => {
  const { cases } = load("translation-lookup");
  it.each(cases)("$name", async ({ input, expected }) => {
    vi.spyOn(api, "fetchTranslation").mockResolvedValue({ ok: true, message: "" });
    const supported = Array.from(new Set<Lang>([input.store.primary, input.store.currentLanguage, "en", "es", "pt"]));
    const store = makeStore({
      currentLanguage: input.store.currentLanguage,
      translations: input.store.translations,
      config: {
        API_KEY: "test-key",
        languages: { primary: input.store.primary, supported },
        defaultNamespace: input.store.defaultNamespace,
      },
    });
    getNamespacesToFetchAfterTranslationFinished();

    expect(getTranslationCore(input.key, store, input.options)).toBe(expected.text);
    expect(getNamespacesToFetchAfterTranslationFinished()).toEqual(expected.queued);
    await flush();
  });
});

describe("vectors/namespace", () => {
  const vectors = load("namespace");
  expect(DEFAULT_NAMESPACE).toBe(vectors.defaultNamespace);
  it.each(vectors.cases)("$name", ({ fn, input, expected }) => {
    if (fn === "resolveNamespace") {
      const config = { ...makeStore().config, defaultNamespace: input.config.defaultNamespace };
      expect(resolveNamespace(input.options ?? undefined, config)).toBe(expected);
    } else if (fn === "resolveOriginLanguage") {
      const config = { languages: { primary: input.primary, supported: [input.primary] } };
      expect(resolveOriginLanguage(input.options ?? undefined, config) ?? null).toBe(expected);
    } else {
      throw new Error(`unknown fn ${fn}`);
    }
  });
});

describe("vectors/resolve-lang", () => {
  const { cases } = load("resolve-lang");
  it.each(cases)("$name", ({ input, expected }) => {
    const options = input.supported || input.fallback ? { supported: input.supported, fallback: input.fallback } : undefined;
    expect(resolveLang(input.tag, options) ?? null).toBe(expected);
  });
});

describe("vectors/languages", () => {
  const { cases } = load("languages");
  it.each(cases)("$name", ({ check, input, expected }) => {
    switch (check) {
      case "availableLangs":
        expect([...AVAILABLE_LANGS]).toEqual(expected);
        expect(AVAILABLE_LANGS).toHaveLength(48);
        expect(new Set(AVAILABLE_LANGS).size).toBe(48);
        break;
      case "rename":
        expect(AVAILABLE_LANGS).not.toContain(input);
        expect(resolveLang(input)).toBeUndefined();
        expect(AVAILABLE_LANGS).toContain(expected);
        break;
      case "stillAvailable":
        for (const lang of input) expect(AVAILABLE_LANGS).toContain(lang);
        expect(input).toHaveLength(17);
        break;
      case "absent":
        expect(AVAILABLE_LANGS).not.toContain(input);
        break;
      case "regionalized":
        expect([...AVAILABLE_LANGS.filter((lang) => lang.includes("-"))].sort()).toEqual(expected);
        break;
      default:
        throw new Error(`unknown check ${check}`);
    }
  });
});

describe("vectors/app-store-locales", () => {
  const vectors = load("app-store-locales");
  it.each(vectors.cases)("$input", ({ input, expected }) => {
    expect(toAppStoreLocale(input)).toBe(expected);
    expect(APP_STORE_LOCALES[input as Lang]).toBe(expected);
  });

  it("covers every language with a distinct slot", () => {
    expect(vectors.cases).toHaveLength(AVAILABLE_LANGS.length);
    const slots = new Set(Object.values(APP_STORE_LOCALES));
    expect(slots.size).toBe(vectors.distinctSlots);
    for (const slot of vectors.slotsWithoutCode) expect(slots.has(slot)).toBe(false);
  });
});

describe("vectors/backoff", () => {
  const vectors = load("backoff");

  it("exposes the schedule constants", () => {
    expect(TIMEOUT_MS).toBe(vectors.timeoutMs);
    expect(MAX_ATTEMPTS).toBe(vectors.maxAttempts);
    expect([...RETRY_DELAYS_MS]).toEqual(vectors.delaysMs);
  });

  it.each(vectors.cases)("$name", ({ input, expected }) => {
    const waitMs = input.failedAttempt < MAX_ATTEMPTS ? RETRY_DELAYS_MS[input.failedAttempt - 1] : null;
    const nextAttempt = input.failedAttempt < MAX_ATTEMPTS ? input.failedAttempt + 1 : null;
    expect(waitMs).toBe(expected.waitMs);
    expect(nextAttempt).toBe(expected.nextAttempt);
  });

  it("waits exactly 500 ms then 1500 ms between three failed attempts", async () => {
    vi.useFakeTimers();
    const fetchMock = scriptedFetch([{ status: 503, statusText: "Service Unavailable" }]);
    global.fetch = fetchMock as never;

    const pending = api.fetchTranslation("https://x.test", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1499);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(pending).resolves.toEqual({ ok: false, error: "Service Unavailable" });
  });

  it.each(vectors.scenarios)("$name", async ({ responses, expected }) => {
    // The faked clock stands still except when a timer fires, so the gap between two
    // attempts is exactly the backoff (plus the timeout, when the attempt timed out). No
    // spy on `setTimeout`: a spy installed under fake timers leaks the fake one.
    vi.useFakeTimers();
    const attemptedAt: number[] = [];
    const fetchMock = scriptedFetch(responses, () => attemptedAt.push(Date.now()));
    global.fetch = fetchMock as never;

    const pending = api.fetchTranslationsForOneLanguage("https://x.test", {});
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(expected.attempts);
    const sleeps = attemptedAt
      .slice(1)
      .map((time, index) => time - attemptedAt[index] - (responses[index].timeout ? TIMEOUT_MS : 0));
    expect(sleeps).toEqual(expected.sleepsMs);
    expect(result).toEqual(expected.result);
  });
});

describe("vectors/retry-decision", () => {
  const { cases } = load("retry-decision");
  it.each(cases)("$input.status $expected.action", async ({ input, expected }) => {
    const answer = { status: input.status, statusText: input.statusText, headers: { etag: "W/\"tag\"" }, body: { ok: true, message: "" } };
    switch (expected.action) {
      case "parse-body": {
        global.fetch = scriptedFetch([answer]) as never;
        await expect(api.fetchTranslation("https://x.test", {})).resolves.toEqual({ ok: true, message: "", etag: "W/\"tag\"" });
        break;
      }
      case "not-modified": {
        global.fetch = scriptedFetch([answer]) as never;
        await expect(api.fetchTranslation("https://x.test", {})).resolves.toEqual({ ok: true, notModified: true });
        break;
      }
      case "fail": {
        expect(isRetryableStatus(input.status)).toBe(false);
        expect(httpErrorMessage(input.status, input.statusText)).toBe(expected.error);
        const fetchMock = scriptedFetch([answer]);
        global.fetch = fetchMock as never;
        await expect(api.fetchTranslation("https://x.test", {})).resolves.toEqual({ ok: false, error: expected.error });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        break;
      }
      case "retry": {
        expect(isRetryableStatus(input.status)).toBe(true);
        expect(httpErrorMessage(input.status, input.statusText)).toBe(expected.error);
        vi.useFakeTimers();
        const fetchMock = scriptedFetch([answer]);
        global.fetch = fetchMock as never;
        const pending = api.fetchTranslation("https://x.test", {});
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toEqual({ ok: false, error: expected.error });
        expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
        break;
      }
      default:
        throw new Error(`unknown action ${expected.action}`);
    }
  });
});

describe("vectors/usage-reporting", () => {
  const { cases, serverLabels } = load("usage-reporting");
  it.each(serverLabels.cases)("server label: $label", ({ label, expected }) => {
    expect(isServerRuntime(label)).toBe(expected);
  });
  it.each(cases)("$name", ({ input, expected }) => {
    const runtime = resolveSdkRuntime(input);
    expect(runtime).toBe(expected.runtime);
    expect(isUsageReportingEnabled(runtime)).toBe(expected.sendsUsage);
    expect(isUsageReportingEnabled(runtime)).toBe(expected.recordsUsage);

    setSdkRuntime(runtime);
    const headers = identityHeaders("deviceIdABCDEF12");
    expect(headers.sdk).toBe(runtime);
    expect("unique_id" in headers).toBe(expected.sendsUniqueId);
    if (expected.sendsUniqueId) expect(headers.unique_id).toBe("deviceIdABCDEF12");
  });
});

describe("vectors/unique-id", () => {
  const vectors = load("unique-id");

  it("generates ids of the documented shape", () => {
    expect(UNIQUE_ID_ALPHABET).toBe(vectors.alphabet);
    expect(UNIQUE_ID_ALPHABET).toHaveLength(vectors.alphabetLength);
    expect(UNIQUE_ID_LENGTH).toBe(vectors.idLength);
    expect(256 - (256 % UNIQUE_ID_ALPHABET.length)).toBe(vectors.largestUsableByteExclusive);
    const pattern = new RegExp(vectors.idPattern);
    for (let i = 0; i < 200; i++) {
      const id = generateUniqueId();
      expect(id).toMatch(pattern);
      expect(isUniqueId(id)).toBe(true);
    }
    for (const char of UNIQUE_ID_ALPHABET) expect(isUniqueId(char)).toBe(true);
  });

  it.each(vectors.cases)("$name", ({ input, expected }) => {
    expect(isUniqueId(input)).toBe(expected);
  });
});

describe("vectors/queue", () => {
  const vectors = load("queue");

  it.each(vectors.cases)("$name", ({ input, expected }) => {
    expect(queueIdFor(input.namespace, input.key)).toBe(expected);
  });

  const scripted = vectors.scenarios.filter((scenario: { calls: unknown }) => Array.isArray(scenario.calls));
  it.each(scripted)("$name", async ({ calls, translations, expected }) => {
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue({ ok: true, message: "" });
    const store = makeStore({ translations: translations ?? {} });
    for (const call of calls) translateKey(call.key, store, call.options);
    await flush();
    expect(spy).toHaveBeenCalledTimes(expected.requests);
  });

  it("keeps at most 30 requests in flight (31 distinct keys)", async () => {
    const scenario = vectors.scenarios.find((s: { calls: unknown }) => s.calls === "31 distinct keys");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let inFlight = 0;
    let peak = 0;
    const spy = vi.spyOn(api, "fetchTranslation").mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gate;
      inFlight -= 1;
      return { ok: true, message: "" };
    });
    const store = makeStore();
    for (let i = 0; i < 31; i++) translateKey(`conformance-31-${i}`, store);
    await flush();
    expect(peak).toBe(vectors.concurrency);
    expect(inFlight).toBe(vectors.concurrency);
    release();
    await flush();
    expect(spy).toHaveBeenCalledTimes(scenario.expected.requests);
    expect(peak).toBe(scenario.expected.peakInFlight);
  });
});

describe("vectors/translate-request", () => {
  const { cases } = load("translate-request");
  it.each(cases)("$name", async ({ input, expected }) => {
    setSdkRuntime(input.runtime as SdkRuntime);
    const handler = vi.fn().mockResolvedValue({ ok: true, message: "", data: { translation: {} } });
    const store = makeStore({
      currentLanguage: input.currentLanguage,
      translations: input.translations ?? {},
      uniqueId: null,
      config: configFrom(input.config, { handleTranslate: input.config.handleTranslate ? handler : undefined }),
    });
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue({ ok: true, message: "" });

    translateKey(input.key, store, input.options);
    await flush();

    if (expected.http === false) {
      expect(spy).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]).toEqual(expected.handlerArgs);
      return;
    }
    expect(handler).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(expected.url);
    expect(init.method).toBe(expected.method);
    expectHeaders(init.headers as Record<string, string>, expected.headers);
    expect(JSON.parse(init.body as string)).toEqual(expected.body);
  });

  it("uses the official service by default", () => {
    expect(DEFAULT_API_URL).toBe("https://api.i18n-keyless.com");
  });
});

describe("vectors/dictionary-request", () => {
  const { cases } = load("dictionary-request");
  it.each(cases)("$name", async ({ input, expected }) => {
    setSdkRuntime(input.runtime as SdkRuntime);
    const handler = vi.fn().mockResolvedValue(okResponse({}));
    const store = makeStore({
      lastRefresh: input.lastRefresh,
      uniqueId: null,
      config: configFrom(input.config, { getAllTranslations: input.config.getAllTranslations ? handler : undefined }),
    });
    const spy = vi.spyOn(api, "fetchTranslationsForOneLanguage").mockResolvedValue(okResponse({}));

    if (input.knownEtag) {
      spy.mockResolvedValueOnce({ ...okResponse({}), etag: input.knownEtag });
      await getAllTranslationsFromLanguage(input.targetLanguage, store, input.namespace);
    }
    if (input.knownEtagFor) {
      spy.mockResolvedValueOnce({ ...okResponse({}), etag: input.knownEtagFor.etag });
      await getAllTranslationsFromLanguage(input.knownEtagFor.lang, store, input.namespace);
    }
    spy.mockClear();

    await getAllTranslationsFromLanguage(input.targetLanguage, store, input.namespace);

    if (expected.http === false) {
      expect(spy).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]).toEqual(expected.handlerArgs);
      return;
    }
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(expected.url);
    expect(init.method).toBe(expected.method);
    expectHeaders(init.headers as Record<string, string>, expected.headers);
    expect(etagCacheKey(input.config.API_KEY, input.targetLanguage, input.namespace)).toBe(expected.etagCacheKey);
    expect(
      buildDictionaryUrl({
        apiUrl: input.config.API_URL,
        targetLanguage: input.targetLanguage,
        lastRefresh: input.lastRefresh,
        namespace: input.namespace,
        etag: input.knownEtag,
      })
    ).toBe(expected.url);
  });
});

describe("vectors/dictionary-response", () => {
  const { cases } = load("dictionary-response");
  it.each(cases)("$name", async ({ input, response, responses, expected }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = makeStore({ lastRefresh: "1700000000", uniqueId: null, config: { API_KEY: input.config.API_KEY } });
    const seedBody = okResponse({});

    if (input.knownEtag) {
      global.fetch = scriptedFetch([{ status: 200, headers: { etag: input.knownEtag }, body: seedBody }]) as never;
      await getAllTranslationsFromLanguage(input.targetLanguage, store);
    }

    const answers: WireAnswer[] = responses ?? [response];
    const fetchMock = scriptedFetch(answers);
    global.fetch = fetchMock as never;
    let result: unknown;
    if (answers.length > 1) {
      vi.useFakeTimers();
      const pending = getAllTranslationsFromLanguage(input.targetLanguage, store);
      await vi.runAllTimersAsync();
      result = await pending;
      vi.useRealTimers();
    } else {
      result = await getAllTranslationsFromLanguage(input.targetLanguage, store);
    }

    expect(result ?? null).toEqual(expected.result);
    if (expected.attempts) expect(fetchMock).toHaveBeenCalledTimes(expected.attempts);
    if (expected.warning) expect(warn).toHaveBeenCalledWith("i18n-keyless: ", expected.warning);

    const next = scriptedFetch([{ status: 200, headers: {}, body: seedBody }]);
    global.fetch = next as never;
    await getAllTranslationsFromLanguage(input.targetLanguage, store);
    const [url, init] = next.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(expected.nextRequest.url);
    const headers = init.headers as Record<string, string>;
    expect(headers["If-None-Match"] ?? null).toBe(expected.nextRequest.ifNoneMatch);
    expect(headers["If-None-Match"] ?? null).toBe(expected.etagRemembered);
  });
});

describe("vectors/usage-request", () => {
  const { cases } = load("usage-request");
  it.each(cases)("$name", async ({ input, expected }) => {
    setSdkRuntime(input.runtime as SdkRuntime);
    const handler = vi.fn().mockResolvedValue({ ok: true, message: "" });
    const store = makeStore({
      uniqueId: null,
      config: configFrom(input.config, { sendTranslationsUsage: input.config.sendTranslationsUsage ? handler : undefined }),
    });
    const spy = vi.spyOn(api, "postLastUsedTranslations").mockResolvedValue({ ok: true, message: "" });

    await sendTranslationsUsageToI18nKeyless(input.usage, store);

    if (expected.http === false) {
      expect(spy).not.toHaveBeenCalled();
      if (expected.handler) {
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0]).toEqual(expected.handlerArgs);
      } else {
        expect(handler).not.toHaveBeenCalled();
      }
      return;
    }
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(expected.url);
    expect(init.method).toBe(expected.method);
    expectHeaders(init.headers as Record<string, string>, expected.headers);
    expect(JSON.parse(init.body as string)).toEqual(expected.body);
  });
});

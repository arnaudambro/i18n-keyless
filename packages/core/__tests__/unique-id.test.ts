import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateUniqueId,
  isUniqueId,
  setSdkRuntime,
  identityHeaders,
  setUniqueId,
  getUniqueId,
  holdRequestsUntilUniqueIdIsKnown,
  whenUniqueIdIsKnown,
  releaseUniqueIdGate,
  resolveUniqueIdForRequest,
  resetUniqueIdState,
} from "../unique-id.ts";
import {
  translateKey,
  getAllTranslationsFromLanguage,
  sendTranslationsUsageToI18nKeyless,
  getNamespacesToFetchAfterTranslationFinished,
} from "../service.ts";
import { api } from "../api.ts";
import { makeStore, okResponse } from "./helpers.ts";

const flush = () => new Promise((r) => setTimeout(r, 10));

/** The alphabet and length the API's own nanoid uses. */
const API_ID_SHAPE = /^[0-9A-Z_a-z]{16}$/;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetUniqueIdState();
  setSdkRuntime("react-client");
  getNamespacesToFetchAfterTranslationFinished();
});

afterEach(() => {
  resetUniqueIdState();
  vi.restoreAllMocks();
});

describe("generateUniqueId", () => {
  it("has the same shape as the id the API would have minted", () => {
    expect(generateUniqueId()).toMatch(API_ID_SHAPE);
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 500 }, generateUniqueId));
    expect(ids.size).toBe(500);
  });

  it("still works without a global crypto (React Native's Hermes has none)", () => {
    const realCrypto = globalThis.crypto;
    // @ts-expect-error deleting a global on purpose
    delete globalThis.crypto;
    try {
      expect(generateUniqueId()).toMatch(API_ID_SHAPE);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true });
    }
  });
});

describe("isUniqueId", () => {
  it("accepts a plain id", () => {
    expect(isUniqueId("abc123")).toBe(true);
    expect(isUniqueId(generateUniqueId())).toBe(true);
  });

  it("rejects what a storage adapter can hand back instead of an id", () => {
    expect(isUniqueId(null)).toBe(false);
    expect(isUniqueId(undefined)).toBe(false);
    expect(isUniqueId("")).toBe(false);
    expect(isUniqueId(42)).toBe(false);
    expect(isUniqueId({})).toBe(false);
  });

  it("rejects a value that would make fetch throw on the header", () => {
    expect(isUniqueId("abc\ndef")).toBe(false);
    expect(isUniqueId("abc def")).toBe(false);
    expect(isUniqueId("a".repeat(65))).toBe(false);
  });
});

describe("resolveUniqueIdForRequest", () => {
  it("never returns an empty header, even with nothing resolved", () => {
    expect(resolveUniqueIdForRequest(null)).toMatch(API_ID_SHAPE);
  });

  it("keeps the id it minted, so one session is one user", () => {
    const first = resolveUniqueIdForRequest(null);
    expect(resolveUniqueIdForRequest(null)).toBe(first);
    expect(resolveUniqueIdForRequest(undefined)).toBe(first);
  });

  it("adopts the store's id and holds on to it", () => {
    expect(resolveUniqueIdForRequest("fromStorage")).toBe("fromStorage");
    // A later call handed a stale (pre-hydration) snapshot must not fall back to a new id.
    expect(resolveUniqueIdForRequest(null)).toBe("fromStorage");
  });

  it("lets the package's resolved id win over a stale snapshot", () => {
    setUniqueId("persisted-id");
    expect(resolveUniqueIdForRequest(null)).toBe("persisted-id");
    expect(getUniqueId()).toBe("persisted-id");
  });

  it("ignores an unusable persisted value rather than send it as a header", () => {
    setUniqueId("bad\nid");
    expect(getUniqueId()).toBeNull();
    expect(resolveUniqueIdForRequest(null)).toMatch(API_ID_SHAPE);
  });
});

describe("the boot gate", () => {
  it("reports nothing to wait for when no one is holding", () => {
    expect(whenUniqueIdIsKnown()).toBeNull();
  });

  it("holds, then releases every waiter", async () => {
    const release = holdRequestsUntilUniqueIdIsKnown();
    const gate = whenUniqueIdIsKnown();
    expect(gate).not.toBeNull();

    let opened = false;
    void gate!.then(() => {
      opened = true;
    });
    await flush();
    expect(opened).toBe(false);

    release();
    await flush();
    expect(opened).toBe(true);
    expect(whenUniqueIdIsKnown()).toBeNull();
  });

  it("is idempotent: a second hold reuses the same gate", () => {
    holdRequestsUntilUniqueIdIsKnown();
    const gate = whenUniqueIdIsKnown();
    holdRequestsUntilUniqueIdIsKnown();
    expect(whenUniqueIdIsKnown()).toBe(gate);
    releaseUniqueIdGate();
  });
});

describe("every counted request carries an id", () => {
  it("POST /translate waits for the gate instead of going out unidentified", async () => {
    const fetchTranslation = vi.spyOn(api, "fetchTranslation").mockResolvedValue({ ok: true });
    const release = holdRequestsUntilUniqueIdIsKnown();

    // A component mounts and misses while init() is still reading device storage.
    translateKey("Bonjour", makeStore({ uniqueId: null }));
    await flush();
    expect(fetchTranslation).not.toHaveBeenCalled();

    // Hydration lands: the persisted device id is now known.
    setUniqueId("persisted-device-id");
    release();
    await flush();

    expect(fetchTranslation).toHaveBeenCalledTimes(1);
    expect(fetchTranslation.mock.calls[0][1].headers).toMatchObject({ unique_id: "persisted-device-id" });
  });

  it("POST /translate mints its own id rather than send an empty header", async () => {
    const fetchTranslation = vi.spyOn(api, "fetchTranslation").mockResolvedValue({ ok: true });

    translateKey("Bonsoir", makeStore({ uniqueId: null }));
    await flush();

    const { unique_id } = fetchTranslation.mock.calls[0][1].headers as Record<string, string>;
    expect(unique_id).toMatch(API_ID_SHAPE);
  });

  it("GET /translate/:lang waits for the gate too", async () => {
    const fetchAll = vi
      .spyOn(api, "fetchTranslationsForOneLanguage")
      .mockResolvedValue(okResponse({ Bonjour: "Hello" }));
    const release = holdRequestsUntilUniqueIdIsKnown();

    const pending = getAllTranslationsFromLanguage("en", makeStore({ uniqueId: null }));
    await flush();
    expect(fetchAll).not.toHaveBeenCalled();

    setUniqueId("persisted-device-id");
    release();
    await pending;

    expect(fetchAll.mock.calls[0][1].headers).toMatchObject({ unique_id: "persisted-device-id" });
  });

  it("POST /translate/last-used-translations carries the id (it used to carry none)", async () => {
    const postUsage = vi.spyOn(api, "postLastUsedTranslations").mockResolvedValue({ ok: true, message: "" });

    await sendTranslationsUsageToI18nKeyless(
      { default: { Bonjour: "2026-08-25" } },
      makeStore({ uniqueId: "persisted-device-id" })
    );

    // The API counts this route. Without the header it minted one throwaway "user" per
    // init() — one per app launch, per install.
    expect(postUsage.mock.calls[0][1].headers).toMatchObject({ unique_id: "persisted-device-id" });
  });

  it("the usage POST never sends an empty header either", async () => {
    const postUsage = vi.spyOn(api, "postLastUsedTranslations").mockResolvedValue({ ok: true, message: "" });

    await sendTranslationsUsageToI18nKeyless({ default: { Bonjour: "2026-08-25" } }, makeStore({ uniqueId: null }));

    const { unique_id } = postUsage.mock.calls[0][1].headers as Record<string, string>;
    expect(unique_id).toMatch(API_ID_SHAPE);
  });

  it("uses one id for every request of a session", async () => {
    vi.spyOn(api, "fetchTranslation").mockResolvedValue({ ok: true });
    const fetchAll = vi.spyOn(api, "fetchTranslationsForOneLanguage").mockResolvedValue(okResponse({}));
    const postUsage = vi.spyOn(api, "postLastUsedTranslations").mockResolvedValue({ ok: true, message: "" });
    const store = makeStore({ uniqueId: null });

    translateKey("Un", store);
    translateKey("Deux", store);
    await flush();
    await getAllTranslationsFromLanguage("en", store);
    await sendTranslationsUsageToI18nKeyless({ default: { Un: "2026-08-25" } }, store);

    const headerOf = (call: [string, RequestInit]) => (call[1].headers as Record<string, string>).unique_id;
    const ids = new Set([
      ...(vi.mocked(api.fetchTranslation).mock.calls as Array<[string, RequestInit]>).map(headerOf),
      ...(fetchAll.mock.calls as Array<[string, RequestInit]>).map(headerOf),
      ...(postUsage.mock.calls as Array<[string, RequestInit]>).map(headerOf),
    ]);
    // Four requests, one user. This is the whole bug: they used to be four users.
    expect(ids.size).toBe(1);
  });
});

describe("the sdk header", () => {
  it("labels a device request and carries its id", () => {
    setSdkRuntime("react-client");
    const headers = identityHeaders("deviceIdABCDEF12");
    expect(headers).toEqual({ sdk: "react-client", unique_id: "deviceIdABCDEF12" });
  });

  it("sends no id from a server: the API counts its source IP", () => {
    for (const runtime of ["node", "react-server"] as const) {
      setSdkRuntime(runtime);
      // A server id would be wrong either way: fresh per boot inflates the count, pinned
      // across a fleet collapses it. So there is none to send.
      expect(identityHeaders()).toEqual({ sdk: runtime });
      expect(identityHeaders("an-id-from-somewhere")).toEqual({ sdk: runtime });
    }
  });

  it("defaults to the device case, so a request is never unlabelled", () => {
    expect(identityHeaders(null).sdk).toBe("react-client");
    expect(identityHeaders(null).unique_id).toMatch(API_ID_SHAPE);
  });
});

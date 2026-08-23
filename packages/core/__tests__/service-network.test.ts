import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  translateKey,
  getAllTranslationsFromLanguage,
  sendTranslationsUsageToI18nKeyless,
  getNamespacesToFetchAfterTranslationFinished,
  resolveNamespace,
  resolveOriginLanguage,
  queue,
} from "../service.ts";
import { api } from "../api.ts";
import { DEFAULT_NAMESPACE } from "../types.ts";
import { makeStore, okResponse } from "./helpers.ts";

const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  getNamespacesToFetchAfterTranslationFinished(); // drain leftovers between tests
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveNamespace", () => {
  it("prefers the per-call namespace", () => {
    expect(resolveNamespace({ namespace: "checkout" }, makeStore().config)).toBe("checkout");
  });

  it("falls back to the configured default, then to the reserved default", () => {
    const config = { ...makeStore().config, defaultNamespace: "app" };
    expect(resolveNamespace(undefined, config)).toBe("app");
    expect(resolveNamespace(undefined, makeStore().config)).toBe(DEFAULT_NAMESPACE);
  });
});

describe("resolveOriginLanguage", () => {
  const config = makeStore().config;

  it("returns the origin language when it differs from the primary", () => {
    expect(resolveOriginLanguage({ originLanguage: "es" }, config)).toBe("es");
  });

  it("returns undefined when it equals the primary, or is absent", () => {
    expect(resolveOriginLanguage({ originLanguage: "fr" }, config)).toBeUndefined();
    expect(resolveOriginLanguage(undefined, config)).toBeUndefined();
  });
});

describe("translateKey", () => {
  it("throws when the config was never initialised", () => {
    const store = makeStore();
    store.config.API_KEY = "";
    expect(() => translateKey("Bonjour", store)).toThrow(/config is not initialized/);
  });

  it("ignores an empty key", async () => {
    const spy = vi.spyOn(api, "fetchTranslation");
    translateKey("", makeStore());
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing when the translation is already in the store", async () => {
    const spy = vi.spyOn(api, "fetchTranslation");
    translateKey("Bonjour", makeStore({ translations: { Bonjour: "Hello" } }));
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it("re-queues an already-translated key when forceTemporary is set for this language", async () => {
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    translateKey("Bonjour", makeStore({ translations: { Bonjour: "Hello" } }), {
      forceTemporary: { en: "MINE" },
    });
    await flush();
    expect(spy).toHaveBeenCalled();
  });

  it("POSTs the key with the project's languages", async () => {
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    translateKey("Bonjour", makeStore());
    await flush();

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.i18n-keyless.com/translate");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      key: "Bonjour",
      languages: ["fr", "en", "es"],
      primaryLanguage: "fr",
    });
    expect((init as RequestInit).method).toBe("POST");
  });

  it("omits the default namespace from the body, so the wire format is unchanged", async () => {
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    translateKey("Bonjour", makeStore());
    await flush();
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.namespace).toBeUndefined();
  });

  it("sends an explicit namespace", async () => {
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    translateKey("Payer", makeStore(), { namespace: "checkout" });
    await flush();
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.namespace).toBe("checkout");
  });

  it("sends the origin language for UGC", async () => {
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    translateKey("Hola mundo", makeStore(), { originLanguage: "es" });
    await flush();
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.originLanguage).toBe("es");
  });

  it("uses a custom API_URL when given", async () => {
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    const store = makeStore();
    store.config.API_URL = "https://self.hosted";
    translateKey("Bonjour", store);
    await flush();
    expect(spy.mock.calls[0][0]).toBe("https://self.hosted/translate");
  });

  it("calls a custom handleTranslate instead of the API", async () => {
    const handleTranslate = vi.fn().mockResolvedValue({ ok: true, message: "", data: {} });
    const spy = vi.spyOn(api, "fetchTranslation");
    const store = makeStore();
    store.config.handleTranslate = handleTranslate;

    translateKey("Bonjour", store);
    await flush();

    expect(handleTranslate).toHaveBeenCalledWith("Bonjour");
    expect(spy).not.toHaveBeenCalled();
  });

  it("swallows a network failure rather than breaking the render", async () => {
    vi.spyOn(api, "fetchTranslation").mockRejectedValue(new Error("offline"));
    expect(() => translateKey("Bonjour", makeStore())).not.toThrow();
    await flush();
  });

  it("records the namespace for the queue's bulk refetch, then clears it", async () => {
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    translateKey("Payer", makeStore(), { namespace: "checkout" });

    const first = getNamespacesToFetchAfterTranslationFinished();
    expect(first).toEqual([{ namespace: "checkout", unpersisted: false }]);
    expect(getNamespacesToFetchAfterTranslationFinished()).toEqual([]);
    await flush();
  });

  it("marks an unpersisted namespace as such", async () => {
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    translateKey("Hi", makeStore(), { namespace: "chat-1", unpersistedNamespace: true });
    expect(getNamespacesToFetchAfterTranslationFinished()).toEqual([
      { namespace: "chat-1", unpersisted: true },
    ]);
    await flush();
  });

  it("logs each step when debug is on", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));

    translateKey("Bonjour", makeStore(), { debug: true });
    await flush();

    const logged = log.mock.calls.map((c) => c[0]).join(" ");
    expect(logged).toContain("translateKey");
    expect(logged).toContain("fetching translation");
    expect(logged).toContain("response");
  });

  it("logs and skips when debug is on and the translation already exists", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const spy = vi.spyOn(api, "fetchTranslation");

    translateKey("Bonjour", makeStore({ translations: { Bonjour: "Hello" } }), { debug: true });
    await flush();

    expect(log.mock.calls.map((c) => c[0]).join(" ")).toContain("translation exists");
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces a server message to the console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(api, "fetchTranslation").mockResolvedValue({
      ...okResponse({}),
      message: "quota almost reached",
    });
    translateKey("Bonjour", makeStore());
    await flush();
    expect(warn).toHaveBeenCalledWith("i18n-keyless: ", "quota almost reached");
  });

  it("queues the same text under different namespaces separately", async () => {
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okResponse({}));
    translateKey("Payer", makeStore(), { namespace: "checkout" });
    translateKey("Payer", makeStore(), { namespace: "cart" });
    await flush();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("getAllTranslationsFromLanguage", () => {
  it("returns nothing when the config was never initialised", async () => {
    const store = makeStore();
    store.config.API_KEY = "";
    expect(await getAllTranslationsFromLanguage("en", store)).toBeUndefined();
  });

  it("GETs the language dictionary and returns the envelope", async () => {
    const spy = vi
      .spyOn(api, "fetchTranslationsForOneLanguage")
      .mockResolvedValue(okResponse({ Bonjour: "Hello" }));

    const res = await getAllTranslationsFromLanguage("en", makeStore());

    expect(spy.mock.calls[0][0]).toBe(
      "https://api.i18n-keyless.com/translate/en?last_refresh=null"
    );
    expect(res?.data.translations).toEqual({ Bonjour: "Hello" });
  });

  it("passes the delta cursor", async () => {
    const spy = vi.spyOn(api, "fetchTranslationsForOneLanguage").mockResolvedValue(okResponse({}));
    await getAllTranslationsFromLanguage("en", makeStore({ lastRefresh: "1700000000" }));
    expect(spy.mock.calls[0][0]).toContain("last_refresh=1700000000");
  });

  it("omits the default namespace from the query, so the URL is unchanged", async () => {
    const spy = vi.spyOn(api, "fetchTranslationsForOneLanguage").mockResolvedValue(okResponse({}));
    await getAllTranslationsFromLanguage("en", makeStore(), DEFAULT_NAMESPACE);
    expect(spy.mock.calls[0][0]).not.toContain("namespace=");
  });

  it("url-encodes an explicit namespace", async () => {
    const spy = vi.spyOn(api, "fetchTranslationsForOneLanguage").mockResolvedValue(okResponse({}));
    await getAllTranslationsFromLanguage("en", makeStore(), "check out/1");
    expect(spy.mock.calls[0][0]).toContain("namespace=check%20out%2F1");
  });

  it("surfaces a server message to the console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(api, "fetchTranslationsForOneLanguage").mockResolvedValue({
      ...okResponse({}),
      message: "deprecated version",
    });
    await getAllTranslationsFromLanguage("en", makeStore());
    expect(warn).toHaveBeenCalledWith("i18n-keyless: ", "deprecated version");
  });

  it("returns nothing when the API answers not-ok", async () => {
    vi.spyOn(api, "fetchTranslationsForOneLanguage").mockResolvedValue({
      ok: false,
      error: "nope",
      data: {},
      message: "",
    });
    expect(await getAllTranslationsFromLanguage("en", makeStore())).toBeUndefined();
  });

  it("returns nothing when the request throws", async () => {
    vi.spyOn(api, "fetchTranslationsForOneLanguage").mockRejectedValue(new Error("offline"));
    expect(await getAllTranslationsFromLanguage("en", makeStore())).toBeUndefined();
  });

  it("uses a custom getAllTranslations handler instead of the API", async () => {
    const spy = vi.spyOn(api, "fetchTranslationsForOneLanguage");
    const store = makeStore();
    store.config.getAllTranslations = vi.fn().mockResolvedValue(okResponse({ Bonjour: "Hello" }));

    const res = await getAllTranslationsFromLanguage("en", store);

    expect(res?.data.translations).toEqual({ Bonjour: "Hello" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("sendTranslationsUsageToI18nKeyless", () => {
  it("returns nothing when the config was never initialised", async () => {
    const store = makeStore();
    store.config.API_KEY = "";
    expect(await sendTranslationsUsageToI18nKeyless({ default: {} }, store)).toBeUndefined();
  });

  it("does not POST an empty usage map", async () => {
    const spy = vi.spyOn(api, "postLastUsedTranslations");
    await sendTranslationsUsageToI18nKeyless({}, makeStore());
    expect(spy).not.toHaveBeenCalled();
  });

  it("POSTs usage keyed by namespace, with the primary language", async () => {
    const spy = vi
      .spyOn(api, "postLastUsedTranslations")
      .mockResolvedValue({ ok: true, message: "" });

    await sendTranslationsUsageToI18nKeyless(
      { default: { Bonjour: "2026-08-04" }, checkout: { Payer: "2026-08-05" } },
      makeStore()
    );

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.i18n-keyless.com/translate/last-used-translations");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.primaryLanguage).toBe("fr");
    expect(body.translationsUsageByNamespace.checkout).toEqual({ Payer: "2026-08-05" });
  });

  it("hands a custom handler the default-namespace bucket only", async () => {
    const sendTranslationsUsage = vi.fn().mockResolvedValue({ ok: true, message: "" });
    const store = makeStore();
    store.config.sendTranslationsUsage = sendTranslationsUsage;

    await sendTranslationsUsageToI18nKeyless(
      { default: { Bonjour: "2026-08-04" }, checkout: { Payer: "2026-08-05" } },
      store
    );

    expect(sendTranslationsUsage).toHaveBeenCalledWith({ Bonjour: "2026-08-04" });
  });

  it("surfaces a server message to the console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(api, "postLastUsedTranslations").mockResolvedValue({
      ok: true,
      message: "usage recorded late",
    });
    await sendTranslationsUsageToI18nKeyless({ default: { a: "1" } }, makeStore());
    expect(warn).toHaveBeenCalledWith("i18n-keyless: ", "usage recorded late");
  });

  it("returns nothing when the request throws", async () => {
    vi.spyOn(api, "postLastUsedTranslations").mockRejectedValue(new Error("offline"));
    expect(
      await sendTranslationsUsageToI18nKeyless({ default: { a: "1" } }, makeStore())
    ).toBeUndefined();
  });
});

describe("the shared queue", () => {
  it("is exported so consumers can hook its `empty` event", () => {
    expect(typeof queue.on).toBe("function");
    expect(typeof queue.add).toBe("function");
  });
});

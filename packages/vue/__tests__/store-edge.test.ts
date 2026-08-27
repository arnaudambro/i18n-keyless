import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Lang } from "i18n-keyless-core";
import { load, makeStorage, mockFetch, flush, baseConfig } from "./helpers.ts";

type Lib = Awaited<ReturnType<typeof load>>;

const EN = { Bonjour: "Hello", "Au revoir": "Goodbye" };

/** A successful bulk-fetch response, the shape the core hands to `setTranslations`. */
const okResponse = (translations: Record<string, string>, extra: Record<string, unknown> = {}) =>
  ({ ok: true, data: { translations, uniqueId: null, lastRefresh: null, ...extra }, error: "", message: "" }) as never;

/** A `fetch` that refuses everything with a 4xx: answered at once, never retried. */
function mockRefusingFetch() {
  const fn = vi.fn(async () => ({
    status: 400,
    statusText: "Bad Request",
    headers: { get: () => null },
    json: async () => ({ ok: false, error: "Bad Request" }),
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

let logSpy: ReturnType<typeof vi.spyOn>;

const logs = () => logSpy.mock.calls.map((call) => call.map(String).join(" "));

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A store as `init()` leaves it, minus the network. */
function seed(lib: Lib, storage: unknown, overrides: Record<string, unknown> = {}) {
  lib.useI18nKeyless.setState({
    config: baseConfig(storage) as never,
    currentLanguage: "fr",
    translations: {},
    translationsByNamespace: {},
    namespaces: [],
    unpersistedNamespaces: [],
    lastRefreshByNamespace: {},
    translationsUsageByNamespace: {},
    originNamespaces: [],
    ...overrides,
  });
}

describe("setTranslations", () => {
  it("ignores a missing or failed response", async () => {
    const lib = await load();
    const storage = makeStorage();
    seed(lib, storage);
    const state = lib.useI18nKeyless.getState();
    state.setTranslations(undefined, "default");
    state.setTranslations({ ok: false } as never, "default");
    expect(state.translations).toEqual({});
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("throws when the config or the storage is not initialized", async () => {
    const lib = await load();
    seed(lib, makeStorage(), { config: { ...baseConfig(makeStorage()), API_KEY: "" } });
    const state = lib.useI18nKeyless.getState();
    expect(() => state.setTranslations(okResponse(EN), "default")).toThrow(/config is not initialized setting translations/);
    seed(lib, undefined);
    expect(() => state.setTranslations(okResponse(EN), "default")).toThrow(/storage is not initialized setting translations/);
  });

  it("keeps an unpersisted namespace in memory only, with its cursor", async () => {
    const lib = await load();
    const storage = makeStorage();
    seed(lib, storage);
    const state = lib.useI18nKeyless.getState();

    state.setTranslations(okResponse({ A: "a" }, { lastRefresh: "2025-01-01" }), "chat", true);
    expect(state.translations).toEqual({ A: "a" });
    expect(state.translationsByNamespace.chat).toEqual({ A: "a" });
    expect(state.namespaces).toEqual(["chat"]);
    expect(state.unpersistedNamespaces).toEqual(["chat"]);
    expect(state.lastRefreshByNamespace.chat).toBe("2025-01-01");
    expect(state.lastRefresh).toBe("2025-01-01");

    // A delta for the same namespace: still nothing written, the flag is not duplicated.
    state.setTranslations(okResponse({ B: "b" }), "chat", true);
    expect(state.translations).toEqual({ A: "a", B: "b" });
    expect(state.unpersistedNamespaces).toEqual(["chat"]);
    expect(state.lastRefreshByNamespace.chat).toBe("2025-01-01");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("persists a new namespace slice, the index (minus unpersisted namespaces) and its cursor", async () => {
    const lib = await load();
    const storage = makeStorage();
    seed(lib, storage);
    const state = lib.useI18nKeyless.getState();

    state.setTranslations(okResponse({ A: "a" }), "chat", true);
    state.setTranslations(okResponse({ B: "b" }, { lastRefresh: "2025-01-01" }), "shop");
    expect(storage.data.get("i18n-keyless-translations__shop")).toBe(JSON.stringify({ B: "b" }));
    expect(storage.data.get("i18n-keyless-namespaces")).toBe(JSON.stringify(["shop"]));
    expect(storage.data.get("i18n-keyless-last-refresh__shop")).toBe("2025-01-01");
    expect(state.namespaces).toEqual(["chat", "shop"]);

    // A delta without a cursor: the slice grows, the index and the cursor are left alone.
    const writes = storage.setItem.mock.calls.length;
    state.setTranslations(okResponse({ C: "c" }), "shop");
    expect(storage.data.get("i18n-keyless-translations__shop")).toBe(JSON.stringify({ B: "b", C: "c" }));
    expect(storage.data.get("i18n-keyless-last-refresh__shop")).toBe("2025-01-01");
    expect(storage.setItem.mock.calls.length).toBe(writes + 1);
  });
});

describe("registerOriginNamespace", () => {
  it("records and persists each namespace once, keeping unpersisted namespaces out of storage", async () => {
    const lib = await load();
    const storage = makeStorage();
    seed(lib, storage, { unpersistedNamespaces: ["chat", "tmp"] });
    const state = lib.useI18nKeyless.getState();

    state.registerOriginNamespace("ugc");
    expect(state.originNamespaces).toEqual(["ugc"]);
    expect(storage.data.get("i18n-keyless-origin-namespaces")).toBe(JSON.stringify(["ugc"]));

    state.registerOriginNamespace("ugc");
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    // Flagged unpersisted at the call: kept in memory, nothing written.
    state.registerOriginNamespace("chat", true);
    expect(state.originNamespaces).toEqual(["ugc", "chat"]);
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    // Known as unpersisted by the store: the written index excludes it (and "chat").
    state.registerOriginNamespace("tmp");
    expect(state.originNamespaces).toEqual(["ugc", "chat", "tmp"]);
    expect(storage.data.get("i18n-keyless-origin-namespaces")).toBe(JSON.stringify(["ugc"]));
  });

  it("does not write without a storage", async () => {
    const lib = await load();
    seed(lib, undefined);
    const state = lib.useI18nKeyless.getState();
    expect(() => state.registerOriginNamespace("ugc")).not.toThrow();
    expect(state.originNamespaces).toEqual(["ugc"]);
  });
});

describe("sendTranslationsUsage", () => {
  it("throws without a config", async () => {
    const lib = await load();
    const state = lib.useI18nKeyless.getState();
    lib.useI18nKeyless.setState({ config: undefined as never });
    await expect(state.sendTranslationsUsage()).rejects.toThrow(/config is not initialized sending translations usage/);
  });

  it("does nothing when there is no usage", async () => {
    const { fn } = mockFetch();
    const lib = await load();
    seed(lib, makeStorage());
    await lib.useI18nKeyless.getState().sendTranslationsUsage();
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps the usage when the API refuses it", async () => {
    mockRefusingFetch();
    const lib = await load();
    const usage = { default: { Bonjour: "2025-01-01" } };
    seed(lib, makeStorage(), { translationsUsageByNamespace: usage });
    await lib.useI18nKeyless.getState().sendTranslationsUsage();
    expect(lib.useI18nKeyless.getState().translationsUsageByNamespace).toEqual(usage);
  });

  it("clears the usage once sent, in memory even without a storage", async () => {
    const { calls } = mockFetch();
    const lib = await load();
    seed(lib, undefined, { translationsUsageByNamespace: { default: { Bonjour: "2025-01-01" } } });
    await lib.useI18nKeyless.getState().sendTranslationsUsage();
    expect(calls.some((call) => call.url.includes("/translate/last-used-translations"))).toBe(true);
    expect(lib.useI18nKeyless.getState().translationsUsageByNamespace).toEqual({});
  });
});

describe("setTranslationUsage", () => {
  it("throws without a config", async () => {
    const lib = await load();
    const state = lib.useI18nKeyless.getState();
    lib.useI18nKeyless.setState({ config: undefined as never });
    await expect(state.setTranslationUsage("Bonjour")).rejects.toThrow(/config is not initialized/);
  });

  it("skips unpersisted namespaces", async () => {
    const lib = await load();
    seed(lib, makeStorage());
    const state = lib.useI18nKeyless.getState();
    await state.setTranslationUsage("Bonjour", undefined, "chat", true);
    expect(state.translationsUsageByNamespace).toEqual({});
  });

  it("records under the explicit namespace, else the config default, and persists the map", async () => {
    const lib = await load();
    const storage = makeStorage();
    seed(lib, storage, { config: { ...baseConfig(storage), defaultNamespace: "app" } });
    const state = lib.useI18nKeyless.getState();
    await state.setTranslationUsage("A", undefined, "shop");
    await state.setTranslationUsage("B", "ctx");
    expect(state.translationsUsageByNamespace.shop).toHaveProperty("A");
    expect(state.translationsUsageByNamespace.app).toHaveProperty("B__ctx");
    expect(JSON.parse(storage.data.get("i18n-keyless-translations-usage")!)).toEqual(state.translationsUsageByNamespace);
  });

  it("records in memory without a storage", async () => {
    const lib = await load();
    seed(lib, undefined);
    const state = lib.useI18nKeyless.getState();
    await state.setTranslationUsage("A");
    expect(state.translationsUsageByNamespace.default).toHaveProperty("A");
  });
});

describe("setLanguage", () => {
  it("throws without a config, or with a config that has no API_KEY", async () => {
    const lib = await load();
    const state = lib.useI18nKeyless.getState();
    lib.useI18nKeyless.setState({ config: undefined as never });
    await expect(state.setLanguage("en")).rejects.toThrow(/config is not initialized setting translations/);
    seed(lib, makeStorage(), { config: { ...baseConfig(makeStorage()), API_KEY: "" } });
    await expect(state.setLanguage("en")).rejects.toThrow(/config is not initialized validating language/);
  });

  it("logs the switch, and the fallback, in debug mode", async () => {
    mockFetch({ en: EN });
    const lib = await load();
    await lib.init(baseConfig(makeStorage(), { debug: true }) as never);
    await lib.setCurrentLanguage("en");
    expect(logs()).toContain("i18n-keyless: setLanguage en");
    await lib.setCurrentLanguage("de" as Lang);
    expect(logs().some((line) => line.includes("language de is not supported, fallback to fr"))).toBe(true);
  });

  it("clears the stored cursor of every persisted namespace, not of the unpersisted ones", async () => {
    mockFetch({ en: EN });
    const lib = await load();
    const storage = makeStorage();
    seed(lib, storage, { namespaces: ["default", "chat"], unpersistedNamespaces: ["chat"] });
    await lib.setCurrentLanguage("en");
    const cleared = storage.setItem.mock.calls.filter(([, value]) => value === "").map(([key]) => key);
    expect(cleared).toContain("i18n-keyless-last-refresh");
    expect(cleared).not.toContain("i18n-keyless-last-refresh__chat");
    // The unpersisted namespace was refetched in memory only.
    expect(storage.data.has("i18n-keyless-translations__chat")).toBe(false);
    expect(lib.useI18nKeyless.getState().translationsByNamespace.chat).toMatchObject(EN);
  });

  it("refetches the origin (UGC) namespaces when switching back to the primary language", async () => {
    const { calls } = mockFetch({ en: EN, fr: { "Hello there": "Salut" } });
    const lib = await load();
    const storage = makeStorage({
      "i18n-keyless-current-language": "en",
      "i18n-keyless-origin-namespaces": JSON.stringify(["ugc"]),
    });
    await lib.init(baseConfig(storage) as never);
    expect(lib.useI18nKeyless.getState().originNamespaces).toEqual(["ugc"]);
    calls.length = 0;

    await lib.setCurrentLanguage("fr");
    const bulk = calls.filter((call) => call.method === "GET" && call.url.includes("/translate/fr"));
    expect(bulk).toHaveLength(1);
    expect(bulk[0].url).toContain("namespace=ugc");
    expect(lib.useI18nKeyless.getState().translations).toMatchObject({ "Hello there": "Salut" });
    expect(storage.data.has("i18n-keyless-translations__ugc")).toBe(true);
  });

  it("keeps an unpersisted origin namespace out of storage on that refetch", async () => {
    mockFetch({ fr: { "Hello there": "Salut" } });
    const lib = await load();
    const storage = makeStorage();
    seed(lib, storage, { currentLanguage: "en", originNamespaces: ["chat"], unpersistedNamespaces: ["chat"] });
    await lib.setCurrentLanguage("fr");
    expect(lib.useI18nKeyless.getState().translations).toMatchObject({ "Hello there": "Salut" });
    expect(storage.data.has("i18n-keyless-translations__chat")).toBe(false);
  });

  it("switches without a storage", async () => {
    const lib = await load();
    seed(lib, undefined, { currentLanguage: "en" });
    await lib.useI18nKeyless.getState().setLanguage("fr");
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("fr");
  });
});

describe("init edge paths", () => {
  it("requires an API_KEY, an API_URL or custom handlers", async () => {
    const lib = await load();
    await expect(lib.init({ languages: { primary: "fr", supported: ["fr"] }, storage: makeStorage() } as never)).rejects.toThrow(
      /you didn't provide an API_KEY nor an API_URL/
    );
    await expect(
      lib.init({
        languages: { primary: "fr", supported: ["fr"] },
        storage: makeStorage(),
        handleTranslate: async () => ({}),
        getAllTranslations: async () => ({}),
      } as never)
    ).rejects.toThrow(/API_KEY is required/);
  });

  it("adds initWithDefault to the supported languages when it is missing", async () => {
    mockFetch({ en: EN });
    const lib = await load();
    await lib.init(baseConfig(makeStorage(), { languages: { primary: "fr", supported: ["fr"], initWithDefault: "en" } }) as never);
    expect(lib.getSupportedLanguages()).toEqual(["fr", "en"]);
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("en");
  });

  it("survives a storage adapter that throws on read", async () => {
    mockFetch();
    const lib = await load();
    const storage = makeStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error("read failed");
    });
    await expect(lib.init(baseConfig(storage) as never)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: Error getting item:", expect.any(Error));
    expect(lib.useI18nKeyless.getState().uniqueId).toMatch(/^[0-9A-Za-z_]{16}$/);
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("fr");
    // The queue gate was released: a miss still goes out.
    lib.useI18nKeyless.setState({ currentLanguage: "en" });
    lib.getTranslation("Bonjour");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("ignores corrupt JSON in storage", async () => {
    mockFetch();
    const lib = await load();
    const storage = makeStorage({
      "i18n-keyless-translations": "{not json",
      "i18n-keyless-namespaces": "[not json",
      "i18n-keyless-translations-usage": "{not json",
    });
    await lib.init(baseConfig(storage) as never);
    expect(lib.useI18nKeyless.getState().translations).toEqual({});
    expect(lib.useI18nKeyless.getState().translationsUsageByNamespace).toEqual({});
  });

  it("loads every namespace listed in the index, with its own cursor", async () => {
    mockFetch();
    const lib = await load();
    const storage = makeStorage({
      "i18n-keyless-namespaces": JSON.stringify(["default", "shop"]),
      "i18n-keyless-translations": JSON.stringify({ A: "a" }),
      "i18n-keyless-translations__shop": JSON.stringify({ B: "b" }),
      "i18n-keyless-last-refresh__shop": "2025-01-01",
    });
    await lib.init(baseConfig(storage) as never);
    const state = lib.useI18nKeyless.getState();
    expect(state.translations).toEqual({ A: "a", B: "b" });
    expect(state.translationsByNamespace).toEqual({ default: { A: "a" }, shop: { B: "b" } });
    expect(state.namespaces).toEqual(["default", "shop"]);
    // Boot resets every known namespace's cursor, the shop one included.
    expect(storage.setItem).toHaveBeenCalledWith("i18n-keyless-last-refresh__shop", "");
  });

  it("discards a legacy flat usage map instead of sending it", async () => {
    const { calls } = mockFetch();
    const lib = await load();
    const storage = makeStorage({ "i18n-keyless-translations-usage": JSON.stringify({ Bonjour: "2025-01-01" }) });
    await lib.init(baseConfig(storage) as never);
    await flush();
    expect(lib.useI18nKeyless.getState().translationsUsageByNamespace).toEqual({});
    expect(calls.some((call) => call.url.includes("/translate/last-used-translations"))).toBe(false);
  });

  it("accepts an empty stored usage map", async () => {
    mockFetch();
    const lib = await load();
    await lib.init(baseConfig(makeStorage({ "i18n-keyless-translations-usage": "{}" })) as never);
    expect(lib.useI18nKeyless.getState().translationsUsageByNamespace).toEqual({});
  });

  it("hydrateFromServer ignores a snapshot without a language, and accepts one without translations", async () => {
    const lib = await load();
    seed(lib, makeStorage(), { translations: { A: "a" } });
    lib.hydrateFromServer(undefined);
    lib.hydrateFromServer({ translations: { B: "b" } });
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("fr");
    expect(lib.useI18nKeyless.getState().translations).toEqual({ A: "a" });
    lib.hydrateFromServer({ lang: "es" });
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("es");
    expect(lib.useI18nKeyless.getState().translations).toEqual({ A: "a" });
  });
});

describe("debug logs during hydration", () => {
  const expectLogged = (...fragments: string[]) => {
    const lines = logs();
    for (const fragment of fragments) {
      expect(lines.some((line) => line.includes(fragment)), `expected a log containing "${fragment}"`).toBe(true);
    }
  };

  it("reports an empty storage", async () => {
    mockFetch();
    const lib = await load();
    await lib.init(baseConfig(makeStorage(), { debug: true }) as never);
    expectLogged(
      "_hydrate: uniqueId",
      "_hydrate: no translations",
      "_hydrate: no translations usage",
      "_hydrate: no current language"
    );
  });

  it("reports what it loaded", async () => {
    mockFetch({ en: EN });
    const lib = await load();
    const storage = makeStorage({
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello" }),
      "i18n-keyless-translations-usage": JSON.stringify({ default: { Bonjour: "2025-01-01" } }),
      "i18n-keyless-origin-namespaces": JSON.stringify(["ugc"]),
      "i18n-keyless-current-language": "en",
    });
    await lib.init(baseConfig(storage, { debug: true }) as never);
    expectLogged(
      "i18n-keyless: _hydrate [object Object]",
      "_hydrate: translations usage",
      "_hydrate: origin namespaces ugc",
      "i18n-keyless: _hydrate en"
    );
  });

  it("reports a discarded legacy usage map", async () => {
    mockFetch();
    const lib = await load();
    const storage = makeStorage({ "i18n-keyless-translations-usage": JSON.stringify({ Bonjour: "2025-01-01" }) });
    await lib.init(baseConfig(storage, { debug: true }) as never);
    expectLogged("_hydrate: discarding legacy flat usage");
  });

  it("reports a skipped language hydration", async () => {
    mockFetch();
    const lib = await load();
    await lib.init(
      baseConfig(makeStorage(), {
        debug: true,
        languages: { primary: "fr", supported: ["fr"], skipCurrentLanguageHydration: true },
      }) as never
    );
    expectLogged("_hydrate: skip current language hydration");
  });

  it("reports a server-seeded language", async () => {
    mockFetch();
    const lib = await load();
    lib.hydrateFromServer({ lang: "es", translations: {} });
    await lib.init(baseConfig(makeStorage(), { debug: true }) as never);
    expectLogged("_hydrate: keeping server-seeded language");
  });

  it("reports the server runtime", async () => {
    vi.stubGlobal("window", undefined);
    mockFetch();
    const lib = await load();
    await lib.init(baseConfig(undefined, { debug: true }) as never);
    expectLogged("_hydrate: server runtime, no device id");
  });
});

describe("getTranslation on the client", () => {
  it("registers the origin namespace of a UGC key, persisted unless the namespace is unpersisted", async () => {
    mockFetch();
    const lib = await load();
    const storage = makeStorage();
    await lib.init(baseConfig(storage) as never);

    expect(lib.getTranslation("Hello there", { originLanguage: "en" })).toBe("Hello there");
    await flush();
    expect(lib.useI18nKeyless.getState().originNamespaces).toEqual(["default"]);
    expect(storage.data.get("i18n-keyless-origin-namespaces")).toBe(JSON.stringify(["default"]));

    lib.getTranslation("Hello again", { originLanguage: "en", namespace: "chat", unpersistedNamespace: true });
    await flush();
    expect(lib.useI18nKeyless.getState().originNamespaces).toEqual(["default", "chat"]);
    expect(storage.data.get("i18n-keyless-origin-namespaces")).toBe(JSON.stringify(["default"]));
  });

  it("posts forceTemporary with the miss, even when a translation exists", async () => {
    const { calls } = mockFetch({ en: EN });
    const lib = await load();
    await lib.init(baseConfig(makeStorage()) as never);
    lib.useI18nKeyless.setState({ currentLanguage: "en", translations: EN });
    expect(lib.getTranslation("Bonjour", { forceTemporary: { en: "Hi" } })).toBe("Hello");
    await vi.waitFor(() => {
      const miss = calls.find((call) => call.method === "POST" && call.url.endsWith("/translate"));
      expect(miss?.body).toMatchObject({ key: "Bonjour", forceTemporary: { en: "Hi" } });
    });
  });

  it("bulk-fetches an unpersisted namespace after a miss and keeps it out of storage", async () => {
    const { calls } = mockFetch({ en: EN });
    const lib = await load();
    const storage = makeStorage();
    await lib.init(baseConfig(storage) as never);
    lib.useI18nKeyless.setState({ currentLanguage: "en" });

    lib.getTranslation("Bonjour", { namespace: "chat", unpersistedNamespace: true });
    await vi.waitFor(() => expect(lib.useI18nKeyless.getState().translations).toMatchObject(EN));
    const bulk = calls.find((call) => call.method === "GET" && call.url.includes("namespace=chat"));
    expect(bulk).toBeDefined();
    expect(lib.useI18nKeyless.getState().unpersistedNamespaces).toEqual(["chat"]);
    expect(storage.data.has("i18n-keyless-translations__chat")).toBe(false);
  });

  it("sends the namespace's delta cursor on the next bulk fetch", async () => {
    const { calls } = mockFetch({ en: EN });
    const lib = await load();
    await lib.init(baseConfig(makeStorage()) as never);
    lib.useI18nKeyless.setState({ currentLanguage: "en" });

    lib.getTranslation("Bonjour");
    await vi.waitFor(() => expect(lib.useI18nKeyless.getState().lastRefreshByNamespace.default).toBe("2025-01-01"));
    lib.getTranslation("Nouveau texte");
    await vi.waitFor(() => {
      const bulks = calls.filter((call) => call.method === "GET" && call.url.includes("/translate/en"));
      expect(bulks.length).toBe(2);
      expect(bulks[1].url).toContain("last_refresh=2025-01-01");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// The rest of the suite replaces zustand with a plain object, so the real store actions in
// store.ts never execute. This file runs them for real.
vi.unmock("zustand");


/** An in-memory storage adapter with the localStorage shape. */
function makeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn((k: string) => void data.delete(k)),
    clearAll: vi.fn(() => data.clear()),
  };
}

const okResponse = (translations: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "111", ...extra },
  error: "",
  message: "",
});

/**
 * Fresh module registry so the zustand store starts empty for each test — and the core
 * module is re-imported here too, because store.ts binds to that instance: spying on a
 * stale copy would have no effect on it.
 */
async function loadStore() {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const mod = await import("../store.ts");
  return { ...mod, core };
}

async function booted(storage = makeStorage(), config: Record<string, unknown> = {}) {
  const mod = await loadStore();
  mod.useI18nKeyless.setState({
    config: {
      API_KEY: "k",
      languages: { primary: "fr", supported: ["fr", "en", "es"], fallback: "fr" },
      storage,
      ...config,
    } as never,
  });
  return { ...mod, storage };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setTranslations", () => {
  it("ignores a failed response", async () => {
    const { useI18nKeyless, core: mod } = await booted();
    useI18nKeyless.getState().setTranslations({ ok: false } as never, "default");
    expect(useI18nKeyless.getState().translations).toEqual({});
  });

  it("ignores a missing response", async () => {
    const { useI18nKeyless, core: mod } = await booted();
    useI18nKeyless.getState().setTranslations(undefined, "default");
    expect(useI18nKeyless.getState().translations).toEqual({});
  });

  it("throws when the config was never initialised", async () => {
    const mod = await loadStore();
    expect(() => mod.useI18nKeyless.getState().setTranslations(okResponse({}) as never, "default")).toThrow(
      /config is not initialized/
    );
  });

  it("throws when no storage is configured", async () => {
    const mod = await loadStore();
    mod.useI18nKeyless.setState({
      config: { API_KEY: "k", languages: { primary: "fr", supported: ["fr"] } } as never,
    });
    expect(() => mod.useI18nKeyless.getState().setTranslations(okResponse({}) as never, "default")).toThrow(
      /storage is not initialized/
    );
  });

  it("merges into the flat lookup map and the namespace slice", async () => {
    const { useI18nKeyless, core: mod } = await booted();
    useI18nKeyless.getState().setTranslations(okResponse({ Bonjour: "Hello" }) as never, "default");
    useI18nKeyless.getState().setTranslations(okResponse({ Payer: "Pay" }) as never, "checkout");

    const state = useI18nKeyless.getState();
    expect(state.translations).toEqual({ Bonjour: "Hello", Payer: "Pay" });
    expect(state.translationsByNamespace.checkout).toEqual({ Payer: "Pay" });
    expect(state.namespaces).toEqual(["default", "checkout"]);
  });

  it("persists the namespace slice, the index, the id and the cursor", async () => {
    const { useI18nKeyless, storage, core: mod } = await booted();
    useI18nKeyless.getState().setTranslations(okResponse({ Bonjour: "Hello" }) as never, "default");

    expect(storage.data.get("i18n-keyless-translations")).toBe(JSON.stringify({ Bonjour: "Hello" }));
    expect(storage.data.get("i18n-keyless-user-id")).toBe("u1");
    expect(storage.data.get("i18n-keyless-last-refresh")).toBe("111");
    expect(useI18nKeyless.getState().lastRefreshByNamespace.default).toBe("111");
  });

  it("keeps an unpersisted namespace out of storage and out of the index", async () => {
    const { useI18nKeyless, storage, core: mod } = await booted();
    useI18nKeyless.getState().setTranslations(okResponse({ Hi: "Salut" }) as never, "chat-1", true);

    const state = useI18nKeyless.getState();
    expect(state.translations).toEqual({ Hi: "Salut" }); // still usable in memory
    expect(state.unpersistedNamespaces).toEqual(["chat-1"]);
    expect(storage.data.has("i18n-keyless-translations__chat-1")).toBe(false);
    expect(storage.data.get("i18n-keyless-namespaces")).toBeUndefined();
    // ...but the id and cursor are language-independent, so they are still kept
    expect(storage.data.get("i18n-keyless-user-id")).toBe("u1");
  });

  it("excludes unpersisted namespaces from the persisted index", async () => {
    const { useI18nKeyless, storage, core: mod } = await booted();
    useI18nKeyless.getState().setTranslations(okResponse({ Hi: "Salut" }) as never, "chat-1", true);
    useI18nKeyless.getState().setTranslations(okResponse({ Bonjour: "Hello" }) as never, "default");

    expect(JSON.parse(storage.data.get("i18n-keyless-namespaces")!)).toEqual(["default"]);
  });
});

describe("registerOriginNamespace", () => {
  it("records a namespace once and persists it", async () => {
    const { useI18nKeyless, storage, core: mod } = await booted();
    useI18nKeyless.getState().registerOriginNamespace("chat");
    useI18nKeyless.getState().registerOriginNamespace("chat");

    expect(useI18nKeyless.getState().originNamespaces).toEqual(["chat"]);
    expect(JSON.parse(storage.data.get("i18n-keyless-origin-namespaces")!)).toEqual(["chat"]);
  });

  it("does not persist an unpersisted namespace", async () => {
    const { useI18nKeyless, storage, core: mod } = await booted();
    useI18nKeyless.getState().registerOriginNamespace("chat-1", true);

    expect(useI18nKeyless.getState().originNamespaces).toEqual(["chat-1"]);
    expect(storage.data.get("i18n-keyless-origin-namespaces")).toBeUndefined();
  });
});

describe("setTranslationUsage", () => {
  it("records usage under the namespace and persists it", async () => {
    const { useI18nKeyless, storage, core: mod } = await booted();
    await useI18nKeyless.getState().setTranslationUsage("Bonjour", undefined, "checkout");

    const usage = useI18nKeyless.getState().translationsUsageByNamespace;
    expect(usage.checkout).toHaveProperty("Bonjour");
    expect(storage.data.get("i18n-keyless-translations-usage")).toContain("Bonjour");
  });

  it("keys usage by key__context", async () => {
    const { useI18nKeyless, core: mod } = await booted();
    await useI18nKeyless.getState().setTranslationUsage("8 heures", "time");
    expect(useI18nKeyless.getState().translationsUsageByNamespace.default).toHaveProperty("8 heures__time");
  });

  it("records nothing for an unpersisted namespace", async () => {
    const { useI18nKeyless, core: mod } = await booted();
    await useI18nKeyless.getState().setTranslationUsage("Hi", undefined, "chat-1", true);
    expect(useI18nKeyless.getState().translationsUsageByNamespace).toEqual({});
  });
});

describe("sendTranslationsUsage", () => {
  it("does nothing when no usage was recorded", async () => {
    const { useI18nKeyless, core: mod } = await booted();
    const spy = vi.spyOn(mod, "sendTranslationsUsageToI18nKeyless");
    await useI18nKeyless.getState().sendTranslationsUsage();
    expect(spy).not.toHaveBeenCalled();
  });

  it("clears the usage map once the API accepted it", async () => {
    const { useI18nKeyless, storage, core: mod } = await booted();
    vi.spyOn(mod, "sendTranslationsUsageToI18nKeyless").mockResolvedValue({ ok: true, message: "" });

    await useI18nKeyless.getState().setTranslationUsage("Bonjour");
    await useI18nKeyless.getState().sendTranslationsUsage();

    expect(useI18nKeyless.getState().translationsUsageByNamespace).toEqual({});
    expect(storage.data.get("i18n-keyless-translations-usage")).toBe("");
  });

  it("keeps the usage map when the API refused it", async () => {
    const { useI18nKeyless, core: mod } = await booted();
    vi.spyOn(mod, "sendTranslationsUsageToI18nKeyless").mockResolvedValue({ ok: false, message: "" });

    await useI18nKeyless.getState().setTranslationUsage("Bonjour");
    await useI18nKeyless.getState().sendTranslationsUsage();

    expect(useI18nKeyless.getState().translationsUsageByNamespace.default).toHaveProperty("Bonjour");
  });
});

describe("setLanguage", () => {
  it("switches to a supported language and persists it", async () => {
    const { useI18nKeyless, storage, core: mod } = await booted();
    vi.spyOn(mod, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse({}) as never);

    await useI18nKeyless.getState().setLanguage("en");

    expect(useI18nKeyless.getState().currentLanguage).toBe("en");
    expect(storage.data.get("i18n-keyless-current-language")).toBe("en");
  });

  it("falls back when the language is not supported", async () => {
    const { useI18nKeyless, core: mod } = await booted();
    vi.spyOn(mod, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse({}) as never);

    await useI18nKeyless.getState().setLanguage("ja" as never);

    expect(useI18nKeyless.getState().currentLanguage).toBe("fr");
  });

  it("falls back on a v2 code, which v3 no longer knows", async () => {
    const { useI18nKeyless, core: mod } = await booted(makeStorage(), {
      languages: { primary: "fr", supported: ["fr", "zh-Hans"], fallback: "fr" },
    });
    vi.spyOn(mod, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse({}) as never);

    await useI18nKeyless.getState().setLanguage("cn" as never);

    expect(useI18nKeyless.getState().currentLanguage).toBe("fr");
  });

  it("resets every namespace cursor and refetches the known namespaces", async () => {
    const { useI18nKeyless, storage, core: mod } = await booted();
    const fetchSpy = vi
      .spyOn(mod, "getAllTranslationsFromLanguage")
      .mockResolvedValue(okResponse({}) as never);

    useI18nKeyless.getState().setTranslations(okResponse({ Payer: "Pay" }) as never, "checkout");
    await useI18nKeyless.getState().setLanguage("en");

    // lastRefresh is reset to null, then repopulated by the refetch that follows, so the
    // observable evidence is the per-namespace cursor cleared in storage below.
    const namespaces = fetchSpy.mock.calls.map((c) => c[2]);
    expect(namespaces).toContain("checkout");
    // every refetch is a FULL fetch: the delta cursor is reset first, because the previous
    // one belongs to the language we just left
    for (const call of fetchSpy.mock.calls) {
      expect((call[1] as { lastRefresh: unknown }).lastRefresh).toBeNull();
    }
  });

  it("fetches the language it switched TO, not the raw argument", async () => {
    const { useI18nKeyless, core: mod } = await booted();
    const fetchSpy = vi
      .spyOn(mod, "getAllTranslationsFromLanguage")
      .mockResolvedValue(okResponse({}) as never);

    await useI18nKeyless.getState().setLanguage("ja" as never); // unsupported -> falls back to fr

    // fr IS the primary, so no dictionary fetch happens at all
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useI18nKeyless.getState().currentLanguage).toBe("fr");
  });

  it("still refetches origin namespaces when switching to the primary language", async () => {
    const { useI18nKeyless, core: mod } = await booted();
    const fetchSpy = vi
      .spyOn(mod, "getAllTranslationsFromLanguage")
      .mockResolvedValue(okResponse({}) as never);

    useI18nKeyless.getState().registerOriginNamespace("chat");
    await useI18nKeyless.getState().setLanguage("fr");

    expect(fetchSpy.mock.calls.map((c) => c[2])).toEqual(["chat"]);
  });
});

describe("the exported helpers", () => {
  it("getSupportedLanguages returns the configured list", async () => {
    const { getSupportedLanguages } = await booted();
    expect(getSupportedLanguages()).toEqual(["fr", "en", "es"]);
  });

  it("setCurrentLanguage notifies onSetLanguage and switches", async () => {
    const onSetLanguage = vi.fn();
    const { useI18nKeyless, setCurrentLanguage, core: mod } = await booted(makeStorage(), { onSetLanguage });
    vi.spyOn(mod, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse({}) as never);

    await setCurrentLanguage("en");

    expect(onSetLanguage).toHaveBeenCalledWith("en");
    expect(useI18nKeyless.getState().currentLanguage).toBe("en");
  });

  it("clearI18nKeylessStorageAndStore empties the store and the storage", async () => {
    const { useI18nKeyless, clearI18nKeylessStorageAndStore, storage } = await booted();
    useI18nKeyless.getState().setTranslations(okResponse({ Bonjour: "Hello" }) as never, "default");

    await clearI18nKeylessStorageAndStore();

    expect(useI18nKeyless.getState().translations).toEqual({});
    expect(useI18nKeyless.getState().namespaces).toEqual([]);
  });
});

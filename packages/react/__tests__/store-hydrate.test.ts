import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("zustand");

function makeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn((k: string) => void data.delete(k)),
  };
}

const okResponse = (translations: Record<string, string> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "111" },
  error: "",
  message: "",
});

async function load() {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const mod = await import("../store.ts");
  vi.spyOn(core, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse() as never);
  vi.spyOn(core, "sendTranslationsUsageToI18nKeyless").mockResolvedValue({ ok: true, message: "" });
  return { ...mod, core };
}

const baseConfig = (storage: unknown, extra: Record<string, unknown> = {}) => ({
  API_KEY: "k",
  languages: { primary: "fr", supported: ["fr", "en"] },
  storage,
  ...extra,
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("init validation", () => {
  it("requires languages", async () => {
    const { init } = await load();
    // @ts-expect-error invalid on purpose
    await expect(init({})).rejects.toThrow(/languages is required/);
  });

  it("requires a primary language", async () => {
    const { init } = await load();
    // @ts-expect-error invalid on purpose
    await expect(init({ languages: { supported: ["en"] } })).rejects.toThrow(/primary is required/);
  });

  it("requires an API_KEY", async () => {
    const { init } = await load();
    await expect(
      init(baseConfig(makeStorage(), { API_KEY: undefined, API_URL: "https://x" }) as never)
    ).rejects.toThrow(/API_KEY is required/);
  });

  it("defaults initWithDefault and fallback to the primary language", async () => {
    const { init, useI18nKeyless } = await load();
    const config = baseConfig(makeStorage());
    await init(config as never);

    expect(useI18nKeyless.getState().config.languages.fallback).toBe("fr");
    expect(useI18nKeyless.getState().config.languages.initWithDefault).toBe("fr");
  });

  it("adds initWithDefault to the supported list when it is missing", async () => {
    const { init, useI18nKeyless } = await load();
    await init(
      baseConfig(makeStorage(), {
        languages: { primary: "fr", supported: ["fr"], initWithDefault: "en" },
      }) as never
    );

    expect(useI18nKeyless.getState().config.languages.supported).toContain("en");
  });

  it("defaults addMissingTranslations to true", async () => {
    const { init, useI18nKeyless } = await load();
    await init(baseConfig(makeStorage()) as never);
    expect(useI18nKeyless.getState().config.addMissingTranslations).toBe(true);
  });

  it("respects addMissingTranslations set to false", async () => {
    const { init, useI18nKeyless } = await load();
    await init(baseConfig(makeStorage(), { addMissingTranslations: false }) as never);
    expect(useI18nKeyless.getState().config.addMissingTranslations).toBe(false);
  });

  it("calls onInit with the resolved language", async () => {
    const { init } = await load();
    const onInit = vi.fn();
    await init(baseConfig(makeStorage(), { onInit }) as never);
    expect(onInit).toHaveBeenCalledWith("fr");
  });
});

describe("hydrate", () => {
  it("loads the legacy default-namespace translations", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage({
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello" }),
    });

    await init(baseConfig(storage) as never);

    expect(useI18nKeyless.getState().translations).toMatchObject({ Bonjour: "Hello" });
  });

  it("loads every namespace listed in the index, and its cursor", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage({
      "i18n-keyless-namespaces": JSON.stringify(["default", "checkout"]),
      "i18n-keyless-translations": JSON.stringify({ Bonjour: "Hello" }),
      "i18n-keyless-translations__checkout": JSON.stringify({ Payer: "Pay" }),
      "i18n-keyless-last-refresh__checkout": "999",
    });

    await init(baseConfig(storage) as never);

    const state = useI18nKeyless.getState();
    expect(state.translations).toMatchObject({ Bonjour: "Hello", Payer: "Pay" });
    expect(state.namespaces).toEqual(expect.arrayContaining(["default", "checkout"]));
  });

  // Worth knowing: init ends with setLanguage(currentLanguage), which resets every delta
  // cursor. So a cursor read from storage during hydrate never survives the boot, and the
  // first fetch after a boot is always a full one.
  it("discards the hydrated delta cursors during the boot setLanguage", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage({
      "i18n-keyless-namespaces": JSON.stringify(["checkout"]),
      "i18n-keyless-translations__checkout": JSON.stringify({ Payer: "Pay" }),
      "i18n-keyless-last-refresh__checkout": "999",
    });

    await init(baseConfig(storage) as never);

    expect(useI18nKeyless.getState().lastRefreshByNamespace.checkout).toBeUndefined();
  });

  it("restores the persisted origin namespaces", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage({
      "i18n-keyless-origin-namespaces": JSON.stringify(["chat"]),
    });

    await init(baseConfig(storage) as never);

    expect(useI18nKeyless.getState().originNamespaces).toEqual(["chat"]);
  });

  it("restores namespaced usage and reports it straight away", async () => {
    const { init, core } = await load();
    const spy = vi
      .spyOn(core, "sendTranslationsUsageToI18nKeyless")
      .mockResolvedValue({ ok: true, message: "" });
    const storage = makeStorage({
      "i18n-keyless-translations-usage": JSON.stringify({ default: { Bonjour: "2026-08-04" } }),
    });

    await init(baseConfig(storage) as never);

    // hydrated, then flushed on boot: the map is cleared once the API accepts it
    expect(spy).toHaveBeenCalledWith(
      { default: { Bonjour: "2026-08-04" } },
      expect.anything()
    );
  });

  it("discards a pre-2.4.0 flat usage map rather than sending a malformed body", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage({
      "i18n-keyless-translations-usage": JSON.stringify({ Bonjour: "2026-08-04" }),
    });

    await init(baseConfig(storage) as never);

    expect(useI18nKeyless.getState().translationsUsageByNamespace).toEqual({});
  });

  it("restores the uniqueId, which the boot does not reset", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage({
      "i18n-keyless-user-id": "u-42",
      "i18n-keyless-last-refresh": "555",
    });

    await init(baseConfig(storage) as never);

    expect(useI18nKeyless.getState().uniqueId).toBe("u-42");
    // the global cursor, unlike the id, is cleared by the boot setLanguage
    expect(useI18nKeyless.getState().lastRefresh).toBeNull();
  });

  it("uses initWithDefault when storage holds no language", async () => {
    const { init, useI18nKeyless } = await load();
    await init(
      baseConfig(makeStorage(), {
        languages: { primary: "fr", supported: ["fr", "en"], initWithDefault: "en" },
      }) as never
    );

    expect(useI18nKeyless.getState().currentLanguage).toBe("en");
  });

  it("skips the stored language when skipCurrentLanguageHydration is set", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });

    await init(
      baseConfig(storage, {
        languages: {
          primary: "fr",
          supported: ["fr", "en"],
          initWithDefault: "fr",
          skipCurrentLanguageHydration: true,
        },
      }) as never
    );

    expect(useI18nKeyless.getState().currentLanguage).toBe("fr");
  });

  it("falls back when storage holds a code v3 no longer knows", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage({ "i18n-keyless-current-language": "cn" });

    await init(
      baseConfig(storage, {
        languages: { primary: "fr", supported: ["fr", "zh-Hans"], fallback: "fr" },
      }) as never
    );

    expect(useI18nKeyless.getState().currentLanguage).toBe("fr");
  });
});

describe("server-side rendering", () => {
  it("creates an in-memory storage when none is given and there is no window", async () => {
    const { init, useI18nKeyless } = await load();
    const originalWindow = globalThis.window;
    // @ts-expect-error simulating a server
    delete globalThis.window;

    await init({ API_KEY: "k", languages: { primary: "fr", supported: ["fr", "en"] } } as never);

    expect(useI18nKeyless.getState().config.storage).toBeDefined();
    globalThis.window = originalWindow;
  });

  it("throws when no storage is given in a browser", async () => {
    const { init } = await load();
    await expect(
      init({ API_KEY: "k", languages: { primary: "fr", supported: ["fr"] } } as never)
    ).rejects.toThrow(/storage is required/);
  });

  it("hydrateFromServer seeds the language and translations", async () => {
    const { hydrateFromServer, useI18nKeyless } = await load();

    hydrateFromServer({ lang: "en", translations: { Bonjour: "Hello" } });

    expect(useI18nKeyless.getState().currentLanguage).toBe("en");
    expect(useI18nKeyless.getState().translations).toMatchObject({ Bonjour: "Hello" });
  });

  it("hydrateFromServer ignores an empty snapshot", async () => {
    const { hydrateFromServer, useI18nKeyless } = await load();
    const before = useI18nKeyless.getState().currentLanguage;

    hydrateFromServer(undefined);
    hydrateFromServer({ translations: { Bonjour: "Hello" } });

    expect(useI18nKeyless.getState().currentLanguage).toBe(before);
  });

  it("does not send usage on the server", async () => {
    const { init, core } = await load();
    const spy = vi.spyOn(core, "sendTranslationsUsageToI18nKeyless");

    await init(baseConfig(makeStorage(), { ssr: true }) as never);

    expect(spy).not.toHaveBeenCalled();
  });
});

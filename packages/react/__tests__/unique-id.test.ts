import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("zustand");

/**
 * These tests cover the MAU over-counting bug: the API mints a brand-new billed "user" for
 * every request whose `unique_id` header is empty, and never echoes that id back on the
 * POST routes. So an empty header is not "an anonymous request", it is a new user — which
 * is how a project with under 500 real users reported 5,517 MAU.
 */

/** The alphabet and length of the id the API's own nanoid mints. */
const API_ID_SHAPE = /^[0-9A-Z_a-z]{16}$/;

/**
 * A storage adapter whose reads resolve on a later tick, like AsyncStorage on React
 * Native. The synchronous Map used elsewhere in the suite hides the boot race entirely.
 */
function makeAsyncStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: vi.fn((key: string) => new Promise<string | null>((r) => setTimeout(() => r(data.get(key) ?? null), 1))),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
}

function makeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
}

const okResponse = (translations: Record<string, string> = {}, extra: Record<string, unknown> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "server-minted-id", lastRefresh: "111", ...extra },
  error: "",
  message: "",
});

const baseConfig = (storage: unknown, extra: Record<string, unknown> = {}) => ({
  API_KEY: "k",
  languages: { primary: "fr", supported: ["fr", "en"] },
  storage,
  ...extra,
});

async function load() {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  core.resetUniqueIdState?.();
  const store = await import("../store.ts");
  return { ...store, core };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the device id", () => {
  it("is generated and persisted on the very first launch", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage();

    await init(baseConfig(storage) as never);

    const uniqueId = useI18nKeyless.getState().uniqueId;
    expect(uniqueId).toMatch(API_ID_SHAPE);
    // Persisted straight away, not only after a successful bulk fetch.
    expect(storage.data.get("i18n-keyless-user-id")).toBe(uniqueId);
  });

  it("is reused on every later launch", async () => {
    const first = await load();
    const storage = makeStorage();
    await first.init(baseConfig(storage) as never);
    const uniqueId = first.useI18nKeyless.getState().uniqueId;

    // Same device, second launch: same storage, fresh module registry.
    const second = await load();
    await second.init(baseConfig(storage) as never);

    expect(second.useI18nKeyless.getState().uniqueId).toBe(uniqueId);
    expect(storage.data.get("i18n-keyless-user-id")).toBe(uniqueId);
  });

  it("keeps an id persisted by an older version rather than minting a new one", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage({ "i18n-keyless-user-id": "legacyServerId1" });

    await init(baseConfig(storage) as never);

    expect(useI18nKeyless.getState().uniqueId).toBe("legacyServerId1");
  });

  it("replaces a corrupted persisted value instead of sending it as a header", async () => {
    const { init, useI18nKeyless } = await load();
    const storage = makeStorage({ "i18n-keyless-user-id": "broken\nid" });

    await init(baseConfig(storage) as never);

    expect(useI18nKeyless.getState().uniqueId).toMatch(API_ID_SHAPE);
    expect(storage.data.get("i18n-keyless-user-id")).toMatch(API_ID_SHAPE);
  });
});

describe("the boot race", () => {
  it("holds a miss fired during hydration until the stored id is known", async () => {
    const { init, useI18nKeyless, getTranslation, core } = await load();
    const fetchTranslation = vi.spyOn(core.api, "fetchTranslation").mockResolvedValue({ ok: true } as never);
    vi.spyOn(core, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse() as never);
    vi.spyOn(core, "sendTranslationsUsageToI18nKeyless").mockResolvedValue({ ok: true, message: "" });
    const storage = makeAsyncStorage({
      "i18n-keyless-user-id": "storedDeviceId12",
      "i18n-keyless-current-language": "en",
    });

    // init() is in flight — device storage is async, but the UI is already mounted and a
    // <T> misses. This is the launch-time window that used to leak a throwaway user.
    const booting = init(baseConfig(storage) as never);
    useI18nKeyless.setState({ currentLanguage: "en" });
    getTranslation("Bonjour");
    expect(fetchTranslation).not.toHaveBeenCalled();

    await booting;
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchTranslation).toHaveBeenCalled();
    for (const call of fetchTranslation.mock.calls) {
      expect((call[1].headers as Record<string, string>).unique_id).toBe("storedDeviceId12");
    }
  });

  it("gives one launch exactly one id across every request it makes", async () => {
    const { init, useI18nKeyless, getTranslation, core } = await load();
    const fetchTranslation = vi.spyOn(core.api, "fetchTranslation").mockResolvedValue({ ok: true } as never);
    const fetchAll = vi
      .spyOn(core.api, "fetchTranslationsForOneLanguage")
      .mockResolvedValue(okResponse({ Bonjour: "Hello" }) as never);
    const postUsage = vi
      .spyOn(core.api, "postLastUsedTranslations")
      .mockResolvedValue({ ok: true, message: "" } as never);
    const storage = makeAsyncStorage({ "i18n-keyless-current-language": "en" });

    const booting = init(baseConfig(storage) as never);
    useI18nKeyless.setState({ currentLanguage: "en" });
    getTranslation("Bonjour");
    getTranslation("Bonsoir");
    await booting;
    await new Promise((r) => setTimeout(r, 50));
    await useI18nKeyless.getState().sendTranslationsUsage();

    const headerOf = (call: [string, RequestInit]) => (call[1].headers as Record<string, string>).unique_id;
    const calls = [
      ...(fetchTranslation.mock.calls as Array<[string, RequestInit]>),
      ...(fetchAll.mock.calls as Array<[string, RequestInit]>),
      ...(postUsage.mock.calls as Array<[string, RequestInit]>),
    ];
    expect(calls.length).toBeGreaterThan(1);
    // One launch, one user — no matter how many requests it took.
    expect(new Set(calls.map(headerOf)).size).toBe(1);
    expect(new Set(calls.map(headerOf)).has("")).toBe(false);
  });

  it("lifts the hold once booted, so later misses are not delayed", async () => {
    const { init, useI18nKeyless, getTranslation, core } = await load();
    const fetchTranslation = vi.spyOn(core.api, "fetchTranslation").mockResolvedValue({ ok: true } as never);
    vi.spyOn(core, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse() as never);
    vi.spyOn(core, "sendTranslationsUsageToI18nKeyless").mockResolvedValue({ ok: true, message: "" });
    const storage = makeAsyncStorage({ "i18n-keyless-user-id": "storedDeviceId12" });

    await init(baseConfig(storage) as never);

    // Nothing is holding any more: the queue cannot be left waiting on a gate no one opens.
    expect(core.whenUniqueIdIsKnown()).toBeNull();

    useI18nKeyless.setState({ currentLanguage: "en" });
    getTranslation("Plus tard");
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchTranslation).toHaveBeenCalled();
    expect((fetchTranslation.mock.calls[0][1].headers as Record<string, string>).unique_id).toBe("storedDeviceId12");
  });
});

describe("on the server", () => {
  it("adopts the server id only when the device has none", async () => {
    const { useI18nKeyless } = await load();
    const storage = makeStorage();
    useI18nKeyless.setState({
      uniqueId: null,
      config: baseConfig(storage) as never,
    });

    useI18nKeyless.getState().setTranslations(okResponse({ Bonjour: "Hello" }) as never, "default");

    expect(useI18nKeyless.getState().uniqueId).toBe("server-minted-id");
    expect(storage.data.get("i18n-keyless-user-id")).toBe("server-minted-id");
  });

  it("ignores the server id once the device has one", async () => {
    const { init, useI18nKeyless, core } = await load();
    vi.spyOn(core, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse() as never);
    vi.spyOn(core, "sendTranslationsUsageToI18nKeyless").mockResolvedValue({ ok: true, message: "" });
    const storage = makeStorage({ "i18n-keyless-user-id": "deviceIdABCDEF12" });
    await init(baseConfig(storage) as never);

    // A response carrying a different id must not swap this device's identity: that would
    // be a new billed user for the same install.
    useI18nKeyless.getState().setTranslations(okResponse({ Bonjour: "Hello" }) as never, "default");

    expect(useI18nKeyless.getState().uniqueId).toBe("deviceIdABCDEF12");
    expect(storage.data.get("i18n-keyless-user-id")).toBe("deviceIdABCDEF12");
  });

  it("ignores it on the unpersisted-namespace path too", async () => {
    const { init, useI18nKeyless, core } = await load();
    vi.spyOn(core, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse() as never);
    vi.spyOn(core, "sendTranslationsUsageToI18nKeyless").mockResolvedValue({ ok: true, message: "" });
    const storage = makeStorage({ "i18n-keyless-user-id": "deviceIdABCDEF12" });
    await init(baseConfig(storage) as never);

    useI18nKeyless.getState().setTranslations(okResponse({ Salut: "Hi" }) as never, "chat", true);

    expect(useI18nKeyless.getState().uniqueId).toBe("deviceIdABCDEF12");
  });
});

describe("the sdk header", () => {
  it("labels a browser / React Native app as react-client and sends its id", async () => {
    const { init, useI18nKeyless, getTranslation, core } = await load();
    const fetchTranslation = vi.spyOn(core.api, "fetchTranslation").mockResolvedValue({ ok: true } as never);
    vi.spyOn(core, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse() as never);
    vi.spyOn(core, "sendTranslationsUsageToI18nKeyless").mockResolvedValue({ ok: true, message: "" });
    const storage = makeStorage({ "i18n-keyless-user-id": "deviceIdABCDEF12" });

    await init(baseConfig(storage) as never);
    useI18nKeyless.setState({ currentLanguage: "en" });
    getTranslation("Bonjour");
    await new Promise((r) => setTimeout(r, 10));

    const headers = fetchTranslation.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.sdk).toBe("react-client");
    expect(headers.unique_id).toBe("deviceIdABCDEF12");
  });

  it("labels an SSR render as react-server and sends no device id", async () => {
    const { init, core } = await load();
    vi.spyOn(core, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse() as never);
    const realWindow = globalThis.window;
    // @ts-expect-error simulating a server runtime
    delete globalThis.window;
    try {
      await init(baseConfig(makeStorage()) as never);
      // An SSR render is a server, not a device: counting it per render would bill one
      // "user" per page view. The API counts the server's source IP instead.
      expect(core.getSdkRuntime()).toBe("react-server");
      expect(core.identityHeaders()).toEqual({ sdk: "react-server" });
    } finally {
      Object.defineProperty(globalThis, "window", { value: realWindow, configurable: true, writable: true });
    }
  });

  it("labels an explicit ssr: true config as react-server, even in a DOM", async () => {
    const { init, useI18nKeyless, core } = await load();
    vi.spyOn(core, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse() as never);

    await init(baseConfig(makeStorage(), { ssr: true }) as never);

    expect(core.getSdkRuntime()).toBe("react-server");
    expect(useI18nKeyless.getState().uniqueId).toBeNull();
  });

  it("does not persist a server-echoed id on a server", async () => {
    const { init, useI18nKeyless, core } = await load();
    vi.spyOn(core, "getAllTranslationsFromLanguage").mockResolvedValue(okResponse() as never);
    const storage = makeStorage();
    await init(baseConfig(storage, { ssr: true }) as never);

    useI18nKeyless.getState().setTranslations(okResponse({ Bonjour: "Hello" }) as never, "default");

    expect(storage.data.get("i18n-keyless-user-id")).toBeUndefined();
    expect(useI18nKeyless.getState().uniqueId).toBeNull();
  });
});

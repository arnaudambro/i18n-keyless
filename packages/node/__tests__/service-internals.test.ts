import { describe, it, expect, vi, beforeEach } from "vitest";

const okAll = (translations: Record<string, Record<string, string>> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "1" },
  error: "",
  message: "",
});
const okOne = (translation: Record<string, string>, message = "") => ({
  ok: true,
  data: { translation },
  error: "",
  message,
});
const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function load(extra: Record<string, unknown> = {}, boot = okAll()) {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const service = await import("../service.ts");
  vi.spyOn(core.api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(boot as never);
  await service.init({
    languages: { primary: "fr", supported: ["en", "es"] },
    API_KEY: "k",
    ...extra,
  } as never);
  return { service, api: core.api, queue: core.queue };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the POST body", () => {
  it("carries the key, the project languages and the primary language", async () => {
    const { service, api } = await load();
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello" }) as never);

    await service.awaitForTranslation("Bonjour", "en");

    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ key: "Bonjour", languages: ["en", "es"], primaryLanguage: "fr" });
  });

  it("omits the default namespace, and sends an explicit one", async () => {
    const { service, api } = await load();
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello" }) as never);

    await service.awaitForTranslation("Bonjour", "en");
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string).namespace).toBeUndefined();

    await service.awaitForTranslation("Payer", "en", { namespace: "checkout" });
    expect(JSON.parse((spy.mock.calls[1][1] as RequestInit).body as string).namespace).toBe("checkout");
  });

  it("carries the origin language for UGC", async () => {
    const { service, api } = await load();
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello world" }) as never);

    await service.awaitForTranslation("Hola mundo", "en", { originLanguage: "es" });

    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string).originLanguage).toBe("es");
  });

  it("uses a custom API_URL", async () => {
    const { service, api } = await load({ API_URL: "https://self.hosted" });
    const spy = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello" }) as never);

    await service.awaitForTranslation("Bonjour", "en");

    expect(spy.mock.calls[0][0]).toBe("https://self.hosted/translate");
  });

  it("surfaces a server message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, api } = await load();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello" }, "quota low") as never);

    await service.awaitForTranslation("Bonjour", "en");

    expect(warn).toHaveBeenCalledWith("i18n-keyless: API message:", "quota low");
  });

  it("returns the key when the response lacks the requested language", async () => {
    const { service, api } = await load();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ es: "Hola" }) as never);

    await expect(service.awaitForTranslation("Bonjour", "en")).resolves.toBe("Bonjour");
  });
});

describe("debug logging", () => {
  it("logs the whole path when debug is on", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { service, api } = await load();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ es: "Hola" }) as never);

    await service.awaitForTranslation("Bonjour", "en", { debug: true });

    const logged = log.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).toContain("awaitForTranslationFn called with");
    expect(logged).toContain("not found in store");
    expect(logged).toContain("not found in API response");
  });

  it("logs the short-circuit when the key is already in the target language", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { service } = await load();

    await service.awaitForTranslation("Bonjour", "fr", { debug: true });

    expect(log.mock.calls.map((c) => String(c[0])).join(" ")).toContain("is already in");
  });

  it("logs a store hit", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { service } = await load({}, okAll({ en: { Bonjour: "Hello" } }));

    await service.awaitForTranslation("Bonjour", "en", { debug: true });

    expect(log.mock.calls.map((c) => String(c[0])).join(" ")).toContain("Translation found in store");
  });

  it("logs when a custom handler is used and when it yields nothing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handleTranslate = vi.fn().mockResolvedValue(okOne({}));
    const { service } = await load({ handleTranslate });

    await service.awaitForTranslation("Bonjour", "en", { debug: true });

    expect(log.mock.calls.map((c) => String(c[0])).join(" ")).toContain("Using handleTranslate");
    expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).toContain("still not found after handleTranslate");
  });

  it("logs when a custom handler DOES populate the store", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const handleTranslate = vi.fn().mockResolvedValue(okOne({ en: "Hello" }));
    const { service } = await load({ handleTranslate });

    await expect(service.awaitForTranslation("Bonjour", "en", { debug: true })).resolves.toBe("Hello");
    expect(log.mock.calls.map((c) => String(c[0])).join(" ")).toContain("after handleTranslate");
  });
});

describe("the queue's bulk refetch handler", () => {
  // `service.ts` used to subscribe to the shared queue's "empty" event and refetch every
  // namespace returned by `getNamespacesToFetchAfterTranslationFinished()`. That map is
  // only ever populated by core's `translateKey`, and the node package never calls it:
  // `awaitForTranslation` fetches directly. The handler was dead code and is gone; this
  // test pins the contract that an "empty" event triggers no bulk refetch from node.
  it("never refetches, because node never registers a namespace on the shared queue", async () => {
    const { service, api, queue } = await load();
    vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Hello" }) as never);
    const bulk = vi
      .spyOn(api, "fetchAllTranslationsForAllLanguages")
      .mockResolvedValue(okAll({ en: { Autre: "Other" } }) as never);

    await service.awaitForTranslation("Bonjour", "en");
    queue.emit("empty");
    await flush();

    expect(bulk).not.toHaveBeenCalled();
  });
});

describe("usage flush debounce", () => {
  it("schedules exactly one flush for a burst of translations", async () => {
    vi.useFakeTimers();
    const { service, api } = await load({}, okAll({ en: { A: "a", B: "b", C: "c" } }));
    const spy = vi
      .spyOn(api, "postLastUsedTranslations")
      .mockResolvedValue({ ok: true, message: "" } as never);

    await service.awaitForTranslation("A", "en");
    await service.awaitForTranslation("B", "en");
    await service.awaitForTranslation("C", "en");

    await vi.advanceTimersByTimeAsync(11_000);
    vi.useRealTimers();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { load, mockFetch, baseConfig, flush, type FetchCall } from "./helpers.ts";

type Lib = Awaited<ReturnType<typeof load>>;

let lib: Lib;

/** The store as `init()` leaves it, minus the network: a French-primary project. */
function seed(overrides: Record<string, unknown> = {}) {
  lib.useI18nKeyless.setState({
    config: baseConfig(lib.createMemoryStorage()) as never,
    currentLanguage: "fr",
    translations: {},
    ...overrides,
  });
}

/** A GET dictionary fetch that always answers `{ ok: false }`: the shape
 * `getAllTranslationsFromLanguage` catches and resolves `void` for, so the settle it
 * guards still runs (see store.ts's `queue.on("empty")`) even though nothing merges. */
function mockFetchWithFailingBulk() {
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
      json = { ok: false, error: "network disabled for this test" };
    }
    return { status: 200, headers: { get: () => null }, json: async () => json };
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockFetch();
  lib = await load();
  seed();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const Probe = defineComponent({
  setup() {
    const { text, status, sourceText } = lib.useTranslationStatus("Bonjour");
    return () =>
      h("p", [
        h("span", { id: "text" }, text.value),
        h("span", { id: "status" }, status.value),
        h("span", { id: "source" }, sourceText.value),
      ]);
  },
});

describe("useTranslationStatus()", () => {
  it("is ready in the key's own language (the primary), no request needed", () => {
    const { calls } = mockFetch();
    seed(); // currentLanguage "fr" === the primary
    const wrapper = mount(Probe);
    expect(wrapper.find("#status").text()).toBe("ready");
    expect(wrapper.find("#text").text()).toBe("Bonjour");
    expect(wrapper.find("#source").text()).toBe("Bonjour");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("trims sourceText the same way the storage key is trimmed", () => {
    seed();
    const Fixture = defineComponent({
      setup() {
        const { sourceText } = lib.useTranslationStatus(" Bonjour ");
        return () => h("span", sourceText.value);
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mount(Fixture).text()).toBe("Bonjour");
  });

  it("flips pending -> ready once the miss is queued and the bulk fetch merges the cell", async () => {
    mockFetch({ en: { Bonjour: "Hello" } });
    seed({ currentLanguage: "en" });
    const wrapper = mount(Probe);
    expect(wrapper.find("#status").text()).toBe("pending");
    expect(wrapper.find("#text").text()).toBe("Bonjour");
    await vi.waitFor(() => expect(wrapper.find("#status").text()).toBe("ready"));
    expect(wrapper.find("#text").text()).toBe("Hello");
  });

  it("is unavailable once the fetch that would settle it fails, never stuck pending", async () => {
    mockFetchWithFailingBulk();
    seed({ currentLanguage: "en" });
    const wrapper = mount(Probe);
    expect(wrapper.find("#status").text()).toBe("pending");
    await vi.waitFor(() => expect(wrapper.find("#status").text()).toBe("unavailable"));
    // Still falls back to the source text, exactly as an unresolved miss always has.
    expect(wrapper.find("#text").text()).toBe("Bonjour");
  });

  it("primary en, target fr: pending while queued, ready once the translation lands", async () => {
    mockFetch({ fr: { Hello: "Bonjour" } });
    seed({
      config: baseConfig(lib.createMemoryStorage(), { languages: { primary: "en", supported: ["en", "fr"] } }) as never,
      currentLanguage: "fr",
      translations: {},
    });
    const EnPrimary = defineComponent({
      setup() {
        const { text, status } = lib.useTranslationStatus("Hello");
        return () => h("p", [h("span", { id: "text" }, text.value), h("span", { id: "status" }, status.value)]);
      },
    });
    const wrapper = mount(EnPrimary);
    expect(wrapper.find("#status").text()).toBe("pending");
    await vi.waitFor(() => expect(wrapper.find("#status").text()).toBe("ready"));
    expect(wrapper.find("#text").text()).toBe("Bonjour");
  });

  it("primary en, viewed in en: ready with no request", () => {
    const { calls } = mockFetch();
    seed({
      config: baseConfig(lib.createMemoryStorage(), { languages: { primary: "en", supported: ["en", "fr"] } }) as never,
      currentLanguage: "en",
      translations: {},
    });
    const wrapper = mount(Probe);
    expect(wrapper.find("#status").text()).toBe("ready");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("is unavailable on a server runtime, never pending, even though the miss is still marked", async () => {
    // No cell ever arrives for "en" here, so rule 2 (a landed cell) never overrides rule 4:
    // the only way to observe "never pending" is a status that stays "unavailable" throughout.
    mockFetch({ en: {} });
    seed({ currentLanguage: "en" });
    lib.core.setSdkRuntime("vue-server");
    const wrapper = mount(Probe);
    expect(wrapper.find("#status").text()).toBe("unavailable");
    // The mark itself is untouched by the runtime (only the derived status is masked): the
    // queue still drains and the namespace still settles, same as on a device.
    expect(lib.core.isTranslationPending("default", "Bonjour")).toBe(true);
    await flush();
    await flush();
    expect(wrapper.find("#status").text()).toBe("unavailable");
  });
});

describe("useI18nKeyless().tStatus", () => {
  it("mirrors t()'s resolution: pending while a miss is queued, ready once it lands", async () => {
    mockFetch({ en: { Bonjour: "Hello" } });
    seed({ currentLanguage: "en" });
    const wrapper = mount({
      setup() {
        const { t, tStatus } = lib.useI18nKeyless();
        return () => h("p", [h("span", { id: "text" }, t("Bonjour")), h("span", { id: "status" }, tStatus("Bonjour"))]);
      },
    });
    expect(wrapper.find("#status").text()).toBe("pending");
    await vi.waitFor(() => expect(wrapper.find("#status").text()).toBe("ready"));
    expect(wrapper.find("#text").text()).toBe("Hello");
  });

  it("is ready under the provider when the current language is the source language", () => {
    const wrapper = mount({
      render: () =>
        h(lib.I18nKeylessProvider, { lang: "en", primary: "en", translations: {} }, () =>
          h(
            defineComponent({
              setup() {
                const { tStatus } = lib.useI18nKeyless();
                return () => h("span", tStatus("Hello"));
              },
            })
          )
        ),
    });
    expect(wrapper.text()).toBe("ready");
  });
});

describe("getTranslationStatus()", () => {
  it("tracks the reactive store like getTranslation() does, once something else queues the miss", async () => {
    mockFetch({ en: { Bonjour: "Hello" } });
    seed({ currentLanguage: "en" });
    // getTranslationStatus never queues on its own (see the next test): another call queues
    // the miss first, the way a <T> or a t() elsewhere in the app normally would.
    lib.getTranslation("Bonjour");
    const wrapper = mount({ render: () => h("p", lib.getTranslationStatus("Bonjour")) });
    expect(wrapper.text()).toBe("pending");
    await vi.waitFor(() => expect(wrapper.text()).toBe("ready"));
  });

  it("never queues a request itself, even when the answer is unavailable", async () => {
    const { calls } = mockFetch({ en: {} });
    seed({ currentLanguage: "en" });
    expect(lib.getTranslationStatus("Bonjour")).toBe("unavailable");
    lib.getTranslationStatus("Bonjour");
    await flush();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("resolves against the runWithI18nKeyless request scope like getTranslation does", async () => {
    seed({ currentLanguage: "en" });
    const status = await lib.runWithI18nKeyless({ lang: "en", translations: { Bonjour: "Hello" } }, async () =>
      lib.getTranslationStatus("Bonjour")
    );
    expect(status).toBe("ready");
  });

  it("is unavailable without an API key", () => {
    seed({ config: { API_KEY: "", languages: { primary: "fr", supported: ["fr"] } } as never, currentLanguage: "en" });
    expect(lib.getTranslationStatus("Bonjour")).toBe("unavailable");
  });
});

describe("<I18nKeylessText> pending slot", () => {
  it("renders the pending slot with sourceText while pending, then the translation once it lands", async () => {
    mockFetch({ en: { Bonjour: "Hello" } });
    seed({ currentLanguage: "en" });
    const wrapper = mount({
      render: () =>
        h("p", null, [
          h(lib.I18nKeylessText, null, {
            default: () => "Bonjour",
            pending: ({ sourceText }: { sourceText: string }) => `translating: ${sourceText}`,
          }),
        ]),
    });
    expect(wrapper.text()).toBe("translating: Bonjour");
    await vi.waitFor(() => expect(wrapper.text()).toBe("Hello"));
  });

  it("without the pending slot, a pending key still renders the source text (unchanged default)", async () => {
    mockFetch({ en: { Bonjour: "Hello" } });
    seed({ currentLanguage: "en" });
    const wrapper = mount({
      render: () => h("p", null, [h(lib.I18nKeylessText, null, { default: () => "Bonjour" })]),
    });
    expect(wrapper.text()).toBe("Bonjour");
    await vi.waitFor(() => expect(wrapper.text()).toBe("Hello"));
  });

  it("the pending slot is not used once the key is ready (no request needed)", () => {
    seed(); // currentLanguage "fr" === the primary: ready immediately
    const wrapper = mount({
      render: () =>
        h("p", null, [
          h(lib.I18nKeylessText, null, { default: () => "Bonjour", pending: () => "SHOULD NOT SHOW" }),
        ]),
    });
    expect(wrapper.text()).toBe("Bonjour");
  });

  it("the pending slot renders while pending, then gives way to the source text once unavailable", async () => {
    mockFetchWithFailingBulk();
    seed({ currentLanguage: "en" });
    const wrapper = mount({
      render: () =>
        h("p", null, [
          h(lib.I18nKeylessText, null, { default: () => "Bonjour", pending: () => "SHOULD NOT SHOW" }),
        ]),
    });
    // Pending at first (the slot renders), then settles to unavailable (the slot no longer applies).
    expect(wrapper.text()).toBe("SHOULD NOT SHOW");
    await vi.waitFor(() => expect(wrapper.text()).toBe("Bonjour"));
  });
});

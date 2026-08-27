import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import { load, mockFetch, baseConfig, flush, type FetchCall } from "./helpers.ts";

type Lib = Awaited<ReturnType<typeof load>>;

const EN = { Bonjour: "Hello", "Au revoir__formel": "Goodbye", "Bonjour Anna": "Hello Anna", "Bonjour {name}": "Hello {name}" };

let lib: Lib;

function seed(overrides: Record<string, unknown> = {}) {
  lib.useI18nKeyless.setState({
    config: baseConfig(lib.createMemoryStorage()) as never,
    currentLanguage: "fr",
    translations: {},
    ...overrides,
  });
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockFetch({ en: EN });
  lib = await load();
  seed();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useI18nKeyless().t", () => {
  const Probe = defineComponent({
    setup() {
      const { t } = lib.useI18nKeyless();
      return () => h("p", t("Bonjour"));
    },
  });

  it("is reactive to the translations map and to the language", async () => {
    const wrapper = mount(Probe);
    expect(wrapper.text()).toBe("Bonjour");

    lib.useI18nKeyless.setState({ currentLanguage: "en" });
    await nextTick();
    expect(wrapper.text()).toBe("Bonjour"); // not fetched yet

    lib.useI18nKeyless.setState({ translations: { Bonjour: "Hello" } });
    await nextTick();
    expect(wrapper.text()).toBe("Hello");

    await lib.setCurrentLanguage("fr");
    await nextTick();
    expect(wrapper.text()).toBe("Bonjour");
  });

  it("takes the same options as <T>: context and replace", async () => {
    seed({ currentLanguage: "en", translations: EN });
    const wrapper = mount({
      setup() {
        const { t } = lib.useI18nKeyless();
        return () => h("p", [t("Au revoir", { context: "formel" }), " / ", t("Bonjour {name}", { replace: { "{name}": "John" } })]);
      },
    });
    expect(wrapper.text()).toBe("Goodbye / Hello John");
  });

  it("reads the provider scope when one is present", () => {
    const wrapper = mount({
      render: () => h(lib.I18nKeylessProvider, { lang: "es", translations: { Bonjour: "Hola" } }, () => h(Probe)),
    });
    expect(wrapper.text()).toBe("Hola");
  });

  it("records usage under key__context on the client", async () => {
    seed({ currentLanguage: "en", translations: EN });
    mount({
      setup() {
        const { t } = lib.useI18nKeyless();
        return () => h("p", t("Au revoir", { context: "formel" }));
      },
    });
    await vi.waitFor(() =>
      expect(lib.useI18nKeyless.getState().translationsUsageByNamespace.default).toHaveProperty("Au revoir__formel")
    );
  });

  it("exposes currentLanguage, translations and the store actions", async () => {
    seed({ currentLanguage: "en", translations: EN });
    const Fixture = (await import("./fixtures/Interpolated.vue")).default;
    const wrapper = mount(Fixture);
    expect(wrapper.find("#lang").text()).toBe("en");
    expect(wrapper.find("#t").text()).toBe("Goodbye");
    expect(wrapper.find("#slot").text()).toBe("Hello Anna");
    expect(wrapper.find("#placeholder").attributes("placeholder")).toBe("Hello Anna");

    // useTranslation follows its getter
    (wrapper.vm as unknown as { name: string }).name = "Bob";
    await nextTick();
    expect(wrapper.find("#placeholder").attributes("placeholder")).toBe("Bonjour Bob");

    await lib.setCurrentLanguage("fr");
    await nextTick();
    expect(wrapper.find("#lang").text()).toBe("fr");
    expect(wrapper.find("#t").text()).toBe("Au revoir");
  });

  it("without a provider, translations and currentLanguage are the store's", async () => {
    seed({ currentLanguage: "en", translations: EN });
    const wrapper = mount({
      setup() {
        const { currentLanguage, translations } = lib.useI18nKeyless();
        return () => h("p", `${currentLanguage.value}:${Object.keys(translations.value).length}`);
      },
    });
    expect(wrapper.text()).toBe(`en:${Object.keys(EN).length}`);
    lib.useI18nKeyless.setState({ translations: {} });
    await nextTick();
    expect(wrapper.text()).toBe("en:0");
  });

  it("carries getState / setState like a bound store", () => {
    expect(typeof lib.useI18nKeyless.getState).toBe("function");
    lib.useI18nKeyless.setState({ currentLanguage: "es" });
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("es");
    lib.useI18nKeyless.setState((state) => ({ translations: { ...state.translations, A: "B" } }));
    expect(lib.useI18nKeyless.getState().translations).toMatchObject({ A: "B" });
  });
});

describe("useTranslation()", () => {
  it("returns a computed that follows the store", async () => {
    seed({ currentLanguage: "en" });
    const wrapper = mount({
      setup() {
        const text = lib.useTranslation("Bonjour");
        return () => h("input", { placeholder: text.value });
      },
    });
    expect(wrapper.attributes("placeholder")).toBe("Bonjour");
    lib.useI18nKeyless.setState({ translations: EN });
    await nextTick();
    expect(wrapper.attributes("placeholder")).toBe("Hello");
  });
});

describe("getTranslation() in a template", () => {
  it("tracks the reactive store like any other reactive read", async () => {
    seed({ currentLanguage: "en" });
    const wrapper = mount({ render: () => h("p", lib.getTranslation("Bonjour")) });
    expect(wrapper.text()).toBe("Bonjour");
    lib.useI18nKeyless.setState({ translations: EN });
    await nextTick();
    expect(wrapper.text()).toBe("Hello");
  });
});

describe("useTranslation() edge paths", () => {
  it("warns in development about leading or trailing whitespace, once per text", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const text = ref(" Bonjour ");
    const wrapper = mount({
      setup() {
        const translated = lib.useTranslation(text);
        return () => h("p", translated.value);
      },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('" Bonjour "');
    // A store update re-evaluates the same text: no second warning.
    lib.useI18nKeyless.setState({ translations: EN });
    await nextTick();
    expect(warn).toHaveBeenCalledTimes(1);
    // A new, clean text: no warning either.
    text.value = "Bonjour";
    await nextTick();
    expect(wrapper.text()).toBe("Bonjour");
    expect(warn).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("logs the resolution with debug", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    seed({ currentLanguage: "en", translations: EN });
    mount({
      setup() {
        const { t } = lib.useI18nKeyless();
        return () => h("p", t("Bonjour", { debug: true }));
      },
    });
    const entry = log.mock.calls.map((call) => call[0]).find((arg) => arg && typeof arg === "object" && "finalText" in arg);
    expect(entry).toMatchObject({ text: "Bonjour", sourceText: "Bonjour", currentLanguage: "en", translatedText: "Hello", finalText: "Hello" });
  });

  it("keeps the placeholder when its replacement is empty", () => {
    seed({ currentLanguage: "en", translations: EN });
    const wrapper = mount({
      setup() {
        const { t } = lib.useI18nKeyless();
        return () => h("p", t("Bonjour {name}", { replace: { "{name}": "" } }));
      },
    });
    expect(wrapper.text()).toBe("Hello {name}");
  });
});

describe("useI18nKeyless() under a provider", () => {
  const Probe = defineComponent({
    setup() {
      const { t, currentLanguage, translations } = lib.useI18nKeyless();
      return () =>
        h("p", [
          h("span", { id: "lang" }, currentLanguage.value),
          h("span", { id: "keys" }, Object.keys(translations.value).join(",")),
          h("span", { id: "ugc" }, t("Hello there", { originLanguage: "en" })),
          h("span", { id: "ugc-primary" }, t("Bonjour", { originLanguage: "fr" })),
        ]);
    },
  });

  it("exposes the provider language and translations, and looks UGC keys up in the primary language", () => {
    mockFetch({ en: EN, fr: { "Hello there": "Salut" } });
    const wrapper = mount({
      render: () => h(lib.I18nKeylessProvider, { lang: "fr", translations: { "Hello there": "Salut" } }, () => h(Probe)),
    });
    expect(wrapper.find("#lang").text()).toBe("fr");
    expect(wrapper.find("#keys").text()).toBe("Hello there");
    // A UGC key written in English needs the map even though "fr" is the primary language.
    expect(wrapper.find("#ugc").text()).toBe("Salut");
    // originLanguage equal to the primary language is the regular flow: the source text.
    expect(wrapper.find("#ugc-primary").text()).toBe("Bonjour");
  });

  it("renders a UGC key as-is when the provider language is its origin language", () => {
    mockFetch({ en: EN, fr: { "Hello there": "Salut" } });
    const wrapper = mount({
      render: () => h(lib.I18nKeylessProvider, { lang: "en", translations: { "Hello there": "SHOULD NOT SHOW" } }, () => h(Probe)),
    });
    expect(wrapper.find("#ugc").text()).toBe("Hello there");
  });
});

describe("t() and useTranslation() request a miss once per instance per language", () => {
  const posts = (calls: FetchCall[], key = "Bonjour") =>
    calls.filter((call) => call.method === "POST" && call.url.endsWith("/translate") && call.body?.key === key);
  const bulks = (calls: FetchCall[], lang: string) =>
    calls.filter((call) => call.method === "GET" && call.url.includes(`/translate/${lang}`));
  const settle = async () => {
    await flush();
    await flush();
  };

  it("t() in a computed re-evaluated many times posts once", async () => {
    const { calls } = mockFetch({ en: {} });
    seed({ currentLanguage: "en" });
    const tick = ref(0);
    const wrapper = mount({
      setup() {
        const { t } = lib.useI18nKeyless();
        const label = computed(() => `${t("Bonjour")} #${tick.value}`);
        return () => h("p", label.value);
      },
    });
    for (let i = 1; i <= 5; i++) {
      tick.value = i;
      await nextTick();
    }
    await settle();
    expect(wrapper.text()).toBe("Bonjour #5");
    expect(posts(calls)).toHaveLength(1);
  });

  it("t() re-requests once after a language switch, and records usage once per language", async () => {
    const { calls } = mockFetch({ en: {}, es: {} });
    seed({ currentLanguage: "en" });
    const usageSpy = vi.spyOn(lib.useI18nKeyless.getState(), "setTranslationUsage");
    mount({
      setup() {
        const { t } = lib.useI18nKeyless();
        return () => h("p", t("Bonjour"));
      },
    });
    // Wait for the bulk fetch that follows the POST: the core drops a request for a key
    // still in flight, so the switch must come after the first round trip.
    await vi.waitFor(() => expect(bulks(calls, "en")).toHaveLength(1));
    expect(posts(calls)).toHaveLength(1);
    await lib.setCurrentLanguage("es");
    await nextTick();
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(2));
    await settle();
    expect(posts(calls)).toHaveLength(2);
    expect(usageSpy).toHaveBeenCalledTimes(2);
  });

  it("useTranslation() re-evaluated by store updates posts once", async () => {
    const { calls } = mockFetch({ en: {} });
    seed({ currentLanguage: "en" });
    const wrapper = mount({
      setup() {
        const label = lib.useTranslation("Bonjour");
        return () => h("p", label.value);
      },
    });
    for (let i = 0; i < 5; i++) {
      lib.useI18nKeyless.setState((state) => ({ translations: { ...state.translations, [`other-${i}`]: "x" } }));
      await nextTick();
    }
    await settle();
    expect(wrapper.text()).toBe("Bonjour");
    expect(posts(calls)).toHaveLength(1);
  });
});

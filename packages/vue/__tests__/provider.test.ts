import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createSSRApp, defineComponent, h, nextTick, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { load, mockFetch } from "./helpers.ts";

type Lib = Awaited<ReturnType<typeof load>>;

let lib: Lib;

// The store is pinned to the primary language ("en") with no translations, so anything a
// provider renders in another language proves the per-request scope overrides the store.
function seed(overrides: Record<string, unknown> = {}) {
  lib.useI18nKeyless.setState({
    config: {
      API_KEY: "test-api-key",
      API_URL: "http://localhost:8787",
      languages: { primary: "en", supported: ["en", "fr", "es"] },
      storage: lib.createMemoryStorage(),
    } as never,
    currentLanguage: "en",
    translations: {},
    ...overrides,
  });
}

const T = (content: string, props: Record<string, unknown> | null = null) =>
  h(lib.I18nKeylessText, props, { default: () => content });

const provided = (lang: string, translations: Record<string, string>, children: () => unknown) =>
  defineComponent({ render: () => h(lib.I18nKeylessProvider, { lang, translations }, children) });

// `t()` from the composable, the function path inside a component.
const Labels = defineComponent({
  setup() {
    const { t } = lib.useI18nKeyless();
    return () => h("span", t("Hello"));
  },
});

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

describe("<I18nKeylessProvider> on the client", () => {
  it("renders in the provider language with the provider translations, overriding the store", () => {
    const wrapper = mount(provided("es", { "Hello World": "Hola Mundo" }, () => h("p", [T("Hello World")])));
    expect(wrapper.text()).toBe("Hola Mundo");
  });

  it("renders the source text when the provider language is the primary language", () => {
    const wrapper = mount(provided("en", { "Hello World": "SHOULD NOT SHOW" }, () => T("Hello World")));
    expect(wrapper.text()).toBe("Hello World");
  });

  it("falls back to the source text when the key is missing from the provider translations", () => {
    const wrapper = mount(provided("fr", { Other: "Autre" }, () => T("Hello World")));
    expect(wrapper.text()).toBe("Hello World");
  });

  it("resolves context-specific translations from the provider (key__context)", () => {
    const wrapper = mount(provided("fr", { Welcome__header: "Bienvenue" }, () => T("Welcome", { context: "header" })));
    expect(wrapper.text()).toBe("Bienvenue");
  });

  it("provider translations win even when the store holds a different value", () => {
    seed({ currentLanguage: "fr", translations: { "Hello World": "Bonjour le monde" } });
    const wrapper = mount(provided("es", { "Hello World": "Hola Mundo" }, () => T("Hello World")));
    expect(wrapper.text()).toBe("Hola Mundo");
  });

  it("without a provider, <T> still reads from the store (SPA mode unaffected)", () => {
    seed({ currentLanguage: "fr", translations: { "Hello World": "Bonjour le monde" } });
    expect(mount({ render: () => T("Hello World") }).text()).toBe("Bonjour le monde");
  });

  it("seeds the global store with the snapshot on mount, merged into what it had", async () => {
    seed({ currentLanguage: "fr", translations: { Existing: "Déjà là" } });
    mount(provided("es", { "Hello World": "Hola Mundo" }, () => h("span", "child")));
    await nextTick();
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("es");
    expect(lib.useI18nKeyless.getState().translations).toMatchObject({ Existing: "Déjà là", "Hello World": "Hola Mundo" });
  });

  it("follows a change of the lang prop", async () => {
    const lang = ref("es");
    const wrapper = mount({
      render: () =>
        h(lib.I18nKeylessProvider, { lang: lang.value, translations: { Hello: "Hola" } }, () => T("Hello")),
    });
    expect(wrapper.text()).toBe("Hola");
    lang.value = "en";
    await nextTick();
    expect(wrapper.text()).toBe("Hello");
  });

  it("useCurrentLanguage returns the provider language under a provider, the store's without", () => {
    const Probe = defineComponent({
      setup() {
        const lang = lib.useCurrentLanguage();
        return () => h("span", lang.value ?? "");
      },
    });
    expect(mount(provided("fr", {}, () => h(Probe))).text()).toBe("fr");
    // the provider seeded the store on mount (by design): pin it back before the bare probe
    seed();
    expect(mount(Probe).text()).toBe("en");
  });
});

describe("server render (renderToString)", () => {
  it("renders the provider language on the server, and does not touch the store", async () => {
    const app = createSSRApp(
      provided("fr", { Hello: "Bonjour" }, () => [h("p", [T("Hello")]), h("input", { placeholder: "x" })])
    );
    const html = await renderToString(app);
    expect(html).toContain("<p>Bonjour</p>");
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("en");
  });

  it("renders the source text when the provider language is the real primary", async () => {
    const html = await renderToString(createSSRApp(provided("en", { Hello: "SHOULD NOT SHOW" }, () => T("Hello"))));
    expect(html).toContain("Hello");
    expect(html).not.toContain("SHOULD NOT SHOW");
  });

  it("isolates two concurrent requests through two app instances with the plugin", async () => {
    const Page = defineComponent({ render: () => h("p", [T("Hello")]) });
    const fr = createSSRApp(Page).use(lib.I18nKeyless, { lang: "fr", translations: { Hello: "Bonjour" } });
    const es = createSSRApp(Page).use(lib.I18nKeyless, { lang: "es", translations: { Hello: "Hola" } });
    const [frHtml, esHtml] = await Promise.all([renderToString(fr), renderToString(es)]);
    expect(frHtml).toContain("<p>Bonjour</p>");
    expect(esHtml).toContain("<p>Hola</p>");
  });

  it("resolves getTranslation and <T> through the runWithI18nKeyless request scope, with no provider", async () => {
    const Page = defineComponent({
      render: () => h("p", { title: lib.getTranslation("Hello") }, [T("Hello")]),
    });
    const html = await lib.runWithI18nKeyless({ lang: "fr", translations: { Hello: "Bonjour", Unused: "Inutile" } }, async () => {
      const rendered = await renderToString(createSSRApp(Page));
      return { rendered, used: lib.getUsedTranslationsSnapshot() };
    });
    expect(html.rendered).toContain('<p title="Bonjour">Bonjour</p>');
    expect(html.used).toEqual({ lang: "fr", translations: { Hello: "Bonjour" } });
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("en");
  });
});

describe("the I18nKeyless plugin", () => {
  it("provides the scope app-wide and seeds the store in the browser", () => {
    const wrapper = mount(
      { render: () => h("p", [T("Hello")]) },
      { global: { plugins: [[lib.I18nKeyless, { lang: "es", translations: { Hello: "Hola" } }]] } }
    );
    expect(wrapper.text()).toBe("Hola");
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("es");
    expect(lib.useI18nKeyless.getState().translations).toMatchObject({ Hello: "Hola" });
  });

  it("without lang, leaves the app in SPA mode against the store", () => {
    seed({ currentLanguage: "fr", translations: { Hello: "Bonjour" } });
    const wrapper = mount({ render: () => T("Hello") }, { global: { plugins: [lib.I18nKeyless] } });
    expect(wrapper.text()).toBe("Bonjour");
  });

  it("calls init with the given config", async () => {
    const storage = lib.createMemoryStorage();
    mount(
      { render: () => h("p", "x") },
      {
        global: {
          plugins: [
            [
              lib.I18nKeyless,
              { config: { API_KEY: "plugin-key", API_URL: "http://localhost:8787", languages: { primary: "fr", supported: ["fr"] }, storage } },
            ],
          ],
        },
      }
    );
    await vi.waitFor(() => expect(lib.useI18nKeyless.getState().config.API_KEY).toBe("plugin-key"));
  });
});

describe("plugin and context edge paths", () => {
  it("the plugin defaults the translations to an empty map", () => {
    seed({ currentLanguage: "fr", translations: { Hello: "Bonjour" } });
    const wrapper = mount({ render: () => h("p", [T("Hello")]) }, { global: { plugins: [[lib.I18nKeyless, { lang: "en" }]] } });
    expect(wrapper.text()).toBe("Hello");
    expect(lib.useI18nKeyless.getState().currentLanguage).toBe("en");
    // seeded with the empty default: nothing added to what the store had
    expect(lib.useI18nKeyless.getState().translations).toEqual({ Hello: "Bonjour" });
  });

  it("the plugin can leave the components unregistered", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = mount({ template: "<p><T>Hello</T></p>" }, { global: { plugins: [[lib.I18nKeyless, { registerComponents: false }]] } });
    expect(wrapper.html()).toContain("<t>");
    expect(warn.mock.calls.some((call) => String(call[0]).includes("Failed to resolve component: T"))).toBe(true);
  });

  it("useI18nKeylessContext returns null outside setup()", () => {
    expect(lib.useI18nKeylessContext()).toBeNull();
  });
});

/**
 * The store's default config has no API key and the primary "fr". A framework that
 * server-renders the components in a module graph where `init()` never ran hands the
 * provider that store. The scope carries the primary itself, so a request in the app's real
 * primary language ("en") is not mistaken for a request for the source strings, and a
 * request in "fr" (the default) is not mistaken for one either. Nothing initialises the store.
 */
describe("a store that never ran init() (a second module graph)", () => {
  const cold = () =>
    lib.useI18nKeyless.setState({
      config: { API_KEY: "", languages: { primary: "fr", supported: ["fr"] } } as never,
      currentLanguage: "fr",
      translations: {},
    });

  beforeEach(() => {
    cold();
  });

  it("renders French for an English-primary app when the provider carries the primary", async () => {
    const Page = defineComponent({
      render: () =>
        h(lib.I18nKeylessProvider, { lang: "fr", primary: "en", translations: { Hello: "Bonjour" } }, () => [
          h("p", [T("Hello")]),
          h(Labels),
        ]),
    });
    const html = await renderToString(createSSRApp(Page));
    expect(html).toContain("<p>Bonjour</p>");
    expect(html).toContain("<span>Bonjour</span>");
  });

  it("same through the plugin", async () => {
    const Page = defineComponent({ render: () => [h("p", [T("Hello")]), h(Labels)] });
    const app = createSSRApp(Page).use(lib.I18nKeyless, { lang: "fr", primary: "en", translations: { Hello: "Bonjour" } });
    const html = await renderToString(app);
    expect(html).toContain("<p>Bonjour</p>");
    expect(html).toContain("<span>Bonjour</span>");
  });

  it("renders the source text when the request language is the provider's primary", async () => {
    const html = await renderToString(
      createSSRApp(
        defineComponent({
          render: () =>
            h(lib.I18nKeylessProvider, { lang: "en", primary: "en", translations: { Hello: "SHOULD NOT SHOW" } }, () => [
              T("Hello"),
              h(Labels),
            ]),
        })
      )
    );
    expect(html).toContain("Hello");
    expect(html).not.toContain("SHOULD NOT SHOW");
  });

  it("without `primary`, falls back to the store's default and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = await renderToString(createSSRApp(provided("de", { Hello: "Hallo" }, () => T("Hello"))));
    expect(html).toContain("Hallo");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("primary");
    await renderToString(createSSRApp(provided("de", {}, () => T("Hello"))));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { h, nextTick, createCommentVNode, createTextVNode } from "vue";
import { load, mockFetch, baseConfig, flush, type FetchCall } from "./helpers.ts";

type Lib = Awaited<ReturnType<typeof load>>;

const EN = {
  Bonjour: "Hello",
  "Bonjour {name}": "Hello {name}",
  "8 heures__heure": "8 AM",
  "8 heures__durée": "8 hours",
  "8 heures": "8 o'clock",
};

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

const text = (props: Record<string, unknown> | null, content: string) =>
  mount({ render: () => h("p", null, [h(lib.I18nKeylessText, props, { default: () => content })]) });

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

describe("<I18nKeylessText>", () => {
  it("renders the source text in the primary language, as a bare text node", () => {
    const wrapper = text(null, "Bonjour");
    expect(wrapper.html()).toBe("<p>Bonjour</p>");
  });

  it("renders the source text before the translation lands, then the translation after the store update", async () => {
    seed({ currentLanguage: "en" });
    const wrapper = text(null, "Bonjour");
    expect(wrapper.text()).toBe("Bonjour");

    lib.useI18nKeyless.setState({ translations: { Bonjour: "Hello" } });
    await nextTick();
    expect(wrapper.text()).toBe("Hello");
  });

  it("stores and resolves a context under key__context", () => {
    seed({ currentLanguage: "en", translations: EN });
    expect(text({ context: "heure" }, "8 heures").text()).toBe("8 AM");
    expect(text({ context: "durée" }, "8 heures").text()).toBe("8 hours");
    expect(text(null, "8 heures").text()).toBe("8 o'clock");
  });

  it("applies replace on the translated text, with the delimiters in the keys", () => {
    seed({ currentLanguage: "en", translations: EN });
    expect(text({ replace: { "{name}": "John" } }, "Bonjour {name}").text()).toBe("Hello John");
    // and on the source text in the primary language
    seed({ currentLanguage: "fr" });
    expect(text({ replace: { "{name}": "John" } }, "Bonjour {name}").text()).toBe("Bonjour John");
  });

  it("falls back to the source text when the key is missing", () => {
    seed({ currentLanguage: "en", translations: { Other: "Autre" } });
    expect(text(null, "Bonjour").text()).toBe("Bonjour");
  });

  it("re-renders on setCurrentLanguage, with the fetched language", async () => {
    const wrapper = text(null, "Bonjour");
    expect(wrapper.text()).toBe("Bonjour");

    await lib.setCurrentLanguage("en");
    await nextTick();
    expect(wrapper.text()).toBe("Hello");

    await lib.setCurrentLanguage("fr");
    await nextTick();
    expect(wrapper.text()).toBe("Bonjour");
  });

  it("queues a miss, then picks the translation up from the bulk fetch (translate-on-miss)", async () => {
    const { calls } = mockFetch({ en: EN });
    seed({ currentLanguage: "en" });
    const wrapper = text({ context: "heure" }, "8 heures");
    expect(wrapper.text()).toBe("8 heures");

    await vi.waitFor(() => expect(wrapper.text()).toBe("8 AM"));
    const miss = calls.find((call) => call.method === "POST" && call.url.endsWith("/translate"));
    expect(miss?.body).toMatchObject({ key: "8 heures", context: "heure", primaryLanguage: "fr" });
  });

  it("trims the slot text: a multi-line SFC slot is the same key as the inline text", async () => {
    seed({ currentLanguage: "en", translations: EN });
    const Fixture = (await import("./fixtures/MultilineText.vue")).default;
    const wrapper = mount(Fixture);
    expect(wrapper.text()).toBe("Hello");
  });

  it("warns in development about leading or trailing whitespace, once per text", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    text(null, " Bonjour ");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('" Bonjour "');
    warn.mockClear();
    text(null, "Bonjour");
    expect(warn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("tracks the parent's reactive state used inside the slot", async () => {
    const Fixture = (await import("./fixtures/Interpolated.vue")).default;
    const wrapper = mount(Fixture);
    expect(wrapper.find("#slot").text()).toBe("Bonjour Anna");
    (wrapper.vm as unknown as { name: string }).name = "Bob";
    await nextTick();
    expect(wrapper.find("#slot").text()).toBe("Bonjour Bob");
  });

  it("is registered globally as <T> and <I18nKeylessText> by the plugin", () => {
    seed({ currentLanguage: "en", translations: EN });
    const wrapper = mount(
      { template: "<p><T>Bonjour</T> / <I18nKeylessText>Bonjour</I18nKeylessText></p>" },
      { global: { plugins: [lib.I18nKeyless] } }
    );
    expect(wrapper.text()).toBe("Hello / Hello");
  });
});

describe("<I18nKeylessText> slot shapes", () => {
  it("renders an empty text node when there is no slot", () => {
    const wrapper = mount({ render: () => h("p", null, [h(lib.I18nKeylessText)]) });
    expect(wrapper.html()).toBe("<p></p>");
  });

  it("ignores comments and flattens elements inside the slot", () => {
    seed({ currentLanguage: "en", translations: EN });
    const wrapper = mount({
      render: () =>
        h("p", null, [
          h(lib.I18nKeylessText, null, {
            default: () => [createCommentVNode("a comment"), h("span", [createTextVNode("Bon")]), createTextVNode("jour")],
          }),
        ]),
    });
    expect(wrapper.text()).toBe("Hello");
  });

  it("passes forceTemporary, namespace and originLanguage through to the miss", async () => {
    const { calls } = mockFetch({ en: EN });
    seed({ currentLanguage: "en" });
    text({ forceTemporary: { en: "Hi" }, namespace: "shop", originLanguage: "es" }, "Hola");
    await vi.waitFor(() => {
      const miss = calls.find((call) => call.method === "POST" && call.url.endsWith("/translate"));
      expect(miss?.body).toMatchObject({ key: "Hola", namespace: "shop", originLanguage: "es", forceTemporary: { en: "Hi" } });
    });
  });
});

describe("<I18nKeylessText> requests a miss once per instance per language", () => {
  const posts = (calls: FetchCall[], key = "Bonjour") =>
    calls.filter((call) => call.method === "POST" && call.url.endsWith("/translate") && call.body?.key === key);
  const bulks = (calls: FetchCall[], lang: string) =>
    calls.filter((call) => call.method === "GET" && call.url.includes(`/translate/${lang}`));
  /** Re-render <T> a few times through store updates that do not bring the key. */
  const churn = async (rounds = 5) => {
    for (let i = 0; i < rounds; i++) {
      lib.useI18nKeyless.setState((state) => ({ translations: { ...state.translations, [`other-${i}`]: "x" } }));
      await nextTick();
    }
    await flush();
    await flush();
  };

  it("a key the API never returns triggers one POST and one bulk fetch, across re-renders", async () => {
    const { calls } = mockFetch({ en: {} });
    seed({ currentLanguage: "en" });
    const wrapper = text(null, "Bonjour");
    await vi.waitFor(() => expect(bulks(calls, "en")).toHaveLength(1));
    await churn();
    expect(wrapper.text()).toBe("Bonjour");
    expect(posts(calls)).toHaveLength(1);
    expect(bulks(calls, "en")).toHaveLength(1);
  });

  it("a language switch re-requests once for the new language, and never again for one already requested", async () => {
    const { calls } = mockFetch({ en: {}, es: {} });
    seed({ currentLanguage: "en" });
    text(null, "Bonjour");
    // The bulk fetch follows the POST: once it is here, the core no longer holds the key
    // as "in flight" (a request for a key in flight is dropped by the core, by design).
    await vi.waitFor(() => expect(bulks(calls, "en")).toHaveLength(1));
    expect(posts(calls)).toHaveLength(1);

    await lib.setCurrentLanguage("es");
    await nextTick();
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(2));
    await churn();
    expect(posts(calls)).toHaveLength(2);

    // Back to a language this instance already requested: no new POST.
    await lib.setCurrentLanguage("en");
    await nextTick();
    await churn();
    expect(posts(calls)).toHaveLength(2);
  });

  it("forceTemporary requests once per language, even though the translation exists", async () => {
    const { calls } = mockFetch({ en: EN });
    seed({ currentLanguage: "en", translations: EN });
    const wrapper = text({ forceTemporary: { en: "Hi" } }, "Bonjour");
    expect(wrapper.text()).toBe("Hello");
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toMatchObject({ forceTemporary: { en: "Hi" } });
    await churn();
    expect(posts(calls)).toHaveLength(1);
    expect(bulks(calls, "en")).toHaveLength(1);
  });

  it("two instances of the same key each request once", async () => {
    const { calls } = mockFetch({ en: {} });
    seed({ currentLanguage: "en" });
    mount({ render: () => h("p", null, [h(lib.I18nKeylessText, null, { default: () => "Bonjour" }), h(lib.I18nKeylessText, null, { default: () => "Bonjour" })]) });
    await churn();
    // The core queue dedupes the second POST while the first is in flight; each instance asked once.
    expect(posts(calls).length).toBeGreaterThanOrEqual(1);
    expect(posts(calls).length).toBeLessThanOrEqual(2);
    expect(bulks(calls, "en").length).toBeLessThanOrEqual(2);
  });
});

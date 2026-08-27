import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { resetUniqueIdState } from "i18n-keyless-core";
import { init, setState, setCurrentLanguage, resetStore } from "../store.ts";
import { defineI18nT, I18nTElement } from "../element.ts";
import { storeKeys } from "../utils.ts";
import { makeStorage, mockFetch, flush, baseConfig, silenceConsole } from "./helpers.ts";

beforeAll(() => {
  defineI18nT();
});

beforeEach(() => {
  resetStore();
  resetUniqueIdState();
  silenceConsole();
  document.body.innerHTML = "";
});

afterEach(async () => {
  await flush();
  vi.restoreAllMocks();
});

// happy-dom (like the HTML parser) connects the element before its children exist: the
// element reads its source one microtask later, so a mount awaits that microtask.
const mount = async (html: string): Promise<I18nTElement> => {
  document.body.innerHTML = html;
  await Promise.resolve();
  return document.body.querySelector("i18n-t") as I18nTElement;
};

describe("<i18n-t>", () => {
  it("is registered once and keeps the light DOM", async () => {
    expect(customElements.get("i18n-t")).toBe(I18nTElement);
    expect(() => defineI18nT()).not.toThrow();
    const element = await mount("<i18n-t>Bonjour</i18n-t>");
    expect(element.shadowRoot).toBeNull();
  });

  it("renders the source, then the translation after a store update", async () => {
    mockFetch();
    await init(baseConfig(makeStorage()));
    const element = await mount("<p><i18n-t>Bonjour</i18n-t></p>");
    expect(element.textContent).toBe("Bonjour");

    setState({ currentLanguage: "en", translations: { Bonjour: "Hello" } });
    expect(element.textContent).toBe("Hello");
  });

  it("re-translates after setCurrentLanguage, both ways", async () => {
    mockFetch({ en: { Bonjour: "Hello" } });
    await init(baseConfig(makeStorage()));
    const element = await mount("<i18n-t>Bonjour</i18n-t>");
    expect(element.textContent).toBe("Bonjour");

    await setCurrentLanguage("en");
    expect(element.textContent).toBe("Hello");

    await setCurrentLanguage("fr");
    expect(element.textContent).toBe("Bonjour");
  });

  it("trims the source and requests the trimmed key", async () => {
    const { calls } = mockFetch({ en: { Bonjour: "Hello" } });
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    const element = await mount("<i18n-t>  Bonjour \n</i18n-t>");
    await flush();
    expect(element.textContent).toBe("Hello");
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/translate"));
    expect(post?.body?.key).toBe("Bonjour");
  });

  it("reads context and namespace attributes", async () => {
    const { calls } = mockFetch({ en: { "8 heures__durée": "8 hours" } });
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    const element = await mount('<i18n-t context="durée" namespace="time">8 heures</i18n-t>');
    await flush();
    expect(element.textContent).toBe("8 hours");
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/translate"));
    expect(post?.body).toMatchObject({ key: "8 heures", context: "durée", namespace: "time" });
  });

  it("applies the replace property", async () => {
    mockFetch();
    await init(baseConfig(makeStorage()));
    const element = await mount("<i18n-t>Bonjour {name}</i18n-t>");
    element.replace = { "{name}": "Ada" };
    expect(element.textContent).toBe("Bonjour Ada");
    setState({ currentLanguage: "en", translations: { "Bonjour {name}": "Hello {name}" } });
    expect(element.textContent).toBe("Hello Ada");
    element.replace = { "{name}": "Grace" };
    expect(element.textContent).toBe("Hello Grace");
  });

  it("unsubscribes on disconnect and resubscribes on reconnect", async () => {
    mockFetch();
    await init(baseConfig(makeStorage()));
    const element = await mount("<i18n-t>Bonjour</i18n-t>");
    element.remove();
    setState({ currentLanguage: "en", translations: { Bonjour: "Hello" } });
    expect(element.textContent).toBe("Bonjour");

    document.body.appendChild(element);
    expect(element.textContent).toBe("Hello");
    setState({ translations: { Bonjour: "Hi" } });
    expect(element.textContent).toBe("Hi");
    expect(element.text).toBe("Bonjour");
  });

  it("accepts the source through the text property", async () => {
    mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    setState({ translations: { Bonjour: "Hello" } });
    const element = document.createElement("i18n-t") as I18nTElement;
    element.text = "Bonjour";
    document.body.appendChild(element);
    expect(element.textContent).toBe("Hello");
  });
});

describe("<i18n-t> options and lifecycle", () => {
  it("exposes replace, reads the text before connect and maps the flag attributes", async () => {
    mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    const element = document.createElement("i18n-t") as I18nTElement;
    expect(element.replace).toBeUndefined();
    expect(element.text).toBe("");
    element.textContent = "Bonjour";
    expect(element.text).toBe("Bonjour");
    element.replace = { "{name}": "Ada" };
    expect(element.replace).toEqual({ "{name}": "Ada" });

    element.setAttribute("origin-language", "es");
    element.setAttribute("unpersisted-namespace", "");
    element.setAttribute("debug", "");
    expect(element.options).toEqual({
      context: undefined,
      namespace: undefined,
      originLanguage: "es",
      unpersistedNamespace: true,
      debug: true,
      replace: { "{name}": "Ada" },
    });
    element.setAttribute("unpersisted-namespace", "false");
    element.setAttribute("debug", "false");
    expect(element.options).toMatchObject({ unpersistedNamespace: false, debug: false });
  });

  it("binds right away when connected with its text already parsed", async () => {
    const { calls } = mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    setState({ translations: { Bonjour: "Hello" } });
    const element = document.createElement("i18n-t") as I18nTElement;
    element.textContent = "Bonjour";
    document.body.appendChild(element);
    // no microtask needed: the children were there on connect
    expect(element.textContent).toBe("Hello");
    expect(element.text).toBe("Bonjour");
    await flush();
    expect(calls.some((call) => call.method === "POST" && call.body?.key === "Bonjour")).toBe(false);
  });

  it("ignores the deferred read when the element left the DOM before the microtask", async () => {
    mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    setState({ translations: { Bonjour: "Hello" } });
    const element = document.createElement("i18n-t") as I18nTElement;
    document.body.appendChild(element);
    element.remove();
    element.textContent = "Bonjour";
    await Promise.resolve();
    expect(element.textContent).toBe("Bonjour");
    expect(element.text).toBe("Bonjour");
  });

  it("ignores the deferred read when a reconnect already bound the element", async () => {
    mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    setState({ translations: { Bonjour: "Hello", "Au revoir": "Goodbye" } });
    const element = document.createElement("i18n-t") as I18nTElement;
    document.body.appendChild(element);
    element.remove();
    element.textContent = "Bonjour";
    document.body.appendChild(element);
    expect(element.textContent).toBe("Hello");
    // the pending microtask of the first connect must not rebind on the translated text
    await Promise.resolve();
    expect(element.text).toBe("Bonjour");
    setState({ translations: { Bonjour: "Hi" } });
    expect(element.textContent).toBe("Hi");
  });

  it("rebinds on an attribute change only once connected and bound", async () => {
    mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    setState({ translations: { Bonjour: "Hello", "Bonjour__formel": "Good day" } });
    const element = document.createElement("i18n-t") as I18nTElement;
    element.textContent = "Bonjour";
    element.setAttribute("context", "formel");
    expect(element.textContent).toBe("Bonjour");
    document.body.appendChild(element);
    expect(element.textContent).toBe("Good day");
    element.removeAttribute("context");
    expect(element.textContent).toBe("Hello");
  });
});

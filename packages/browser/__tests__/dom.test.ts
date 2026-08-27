import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetUniqueIdState } from "i18n-keyless-core";
import { init, getState, setState, setCurrentLanguage, resetStore } from "../store.ts";
import { translateDom } from "../dom.ts";
import { storeKeys } from "../utils.ts";
import { makeStorage, mockFetch, flush, baseConfig, silenceConsole } from "./helpers.ts";

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

describe("translateDom", () => {
  it("translates data-i18n elements and keeps them updated", async () => {
    mockFetch({ en: { Bonjour: "Hello", "8 heures__durée": "8 hours", "8 heures__heure": "8 AM" } });
    await init(baseConfig(makeStorage()));
    document.body.innerHTML = `
      <h1 data-i18n>Bonjour</h1>
      <span id="duration" data-i18n data-i18n-context="durée">8 heures</span>
      <span id="time" data-i18n data-i18n-context="heure">8 heures</span>
      <p>Pas traduit</p>
    `;
    const stop = translateDom();
    const h1 = document.querySelector("h1")!;
    const duration = document.querySelector("#duration")!;
    const time = document.querySelector("#time")!;
    expect(h1.textContent).toBe("Bonjour");

    await setCurrentLanguage("en");
    expect(h1.textContent).toBe("Hello");
    expect(duration.textContent).toBe("8 hours");
    expect(time.textContent).toBe("8 AM");
    expect(document.querySelector("p")!.textContent).toBe("Pas traduit");

    // back to the source language: the WeakMap still holds the source
    await setCurrentLanguage("fr");
    expect(h1.textContent).toBe("Bonjour");
    expect(duration.textContent).toBe("8 heures");

    stop();
    setState({ currentLanguage: "en" });
    expect(h1.textContent).toBe("Bonjour");
  });

  it("requests the context and the namespace of each element", async () => {
    const { calls } = mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    document.body.innerHTML = `<span data-i18n data-i18n-context="durée" data-i18n-namespace="shop">8 heures</span>`;
    translateDom();
    await flush();
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/translate"));
    expect(post?.body).toMatchObject({ key: "8 heures", context: "durée", namespace: "shop" });
  });

  it("uses a non-empty data-i18n value as the source", async () => {
    mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    setState({ translations: { Bonjour: "Hello" } });
    document.body.innerHTML = `<span data-i18n="Bonjour">Hello (server rendered)</span>`;
    translateDom();
    expect(document.querySelector("span")!.textContent).toBe("Hello");
  });

  it("scopes to the given root, including the root itself", async () => {
    mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    setState({ translations: { Bonjour: "Hello", "Au revoir": "Goodbye" } });
    document.body.innerHTML = `
      <section id="a" data-i18n>Bonjour</section>
      <section id="b"><span data-i18n>Au revoir</span></section>
      <section id="c" data-i18n>Bonjour</section>
    `;
    translateDom(document.querySelector("#a")!);
    translateDom(document.querySelector("#b")!);
    expect(document.querySelector("#a")!.textContent).toBe("Hello");
    expect(document.querySelector("#b span")!.textContent).toBe("Goodbye");
    expect(document.querySelector("#c")!.textContent).toBe("Bonjour");
  });

  it("is idempotent: a second pass replaces the binding and keeps the source", async () => {
    mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    setState({ translations: { Bonjour: "Hello" } });
    document.body.innerHTML = `<span data-i18n>Bonjour</span>`;
    const span = document.querySelector("span")!;
    translateDom();
    expect(span.textContent).toBe("Hello");
    const stopSecond = translateDom();
    expect(span.textContent).toBe("Hello");
    await setCurrentLanguage("fr");
    expect(span.textContent).toBe("Bonjour");
    stopSecond();
    setState({ currentLanguage: "en" });
    // the first binding was replaced by the second one, which is now stopped
    expect(span.textContent).toBe("Bonjour");
  });
});

describe("translateDom options", () => {
  it("maps every data-i18n-* attribute onto the translation options", async () => {
    const { calls } = mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    document.body.innerHTML = `
      <span id="on" data-i18n data-i18n-origin-language="es" data-i18n-unpersisted-namespace data-i18n-debug>Hola</span>
      <span id="off" data-i18n data-i18n-unpersisted-namespace="false" data-i18n-debug="false" data-i18n-namespace="shop">Bonjour</span>
    `;
    translateDom();
    await flush();
    const posts = calls.filter((call) => call.method === "POST" && call.url.endsWith("/translate"));
    expect(posts.find((call) => call.body?.key === "Hola")?.body).toMatchObject({ originLanguage: "es" });
    expect(posts.find((call) => call.body?.key === "Bonjour")?.body).toMatchObject({ namespace: "shop" });
    // "false" switches the flags off: the usage of the shop key is recorded, the unpersisted one is not
    expect(getState().translationsUsageByNamespace).toEqual({ shop: { Bonjour: expect.any(String) } });
    expect(getState().unpersistedNamespaces).toEqual(["default"]);
    // debug logs the queued key
    expect(console.log).toHaveBeenCalledWith("translateKey", "Hola", undefined, "default", true);
  });

  it("falls back to the text when data-i18n is empty and the element is new", async () => {
    mockFetch();
    await init(baseConfig(makeStorage({ [storeKeys.currentLanguage]: "en" })));
    setState({ translations: { Bonjour: "Hello" } });
    document.body.innerHTML = `<span data-i18n="">Bonjour</span>`;
    translateDom();
    expect(document.querySelector("span")!.textContent).toBe("Hello");
  });

  it("does nothing on a root without data-i18n elements", async () => {
    document.body.innerHTML = `<p>Rien</p>`;
    const stop = translateDom();
    expect(() => stop()).not.toThrow();
    expect(document.body.textContent).toBe("Rien");
  });
});

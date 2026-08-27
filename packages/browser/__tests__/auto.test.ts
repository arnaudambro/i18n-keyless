import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { silenceConsole } from "./helpers.ts";

/**
 * The auto entry runs at import time, so every test re-imports it with a fresh module
 * registry. `init` and `translateDom` are doubled: the boot sequence is what is tested
 * here, the store and the DOM binder have their own suites.
 */
const mocks = vi.hoisted(() => ({
  init: vi.fn(async (_config: unknown) => {}),
  translateDom: vi.fn((_root?: ParentNode) => () => {}),
  findAutoScript: vi.fn((_moduleUrl: string) =>
    document.querySelector<HTMLScriptElement>('script[type="module"][data-i18n-auto]')
  ),
}));

vi.mock("../store.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../store.ts")>()),
  init: mocks.init,
}));
vi.mock("../dom.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dom.ts")>()),
  translateDom: mocks.translateDom,
}));
vi.mock("../auto-config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auto-config.ts")>()),
  findAutoScript: mocks.findAutoScript,
}));

const loadAuto = () => import("../auto.ts");

const addScriptTag = (attributes: Record<string, string>) => {
  const script = document.createElement("script");
  script.type = "module";
  script.src = "/dist/auto.js";
  script.dataset.i18nAuto = "";
  for (const [name, value] of Object.entries(attributes)) {
    script.setAttribute(name, value);
  }
  document.head.appendChild(script);
  return script;
};

const setReadyState = (value: DocumentReadyState) => {
  Object.defineProperty(document, "readyState", { value, configurable: true });
};

beforeEach(() => {
  vi.resetModules();
  mocks.init.mockClear();
  mocks.translateDom.mockClear();
  mocks.findAutoScript.mockClear();
  silenceConsole();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete (window as { i18nKeyless?: unknown }).i18nKeyless;
});

afterEach(() => {
  delete (document as { readyState?: DocumentReadyState }).readyState;
  vi.restoreAllMocks();
});

describe("auto entry", () => {
  it("boots from its own script tag once the DOM is parsed", async () => {
    setReadyState("loading");
    addScriptTag({
      "data-api-key": "key-1",
      "data-primary": "fr",
      "data-supported": "fr,en",
      "data-lang": "en",
      "data-namespace": "site",
    });
    const auto = await loadAuto();

    expect(mocks.findAutoScript).toHaveBeenCalledTimes(1);
    expect(mocks.findAutoScript.mock.calls[0][0]).toMatch(/\/auto\.ts$/);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledWith({
      API_KEY: "key-1",
      defaultNamespace: "site",
      languages: { primary: "fr", supported: ["fr", "en"], initWithDefault: "en" },
    });
    expect(customElements.get("i18n-t")).toBeDefined();

    // the DOM is still parsing: the page is translated on DOMContentLoaded, once
    expect(mocks.translateDom).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(mocks.translateDom).toHaveBeenCalledTimes(1);
    expect(mocks.translateDom).toHaveBeenCalledWith(document.body);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(mocks.translateDom).toHaveBeenCalledTimes(1);

    // the whole JS API is exposed to inline scripts
    expect(window.i18nKeyless.init).toBe(mocks.init);
    expect(window.i18nKeyless.ready).toBe(auto.ready);
    expect(typeof window.i18nKeyless.setCurrentLanguage).toBe("function");
    expect(typeof window.i18nKeyless.translateDom).toBe("function");
    expect(typeof window.i18nKeyless.defineI18nT).toBe("function");
    await expect(auto.ready).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("translates right away when the DOM is already parsed", async () => {
    addScriptTag({ "data-api-key": "key-2", "data-primary": "en" });
    expect(document.readyState).not.toBe("loading");
    await loadAuto();
    expect(mocks.init).toHaveBeenCalledWith({ API_KEY: "key-2", languages: { primary: "en", supported: ["en"] } });
    expect(mocks.translateDom).toHaveBeenCalledTimes(1);
    expect(mocks.translateDom).toHaveBeenCalledWith(document.body);
  });

  it("logs a failed init and still resolves ready", async () => {
    const failure = new Error("boom");
    mocks.init.mockRejectedValueOnce(failure);
    addScriptTag({ "data-api-key": "key-3", "data-primary": "fr" });
    const auto = await loadAuto();
    await expect(auto.ready).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("i18n-keyless: init failed", failure);
    expect(window.i18nKeyless.ready).toBe(auto.ready);
    expect(mocks.translateDom).toHaveBeenCalledTimes(1);
  });

  it("throws when no script tag is found", async () => {
    await expect(loadAuto()).rejects.toThrow(/data-primary is required/);
    expect(mocks.findAutoScript).toHaveBeenCalledTimes(1);
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.translateDom).not.toHaveBeenCalled();
    expect(window.i18nKeyless).toBeUndefined();
  });

  it("throws when the script tag has no api key", async () => {
    addScriptTag({ "data-primary": "fr" });
    await expect(loadAuto()).rejects.toThrow(/data-api-key is required/);
    expect(mocks.init).not.toHaveBeenCalled();
    expect(window.i18nKeyless).toBeUndefined();
  });
});

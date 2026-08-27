import { describe, it, expect, beforeEach } from "vitest";
import { parseAutoConfig, findAutoScript } from "../auto-config.ts";

describe("parseAutoConfig", () => {
  it("maps the data-* attributes onto the init config", () => {
    const config = parseAutoConfig({
      apiKey: "key-1",
      apiUrl: "http://localhost:8787",
      primary: "fr",
      supported: "en, es",
      lang: "es",
      fallback: "en",
      namespace: "site",
      debug: "",
      skipLanguageHydration: "true",
    });
    expect(config).toEqual({
      API_KEY: "key-1",
      API_URL: "http://localhost:8787",
      defaultNamespace: "site",
      debug: true,
      languages: {
        primary: "fr",
        supported: ["fr", "en", "es"],
        initWithDefault: "es",
        fallback: "en",
        skipCurrentLanguageHydration: true,
      },
    });
  });

  it("requires data-primary and data-api-key", () => {
    expect(() => parseAutoConfig({ apiKey: "k" })).toThrow(/data-primary is required/);
    expect(() => parseAutoConfig({ primary: "fr" })).toThrow(/data-api-key is required/);
  });

  it("accepts a self-hosted backend without a key", () => {
    const config = parseAutoConfig({ apiUrl: "http://localhost:8787", primary: "fr" });
    expect(config.API_URL).toBe("http://localhost:8787");
    expect(config.API_KEY).toBe("self-hosted");
  });

  it("selects the storage", () => {
    expect(parseAutoConfig({ apiKey: "k", primary: "fr" }).storage).toBeUndefined();
    expect(parseAutoConfig({ apiKey: "k", primary: "fr", storage: "session" }).storage).toBe(window.sessionStorage);
    const memory = parseAutoConfig({ apiKey: "k", primary: "fr", storage: "memory" }).storage!;
    expect(memory).not.toBe(window.localStorage);
    memory.setItem!("a", "1");
    expect(memory.getItem!("a")).toBe("1");
  });
});

describe("findAutoScript", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("finds the module script by its resolved src", () => {
    document.head.innerHTML = `
      <script src="/vendor/other.js"></script>
      <script type="module" src="/dist/auto.js" data-api-key="k" data-primary="fr"></script>
    `;
    const script = findAutoScript(new URL("/dist/auto.js", document.baseURI).href);
    expect(script?.dataset.apiKey).toBe("k");
    expect(script?.dataset.primary).toBe("fr");
  });

  it("falls back to the tag carrying data-api-key", () => {
    document.body.innerHTML = `<script type="module" src="/somewhere/else.js" data-api-key="k2"></script>`;
    const script = findAutoScript("https://cdn.example.com/auto.js");
    expect(script?.dataset.apiKey).toBe("k2");
  });

  it("returns null when nothing matches", () => {
    expect(findAutoScript("https://cdn.example.com/auto.js")).toBeNull();
  });
});

describe("findAutoScript edge cases", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("prefers document.currentScript when the browser provides it", () => {
    document.body.innerHTML = `<script type="module" src="/somewhere/else.js" data-api-key="k2"></script>`;
    const current = document.createElement("script");
    current.dataset.apiKey = "current";
    Object.defineProperty(document, "currentScript", { value: current, configurable: true });
    try {
      expect(findAutoScript("https://cdn.example.com/auto.js")).toBe(current);
    } finally {
      delete (document as { currentScript?: unknown }).currentScript;
    }
  });

  it("skips a script whose src is not a valid URL", () => {
    document.head.innerHTML = `
      <script src="http://[/broken"></script>
      <script type="module" src="/dist/auto.js" data-api-key="k"></script>
    `;
    const script = findAutoScript(new URL("/dist/auto.js", document.baseURI).href);
    expect(script?.dataset.apiKey).toBe("k");
  });
});

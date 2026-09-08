/**
 * The precompiled bundle on the node SDK (docs/PROTOCOL.md, section 7.4, "Node SDK" bullet,
 * and section 13): `init` seeds every `(namespace, lang)` of the manifest into the flat
 * per-language maps and skips the boot fetch of `defaultNamespace` when the manifest covers
 * it. The cursor is not stored (the node SDK never stores one). A miss still POSTs and its
 * answer is merged as usual.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const okAll = (translations: Record<string, Record<string, string>> = {}) => ({
  ok: true,
  data: { translations, uniqueId: "u1", lastRefresh: "1" },
  error: "",
  message: "",
});
const okOne = (translation: Record<string, string>) => ({
  ok: true,
  data: { translation },
  error: "",
  message: "",
});

const languages = { primary: "fr", supported: ["en", "es"] } as const;

const BUNDLE_CURSOR = "1757000000000";
const manifest = {
  primaryLanguage: "fr",
  languages: ["en", "es", "fr"],
  exportedAt: BUNDLE_CURSOR,
  namespaces: {
    default: { lastRefresh: BUNDLE_CURSOR, languages: ["en", "es"] },
  },
};
const files: Record<string, Record<string, string>> = {
  "default/en.json": { Bonjour: "Hello" },
  "default/es.json": { Bonjour: "Hola" },
};

/** Fresh module registry per test: the node service keeps its store at module level. */
async function fresh() {
  vi.resetModules();
  const core = await import("i18n-keyless-core");
  const service = await import("../service.ts");
  return { service, api: core.api };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("bundle: covers the default namespace", () => {
  it("performs no dictionary fetch and resolves a key from the bundled file", async () => {
    const { service, api } = await fresh();
    const bootFetch = vi.spyOn(api, "fetchAllTranslationsForAllLanguages");
    const load = vi.fn(async (ns: string, lang: string) => files[`${ns}/${lang}.json`]);

    await service.init({ languages, API_KEY: "k", bundle: { manifest, load } } as never);

    expect(bootFetch).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledWith("default", "en");
    expect(load).toHaveBeenCalledWith("default", "es");
    await expect(service.awaitForTranslationOrThrow("Bonjour", "en")).resolves.toBe("Hello");
    await expect(service.awaitForTranslationOrThrow("Bonjour", "es")).resolves.toBe("Hola");
  });

  it("accepts `load` returning the module shape of a dynamic import()", async () => {
    const { service, api } = await fresh();
    vi.spyOn(api, "fetchAllTranslationsForAllLanguages");
    const load = vi.fn(async (ns: string, lang: string) => ({ default: files[`${ns}/${lang}.json`] }));

    await service.init({ languages, API_KEY: "k", bundle: { manifest, load } } as never);

    await expect(service.awaitForTranslationOrThrow("Bonjour", "en")).resolves.toBe("Hello");
  });

  it("still POSTs and merges the answer for a key the bundle does not cover", async () => {
    const { service, api } = await fresh();
    vi.spyOn(api, "fetchAllTranslationsForAllLanguages");
    const load = vi.fn(async (ns: string, lang: string) => files[`${ns}/${lang}.json`]);
    await service.init({ languages, API_KEY: "k", bundle: { manifest, load } } as never);

    const post = vi.spyOn(api, "fetchTranslation").mockResolvedValue(okOne({ en: "Cart" }) as never);

    await expect(service.awaitForTranslationOrThrow("Panier", "en")).resolves.toBe("Cart");
    expect(post).toHaveBeenCalledTimes(1);
    // cached: a second call for the same key never POSTs again
    await expect(service.awaitForTranslationOrThrow("Panier", "en")).resolves.toBe("Cart");
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("bundle: covers only another namespace", () => {
  it("still performs the boot fetch of defaultNamespace", async () => {
    const { service, api } = await fresh();
    const bootFetch = vi.spyOn(api, "fetchAllTranslationsForAllLanguages").mockResolvedValue(okAll() as never);
    const otherManifest = {
      primaryLanguage: "fr",
      languages: ["en"],
      exportedAt: BUNDLE_CURSOR,
      namespaces: {
        checkout: { lastRefresh: BUNDLE_CURSOR, languages: ["en"] },
      },
    };
    const load = vi.fn(async () => ({ Panier: "Cart" }));

    await service.init({ languages, API_KEY: "k", bundle: { manifest: otherManifest, load } } as never);

    expect(bootFetch).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("checkout", "en");
  });
});

describe("bundle: a loader that throws", () => {
  it("is logged and does not break init", async () => {
    const { service, api } = await fresh();
    const bootFetch = vi.spyOn(api, "fetchAllTranslationsForAllLanguages");
    const load = vi.fn(async () => {
      throw new Error("file not found");
    });

    await expect(
      service.init({ languages, API_KEY: "k", bundle: { manifest, load } } as never)
    ).resolves.toBeTruthy();

    expect(console.error).toHaveBeenCalled();
    // the namespace is still considered covered (the manifest lists it), so the boot fetch
    // of defaultNamespace stays skipped even though the load failed
    expect(bootFetch).not.toHaveBeenCalled();
  });
});

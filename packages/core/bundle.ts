/**
 * The precompiled bundle (docs/PROTOCOL.md, section 7.4): dictionaries exported at build
 * time (`GET /translate/bundle`, or the MCP `export_bundle` tool) and shipped with the app,
 * one file per (namespace, language) plus a manifest. At boot and on a language switch a
 * covered dictionary is seeded from the bundle instead of fetched, with the bundle's cursor,
 * so the only network traffic left is a miss: `POST /translate`, then the delta fetch that
 * the queue's `empty` event already runs.
 *
 * Everything here is pure and replayed by `conformance/vectors/bundle-seed.json`.
 */
import type { Lang, LastRefresh, Translations } from "./types.ts";

/** `manifest.json`: the bundle without its dictionaries. */
export type BundleManifest = {
  primaryLanguage: string;
  languages: string[];
  exportedAt: string;
  namespaces: Record<string, { lastRefresh: string; languages: string[] }>;
};

/**
 * What `bundle.load` may return: the dictionary, or the module of a dynamic `import()` of
 * the JSON file (`{ default: dictionary }`), so a call site can be the one-liner
 * `(ns, lang) => import(\`./i18n-keyless/${ns}/${lang}.json\`)`.
 */
export type BundleFile = Translations | { default: Translations } | undefined | null;

export type BundleConfig = {
  manifest: BundleManifest;
  /** One file per (namespace, language). Called only for a pair the manifest covers. */
  load: (namespace: string, lang: Lang) => BundleFile | Promise<BundleFile>;
};

/** The seed of one namespace: a dictionary and the cursor that goes with it. */
export type BundleSeed = { translations: Translations; lastRefresh: LastRefresh };

/** What storage holds for one namespace: its slice, its cursor, and the language it is in. */
export type StoredSeed = { translations: Translations; lastRefresh: LastRefresh; lang: string };

/** True when the manifest lists `lang` under `namespace`. */
export function bundleCovers(manifest: BundleManifest | undefined, namespace: string, lang: string): boolean {
  const entry = manifest?.namespaces?.[namespace];
  return !!entry && Array.isArray(entry.languages) && entry.languages.includes(lang);
}

/** The namespaces the manifest lists, in manifest order. */
export function bundleNamespaces(manifest: BundleManifest | undefined): string[] {
  return manifest?.namespaces ? Object.keys(manifest.namespaces) : [];
}

/** A dictionary, from a plain object or from the module of an `import()`. */
export function unwrapBundleFile(file: BundleFile): Translations | undefined {
  if (!file || typeof file !== "object") {
    return undefined;
  }
  const module = file as { default?: unknown };
  if (module.default && typeof module.default === "object") {
    return module.default as Translations;
  }
  return file as Translations;
}

/**
 * The precedence between the bundle and what storage holds for the same namespace.
 *
 * The bundle is the base. Storage wins only when it is strictly newer — its cursor is a
 * larger number than the bundle's — AND it is in the language being seeded: a device that
 * fetched after a human review keeps the reviewed text, and a slice left by another language
 * is never mixed in. A storage cursor that is empty or not a number is never newer.
 */
export function mergeBundleWithStorage(bundle: BundleSeed, stored: StoredSeed | null | undefined, lang: string): BundleSeed {
  if (!stored || stored.lang !== lang) {
    return bundle;
  }
  const storedCursor = Number(stored.lastRefresh);
  const bundleCursor = Number(bundle.lastRefresh);
  if (!Number.isFinite(storedCursor) || !stored.lastRefresh || !(storedCursor > bundleCursor)) {
    return bundle;
  }
  return {
    translations: { ...bundle.translations, ...stored.translations },
    lastRefresh: stored.lastRefresh,
  };
}

/**
 * Loads one covered dictionary from the bundle. `undefined` when the manifest does not cover
 * the pair, when the loader yields nothing, or when it throws (a missing file at runtime is
 * a miss like any other: the caller falls back to the fetch).
 */
export async function loadBundleSeed(
  bundle: BundleConfig | undefined,
  namespace: string,
  lang: Lang
): Promise<BundleSeed | undefined> {
  if (!bundle || !bundleCovers(bundle.manifest, namespace, lang)) {
    return undefined;
  }
  try {
    const translations = unwrapBundleFile(await bundle.load(namespace, lang));
    if (!translations) {
      return undefined;
    }
    return { translations, lastRefresh: bundle.manifest.namespaces[namespace].lastRefresh };
  } catch (error) {
    console.error("i18n-keyless: bundle.load failed for", namespace, lang, error);
    return undefined;
  }
}

/**
 * The four framework packages (react, vue, angular, browser) are separate implementations
 * of one product, and their public surfaces are hand-kept copies: the `I18nConfig`
 * interface exists four times, and each `index.ts` lists its exports by hand. Nothing else
 * compares them. This suite fails when an option or a symbol is added to one package and
 * not to the others, unless the difference is written down below with its reason.
 *
 * It reads the source files as text: the packages do not build against each other, and a
 * type-level test would need every package's dist.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PACKAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES = ["react", "vue", "angular", "browser"] as const;
type Pkg = (typeof PACKAGES)[number];

const read = (pkg: Pkg, file: string) => readFileSync(join(PACKAGES_DIR, pkg, file), "utf8");

/** Top-level field names of `export interface I18nConfig { ... }` (nested object types skipped). */
function configFields(pkg: Pkg): string[] {
  const text = read(pkg, "types.ts");
  const start = text.search(/export interface I18nConfig\b[^{]*\{/);
  if (start < 0) throw new Error(`packages/${pkg}/types.ts: no "export interface I18nConfig"`);
  const body = text.slice(text.indexOf("{", start) + 1);
  const fields: string[] = [];
  let depth = 0;
  let inBlockComment = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    if (line.startsWith("//") || line === "") continue;
    if (depth === 0) {
      if (line.startsWith("}")) break;
      const m = line.match(/^([A-Za-z_$][\w$]*)\??\s*:/);
      if (m) fields.push(m[1]);
    }
    depth += (line.match(/[{(]/g) ?? []).length - (line.match(/[})]/g) ?? []).length;
  }
  return fields;
}

/** Every name `index.ts` exports: `export { a, b as c }`, `export type { d }`, `export const e`. */
function exportedNames(pkg: Pkg): Set<string> {
  const text = read(pkg, "index.ts");
  const out = new Set<string>();
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "");
      if (!name) continue;
      const pieces = name.split(/\s+as\s+/);
      out.add(pieces[pieces.length - 1].trim());
    }
  }
  for (const m of text.matchAll(/export\s+(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  return out;
}

describe("I18nConfig has the same fields in every framework package", () => {
  const react = configFields("react");

  it("react declares the fields the others are compared to", () => {
    expect(react).toContain("API_KEY");
    expect(react).toContain("languages");
    expect(react.length).toBeGreaterThan(8);
  });

  it("vue == react", () => {
    expect(configFields("vue").sort()).toEqual([...react].sort());
  });

  it("angular == react", () => {
    expect(configFields("angular").sort()).toEqual([...react].sort());
  });

  it("browser == react minus the documented exceptions", () => {
    // `ssr`: the browser package runs in a page only; there is no server render to flag.
    const BROWSER_OMITS = ["ssr"];
    for (const field of BROWSER_OMITS) expect(react, `react no longer has "${field}": drop it from BROWSER_OMITS`).toContain(field);
    const expected = react.filter((f) => !BROWSER_OMITS.includes(f)).sort();
    expect(configFields("browser").sort()).toEqual(expected);
  });
});

describe("index.ts exports the same names in every framework package", () => {
  const ALL: readonly Pkg[] = PACKAGES;
  const RV: readonly Pkg[] = ["react", "vue"];
  const RVA: readonly Pkg[] = ["react", "vue", "angular"];

  /**
   * A name absent from this map must be exported by all four packages. A name in the map is
   * exported by exactly the packages listed. Keep each group next to its reason.
   */
  const EXCEPTIONS: Record<string, readonly Pkg[]> = {
    // The hooks-and-provider component model: react and vue share it, angular has services
    // and a pipe instead, browser has no component tree.
    I18nKeylessProvider: RV,
    I18nKeylessProviderProps: RV,
    I18nKeylessText: RV,
    I18nKeylessTextProps: RV,
    T: RV,
    TranslationStore: RV,
    useCurrentLanguage: RV,
    useI18nKeyless: RV,
    useI18nKeylessContext: RV,
    useTranslation: RV,
    useTranslationStatus: RV,
    // The type of `useTranslation`'s function form; vue types it inline.
    TranslateFunction: ["react"],
    // Vue: the app plugin and the injection key.
    I18N_KEYLESS_SCOPE: ["vue"],
    I18nKeyless: ["vue"],
    I18nKeylessContextValue: ["vue"],
    I18nKeylessPluginOptions: ["vue"],
    UseI18nKeylessReturn: ["vue"],
    // Angular: providers, the injection token, the service, the component and the pipe.
    I18N_KEYLESS_REQUEST_SCOPE: ["angular"],
    I18nKeylessScopeInput: ["angular"],
    I18nKeylessService: ["angular"],
    I18nKeylessTextComponent: ["angular"],
    I18nKeylessTranslatePipe: ["angular"],
    // Angular: the `tStatus` pipe; react and vue expose the status through a hook instead.
    I18nKeylessTranslationStatusPipe: ["angular"],
    I18nStorage: ["angular"],
    i18nKeylessStore: ["angular"],
    provideI18nKeyless: ["angular"],
    provideI18nKeylessServer: ["angular"],
    whenHydrated: ["angular"],
    // Server rendering: the browser package never runs on a server, so it has no request
    // scope, no server dictionary and no hydration from one.
    I18nRequestScope: RVA,
    clearServerTranslationsCache: RVA,
    getRequestScope: RVA,
    getServerTranslations: RVA,
    getUsedTranslationsSnapshot: RVA,
    hydrateFromServer: RVA,
    runWithI18nKeyless: RVA,
    // The bulk-fetch function and the queue are re-exported for custom SSR loaders only.
    getAllTranslationsFromLanguage: RVA,
    queue: RVA,
    // Browser: the framework-free store API, the <i18n-t> element and the ./auto script tag.
    AutoDataset: ["browser"],
    I18nTElement: ["browser"],
    Listener: ["browser"],
    StorageAdapter: ["browser"],
    defineI18nT: ["browser"],
    findAutoScript: ["browser"],
    getCurrentLanguage: ["browser"],
    getState: ["browser"],
    parseAutoConfig: ["browser"],
    resolveTranslation: ["browser"],
    // Browser: the pure companion of `resolveTranslation`, for a `subscribe` listener.
    resolveTranslationStatus: ["browser"],
    subscribe: ["browser"],
    translateDom: ["browser"],
    watchTranslation: ["browser"],
    // Browser re-exports core's `LanguagesConfig`; the others declare their config types locally.
    LanguagesConfig: ["browser"],
  };

  const exports = Object.fromEntries(PACKAGES.map((p) => [p, exportedNames(p)])) as Record<Pkg, Set<string>>;
  const union = [...new Set(PACKAGES.flatMap((p) => [...exports[p]]))].sort();

  it("reads a real surface", () => {
    for (const p of PACKAGES) expect(exports[p].size, p).toBeGreaterThan(10);
    expect(union).toContain("init");
  });

  it.each(union)("%s is exported by the packages the map says", (name) => {
    const expected = EXCEPTIONS[name] ?? ALL;
    const actual = PACKAGES.filter((p) => exports[p].has(name));
    expect(actual, `"${name}": add it to the missing packages, or list it in EXCEPTIONS with a reason`).toEqual([...expected]);
  });

  it("keeps EXCEPTIONS minimal", () => {
    const stale = Object.entries(EXCEPTIONS).filter(([name, pkgs]) => !union.includes(name) || pkgs.length === PACKAGES.length);
    expect(stale.map(([n]) => n), "exported nowhere, or everywhere: remove from EXCEPTIONS").toEqual([]);
  });
});

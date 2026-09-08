/**
 * The release preflight of scripts/publish.mjs, run on every `npm run test` instead of only
 * at publish time: one version everywhere `scripts/set-version.mjs` writes it, and a
 * changelog entry for it in every changelog a registry shows.
 *
 * Keep the file list in step with scripts/set-version.mjs: that script is what writes these
 * values, this test is what notices when one of them was edited by hand.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const version: string = JSON.parse(read("package.json")).version;
const NPM_PACKAGES = ["core", "react", "node", "vue", "angular", "browser"];

/** rel → the text that must appear when the file carries `version` (scripts/set-version.mjs). */
const PORT_VERSION_SITES: Record<string, (v: string) => RegExp> = {
  "ports/flutter/pubspec.yaml": (v) => new RegExp(`^version:\\s*${escape(v)}\\s*$`, "m"),
  "ports/flutter/lib/src/core/version.dart": (v) => new RegExp(`i18nKeylessVersion = '${escape(v)}'`),
  "ports/laravel/src/ApiClient.php": (v) => new RegExp(`public const VERSION = '${escape(v)}'`),
  "ports/rails/lib/i18n_keyless/version.rb": (v) => new RegExp(`VERSION = "${escape(v)}"`),
  "ports/python/src/i18n_keyless/version.py": (v) => new RegExp(`__version__ = "${escape(v)}"`),
  "ports/go/version.go": (v) => new RegExp(`const Version = "${escape(v)}"`),
  "ports/swift/Sources/I18nKeyless/Version.swift": (v) => new RegExp(`public static let string = "${escape(v)}"`),
  "ports/kotlin/src/main/kotlin/io/i18nkeyless/Version.kt": (v) => new RegExp(`const val VERSION = "${escape(v)}"`),
  "ports/kotlin/build.gradle.kts": (v) => new RegExp(`^version = "${escape(v)}"`, "m"),
  "examples/kotlin/build.gradle.kts": (v) => new RegExp(`i18n-keyless-kotlin:${escape(v)}"`),
};

/** Changelogs a registry renders: pub.dev, PyPI, pkg.go.dev, SwiftPM, Maven Central. */
const PORT_CHANGELOGS = ["flutter", "python", "go", "swift", "kotlin"].map((p) => `ports/${p}/CHANGELOG.md`);

describe("one shared version", () => {
  it("root package.json has a semantic version", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it.each(NPM_PACKAGES)("packages/%s/package.json is at the root version and pins core to it", (name) => {
    const pkg = JSON.parse(read(`packages/${name}/package.json`));
    expect(pkg.version).toBe(version);
    if (name !== "core") expect(pkg.dependencies?.["i18n-keyless-core"], `${name} pins i18n-keyless-core`).toBe(version);
  });

  it.each(Object.keys(PORT_VERSION_SITES))("%s carries the root version", (rel) => {
    expect(read(rel), `run: node scripts/set-version.mjs ${version}`).toMatch(PORT_VERSION_SITES[rel](version));
  });

  it("set-version.mjs writes every site this test checks", () => {
    const script = read("scripts/set-version.mjs");
    for (const rel of Object.keys(PORT_VERSION_SITES)) expect(script, `set-version.mjs no longer edits ${rel}`).toContain(`"${rel}"`);
  });
});

describe("the changelogs have the release", () => {
  it("CHANGELOG.md has exactly one `## [version]` heading", () => {
    const headings = read("CHANGELOG.md").match(new RegExp(`^## \\[${escape(version)}\\]`, "gm")) ?? [];
    expect(headings, `rename "## [Unreleased]" to "## [${version}] — YYYY-MM-DD", once`).toHaveLength(1);
  });

  it("CHANGELOG.md has no duplicate version heading at all", () => {
    const all = Array.from(read("CHANGELOG.md").matchAll(/^## \[(\d+\.\d+\.\d+[^\]]*)\]/gm), (m) => m[1]);
    const dupes = all.filter((v, i) => all.indexOf(v) !== i);
    expect(dupes).toEqual([]);
  });

  it.each(PORT_CHANGELOGS)("%s has a `## version` entry", (rel) => {
    expect(read(rel)).toMatch(new RegExp(`^## ${escape(version)}\\s*$`, "m"));
  });
});

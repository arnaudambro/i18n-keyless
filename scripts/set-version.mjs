#!/usr/bin/env node
/**
 * Set the one shared version everywhere: the npm packages, the ports, and the `Version`
 * constants the ports send on the wire.
 *
 *   node scripts/set-version.mjs 3.4.0            # write (npm packages + the eight ports)
 *   node scripts/set-version.mjs 3.4.0 --dry-run  # print what would change
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [version, flag] = process.argv.slice(2);
const dryRun = flag === "--dry-run";

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: node scripts/set-version.mjs <x.y.z> [--dry-run]");
  process.exit(1);
}

const NPM_PACKAGES = ["core", "react", "node", "vue", "angular", "browser"];
const changes = [];

function edit(relPath, transform) {
  const path = resolve(root, relPath);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) {
    changes.push({ relPath, status: "unchanged" });
    return;
  }
  changes.push({ relPath, status: dryRun ? "would change" : "changed" });
  if (!dryRun) writeFileSync(path, after);
}

/** Replace one `"field": "<old>"` value in a JSON text, without reformatting the file. */
function jsonField(text, field, value, { required = true } = {}) {
  const re = new RegExp(`("${field}"\\s*:\\s*")[^"]*(")`);
  if (!re.test(text)) {
    if (required) throw new Error(`field "${field}" not found`);
    return text;
  }
  return text.replace(re, `$1${value}$2`);
}

// Root and npm packages: the `version` field, plus the pinned core dependency.
edit("package.json", (t) => jsonField(t, "version", version));
for (const name of NPM_PACKAGES) {
  edit(`packages/${name}/package.json`, (t) => {
    let out = jsonField(t, "version", version);
    if (name !== "core") out = jsonField(out, "i18n-keyless-core", version);
    return out;
  });
}

// Flutter: pubspec and the wire `Version` constant.
edit("ports/flutter/pubspec.yaml", (t) => {
  if (!/^version:\s*\S+/m.test(t)) throw new Error("pubspec version not found");
  return t.replace(/^version:\s*\S+/m, `version: ${version}`);
});
edit("ports/flutter/lib/src/core/version.dart", (t) => {
  const re = /(const String i18nKeylessVersion = ')[^']*(')/;
  if (!re.test(t)) throw new Error("i18nKeylessVersion not found");
  return t.replace(re, `$1${version}$2`);
});

// Rails: the gem version, which is also the wire `Version` header.
edit("ports/rails/lib/i18n_keyless/version.rb", (t) => {
  const re = /(VERSION = ")[^"]*(")/;
  if (!re.test(t)) throw new Error("I18nKeyless::VERSION not found");
  return t.replace(re, `$1${version}$2`);
});

// Laravel: the wire `Version` constant (Packagist reads the version from the git tag).
edit("ports/laravel/src/ApiClient.php", (t) => {
  const re = /(public const VERSION = ')[^']*(')/;
  if (!re.test(t)) throw new Error("ApiClient::VERSION not found");
  return t.replace(re, `$1${version}$2`);
});

// Python: the wire `Version` and the PyPI version (pyproject reads it: `dynamic = ["version"]`).
edit("ports/python/src/i18n_keyless/version.py", (t) => {
  const re = /(__version__ = ")[^"]*(")/;
  if (!re.test(t)) throw new Error("__version__ not found");
  return t.replace(re, `$1${version}$2`);
});

// Go: the wire `Version` constant (the module version is the git tag `ports/go/v<version>`).
edit("ports/go/version.go", (t) => {
  const re = /(const Version = ")[^"]*(")/;
  if (!re.test(t)) throw new Error("Version not found");
  return t.replace(re, `$1${version}$2`);
});

// Swift: the wire `Version` constant (SwiftPM reads the version from the mirror's git tag).
edit("ports/swift/Sources/I18nKeyless/Version.swift", (t) => {
  const re = /(public static let string = ")[^"]*(")/;
  if (!re.test(t)) throw new Error("I18nKeylessVersion.string not found");
  return t.replace(re, `$1${version}$2`);
});

// Kotlin: the wire `Version` constant and the Maven artifact version.
edit("ports/kotlin/src/main/kotlin/io/i18nkeyless/Version.kt", (t) => {
  const re = /(const val VERSION = ")[^"]*(")/;
  if (!re.test(t)) throw new Error("VERSION not found");
  return t.replace(re, `$1${version}$2`);
});
edit("ports/kotlin/build.gradle.kts", (t) => {
  const re = /(^version = ")[^"]*(")/m;
  if (!re.test(t)) throw new Error("gradle version not found");
  return t.replace(re, `$1${version}$2`);
});
// The Kotlin example pins the published coordinate (the composite build substitutes it).
edit("examples/kotlin/build.gradle.kts", (t) => {
  const re = /(i18n-keyless-kotlin:)[^"]*(")/;
  if (!re.test(t)) throw new Error("i18n-keyless-kotlin pin not found");
  return t.replace(re, `$1${version}$2`);
});

for (const { relPath, status } of changes) console.log(`${status.padEnd(12)} ${relPath}`);
console.log(`\n${dryRun ? "dry run: " : ""}version ${version} in ${changes.length} files`);

/**
 * Every conformance vector is replayed by every suite, or its absence is written down here.
 *
 * Each suite (core and the seven ports) hard-codes the list of vector files it loads, so a
 * new file under conformance/vectors/ used to be a silent no-op everywhere. This test reads
 * the directory and fails on the first suite that does not name a file — the one place that
 * turns "add a vector" into "add it to every port, or say why not".
 *
 * A suite "names" a vector when it loads it through its loader helper, with or without the
 * `.json` suffix: load("x"), $this->vector('x'), vector("x"), loadVector('x.json'),
 * load_vector("x"), loadVector(t, "x"), Vectors.load("x"), tests("x.json"), group('x.json').
 * A mention in a comment does not count.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VECTORS_DIR = join(ROOT, "conformance", "vectors");

const vectors = readdirSync(VECTORS_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const LOADER = /(?:load|vector|loadVector|load_vector|Vectors\.load|tests|group)\(\s*(?:t,\s*)?["']([a-z-]+?)(?:\.json)?["']/g;

function namedVectors(file: string): Set<string> {
  const text = readFileSync(join(ROOT, file), "utf8");
  return new Set(Array.from(text.matchAll(LOADER), (m) => m[1]));
}

/** file: the suite; skip: vector → the reason it is not replayed there. */
const SUITES: Record<string, { file: string; skip: Record<string, string> }> = {
  core: {
    file: "packages/core/__tests__/conformance.test.ts",
    skip: {
      "storage-keys": "the device storage contract is the react package's: packages/react/__tests__/utils.test.ts",
    },
  },
  laravel: {
    file: "ports/laravel/tests/Conformance/VectorsTest.php",
    skip: {
      "message-format": "plurals / select (`count`, `select`) are not implemented in this port yet: a row upgraded by another SDK reaches it as a raw ICU message",
      replace: "placeholders are Laravel's `:name`, not the SDK's literal map",
      "storage-keys": "a server port: persists nothing",
    },
  },
  rails: {
    file: "ports/rails/test/conformance/vectors_test.rb",
    skip: {
      "message-format": "plurals / select (`count`, `select`) are not implemented in this port yet: a row upgraded by another SDK reaches it as a raw ICU message",
      replace: "placeholders are I18n's `%{name}`, not the SDK's literal map",
      "storage-keys": "a server port: persists nothing",
    },
  },
  flutter: {
    file: "ports/flutter/test/conformance_test.dart",
    skip: { "message-format": "plurals / select (`count`, `select`) are not implemented in this port yet: a row upgraded by another SDK reaches it as a raw ICU message" },
  },
  python: {
    file: "ports/python/tests/test_vectors.py",
    skip: { "message-format": "plurals / select (`count`, `select`) are not implemented in this port yet: a row upgraded by another SDK reaches it as a raw ICU message" },
  },
  go: {
    file: "ports/go/conformance_test.go",
    skip: { "message-format": "plurals / select (`count`, `select`) are not implemented in this port yet: a row upgraded by another SDK reaches it as a raw ICU message" },
  },
  swift: {
    file: "ports/swift/Tests/I18nKeylessTests/ConformanceTests.swift",
    skip: { "message-format": "plurals / select (`count`, `select`) are not implemented in this port yet: a row upgraded by another SDK reaches it as a raw ICU message" },
  },
  kotlin: {
    file: "ports/kotlin/src/test/kotlin/io/i18nkeyless/ConformanceTest.kt",
    skip: { "message-format": "plurals / select (`count`, `select`) are not implemented in this port yet: a row upgraded by another SDK reaches it as a raw ICU message" },
  },
};

describe("conformance/vectors coverage", () => {
  it("has vectors to check", () => {
    expect(vectors.length).toBeGreaterThan(10);
  });

  for (const [suite, { file, skip }] of Object.entries(SUITES)) {
    describe(suite, () => {
      const named = namedVectors(file);

      it(`replays every vector or documents the exception (${file})`, () => {
        const missing = vectors.filter((v) => !named.has(v) && !(v in skip));
        expect(missing, `${file} does not load: ${missing.join(", ")} — replay them or add a reason to SUITES.${suite}.skip`).toEqual([]);
      });

      it("keeps its skip list minimal", () => {
        const stale = Object.keys(skip).filter((v) => named.has(v) || !vectors.includes(v));
        expect(stale, `SUITES.${suite}.skip lists a vector that is replayed or does not exist: ${stale.join(", ")}`).toEqual([]);
      });
    });
  }
});

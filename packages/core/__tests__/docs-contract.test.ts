/**
 * The prose that repeats a fact the code owns, held to the code:
 *
 * - the `sdk` header labels: conformance/vectors/usage-reporting.json is the authority;
 *   docs/PROTOCOL.md (sections 3.2 and 10.1) and core's `SdkRuntime` / `isServerRuntime`
 *   must agree with it;
 * - the per-framework skills: every `SKILL.md` under packages/ and ports/ must be listed in
 *   the "Other frameworks" table of the root skill, or an agent never finds it.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isServerRuntime } from "../unique-id.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

type UsageVector = {
  cases: { expected: { runtime: string } }[];
  serverLabels: { cases: { label: string; expected: boolean }[] };
};
const usage: UsageVector = JSON.parse(read("conformance/vectors/usage-reporting.json"));

/** The labels an npm package sends (the vector's `cases`). */
const JS_LABELS = [...new Set(usage.cases.map((c) => c.expected.runtime))].sort();
/** Every real label, npm packages and ports; "" and "typo" are the vector's negative cases. */
const ALL_LABELS = [...new Set([...JS_LABELS, ...usage.serverLabels.cases.map((c) => c.label)])]
  .filter((l) => /^[a-z]+(-(client|server))?$/.test(l) && l !== "typo")
  .sort();

const backticked = (text: string) => new Set(Array.from(text.matchAll(/`([^`]+)`/g), (m) => m[1]));

describe("docs/PROTOCOL.md names every sdk label", () => {
  const protocol = read("docs/PROTOCOL.md");

  it("the vector has the labels this test relies on", () => {
    expect(ALL_LABELS).toContain("react-client");
    expect(ALL_LABELS).toContain("kotlin-server");
    expect(ALL_LABELS.length).toBeGreaterThanOrEqual(17);
  });

  it("section 3.2, the `sdk` row of the header table", () => {
    const section = protocol.slice(protocol.indexOf("### 3.2"), protocol.indexOf("### 3.3"));
    const row = section.split("\n").find((l) => l.startsWith("| `sdk` |"));
    expect(row, "no `| `sdk` |` row in section 3.2").toBeDefined();
    const named = backticked(row!);
    const missing = ALL_LABELS.filter((l) => !named.has(l));
    expect(missing, "labels the header table does not list").toEqual([]);
  });

  it("section 10.1, the runtime table", () => {
    const section = protocol.slice(protocol.indexOf("### 10.1"), protocol.indexOf("### 10.2"));
    const named = backticked(section);
    const missing = ALL_LABELS.filter((l) => !named.has(l));
    expect(missing, "labels section 10.1 does not list").toEqual([]);
  });
});

describe("core agrees with usage-reporting.json", () => {
  it("SdkRuntime is the union of the npm packages' labels", () => {
    const source = read("packages/core/unique-id.ts");
    const m = source.match(/export type SdkRuntime =([^;]+);/);
    expect(m, "no `export type SdkRuntime`").not.toBeNull();
    const union = Array.from(m![1].matchAll(/"([^"]+)"/g), (x) => x[1]).sort();
    expect(union).toEqual(JS_LABELS);
  });

  it("isServerRuntime answers every serverLabels case", () => {
    for (const { label, expected } of usage.serverLabels.cases) {
      expect(isServerRuntime(label), `isServerRuntime(${JSON.stringify(label)})`).toBe(expected);
    }
  });

  it("every npm package label is a serverLabels case", () => {
    const covered = new Set(usage.serverLabels.cases.map((c) => c.label));
    expect(JS_LABELS.filter((l) => !covered.has(l))).toEqual([]);
  });
});

describe("skills/i18n-keyless/SKILL.md lists every other skill", () => {
  const skill = read("skills/i18n-keyless/SKILL.md");
  const table = skill.slice(skill.indexOf("## Other frameworks"), skill.indexOf("## Go deeper"));

  const skillFiles = ["packages", "ports"]
    .flatMap((dir) =>
      readdirSync(join(ROOT, dir), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `${dir}/${d.name}/SKILL.md`),
    )
    .filter((rel) => existsSync(join(ROOT, rel)))
    // packages/react and packages/node receive a gitignored copy of the root skill at publish.
    .filter((rel) => rel !== "packages/react/SKILL.md" && rel !== "packages/node/SKILL.md")
    .sort();

  it("finds the skills", () => {
    expect(skillFiles.length).toBeGreaterThanOrEqual(10);
  });

  it.each(skillFiles)("%s has a row in the table", (rel) => {
    expect(table, `add a row for \`${rel}\` to the "Other frameworks" table`).toContain(`\`${rel}\``);
  });

  it("the table names no skill that does not exist", () => {
    const listed = Array.from(table.matchAll(/`((?:packages|ports)\/[^`]+\/SKILL\.md)`/g), (m) => m[1]);
    expect(listed.filter((rel) => !existsSync(join(ROOT, rel)))).toEqual([]);
  });
});

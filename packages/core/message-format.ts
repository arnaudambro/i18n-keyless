/**
 * The subset of ICU MessageFormat that carries plurals, ordinals and gender-like choices:
 *
 * ```
 * {count, plural, one {{count} article} few {{count} articles} other {{count} articles}}
 * {count, selectordinal, one {{count}er} other {{count}e}}
 * {gender, select, male {Il est connecté} female {Elle est connectée} other {Connecté}}
 * ```
 *
 * The API stores one such message per language cell when a key is rendered with `count`
 * or `select`: the model writes the branches the target language needs — Russian gets
 * `one` / `few` / `many` / `other`, French `one` / `other`, Japanese `other` alone — and
 * the client picks one with `Intl.PluralRules`, the CLDR tables every browser and Node
 * ship. Zero dependencies, and the same file is the reference the ports re-implement.
 *
 * Deliberately small: a message is plain text with any number of blocks in it, a block
 * is `{variable, kind, key {body} key {body} ...}`, a body may hold placeholders
 * (`{count}`) and nested blocks, and `#` inside a plural body is the number. No
 * apostrophe escaping, no `offset:`, no `number` / `date` argument types: the model is
 * asked for none of that and the API validates what it answers.
 */

import type { TranslationOptions } from "./types.ts";

export type IcuKind = "plural" | "selectordinal" | "select";

export type IcuBlock = {
  /** The variable the block switches on (`count`, `gender`). */
  variable: string;
  kind: IcuKind;
  /** Branch bodies by key: a CLDR category, `other`, a select value, or an exact `=N`. */
  branches: Record<string, string>;
  /** Offsets of the block in the text, `end` exclusive. */
  start: number;
  end: number;
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BRANCH_KEY = /^(=\d+|[A-Za-z_][A-Za-z0-9_-]*)$/;

function skipWhitespace(text: string, at: number): number {
  while (at < text.length && /\s/.test(text[at])) at++;
  return at;
}

/** The index just past the `}` that closes the `{` at `open`, or -1 when unbalanced. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Parses the block that starts at the `{` at `open`, or returns null when it is not one. */
function parseBlockAt(text: string, open: number): IcuBlock | null {
  const end = closingBrace(text, open);
  if (end === -1) return null;
  const inner = text.slice(open + 1, end - 1);
  const firstComma = inner.indexOf(",");
  if (firstComma === -1) return null;
  const variable = inner.slice(0, firstComma).trim();
  if (!IDENTIFIER.test(variable)) return null;
  const secondComma = inner.indexOf(",", firstComma + 1);
  if (secondComma === -1) return null;
  const kind = inner.slice(firstComma + 1, secondComma).trim();
  if (kind !== "plural" && kind !== "selectordinal" && kind !== "select") return null;

  const branches: Record<string, string> = {};
  let at = secondComma + 1;
  for (;;) {
    at = skipWhitespace(inner, at);
    if (at >= inner.length) break;
    const bodyOpen = inner.indexOf("{", at);
    if (bodyOpen === -1) return null;
    const key = inner.slice(at, bodyOpen).trim();
    if (!BRANCH_KEY.test(key)) return null;
    const bodyEnd = closingBrace(inner, bodyOpen);
    if (bodyEnd === -1) return null;
    branches[key] = inner.slice(bodyOpen + 1, bodyEnd - 1);
    at = bodyEnd;
  }
  if (Object.keys(branches).length === 0) return null;
  return { variable, kind, branches, start: open, end };
}

/**
 * The first ICU block at or after `from`, or null when the text holds none. A `{` that
 * does not open a well-formed block (a plain `{name}` placeholder) is skipped.
 */
export function findIcuBlock(text: string, from = 0): IcuBlock | null {
  let open = text.indexOf("{", from);
  while (open !== -1) {
    const block = parseBlockAt(text, open);
    if (block) return block;
    open = text.indexOf("{", open + 1);
  }
  return null;
}

/** True when the text carries at least one plural / selectordinal / select block. */
export function isIcuMessage(text: string): boolean {
  return findIcuBlock(text) !== null;
}

/**
 * The CLDR plural categories a language uses, sorted, `other` always present. From
 * `Intl.PluralRules` when the runtime has it (browsers, Node, Bun, Deno); a runtime
 * without it (some Hermes builds) gets the two-form fallback `one` / `other`, which is
 * what the source language of most apps needs and never throws.
 */
export function pluralCategoriesFor(lang: string, type: "cardinal" | "ordinal" = "cardinal"): string[] {
  try {
    const categories = new Intl.PluralRules(lang, { type }).resolvedOptions().pluralCategories;
    if (categories.length > 0) return [...categories].sort();
  } catch {
    // fall through
  }
  return type === "cardinal" ? ["one", "other"] : ["other"];
}

/** The CLDR category of `n` in `lang`, with the same fallback as `pluralCategoriesFor`. */
export function pluralCategoryFor(lang: string, n: number, type: "cardinal" | "ordinal" = "cardinal"): string {
  try {
    return new Intl.PluralRules(lang, { type }).select(n);
  } catch {
    return type === "cardinal" && n === 1 ? "one" : "other";
  }
}

/**
 * The branch of a block that a value selects, or undefined when nothing fits: an exact
 * `=N` first for a number, then the CLDR category (or the select value), then `other`.
 */
export function selectIcuBranch(
  block: IcuBlock,
  lang: string,
  value: string | number | undefined
): string | undefined {
  const { branches, kind } = block;
  if (kind === "select") {
    const key = value === undefined ? undefined : String(value);
    return (key !== undefined ? branches[key] : undefined) ?? branches.other;
  }
  const n = typeof value === "number" ? value : value === undefined ? NaN : Number(value);
  if (Number.isNaN(n)) return branches.other;
  const exact = branches[`=${n}`];
  if (exact !== undefined) return exact;
  const category = pluralCategoryFor(lang, n, kind === "selectordinal" ? "ordinal" : "cardinal");
  return branches[category] ?? branches.other;
}

/**
 * Renders every block of `text` for `values`, left to right, recursively, in `lang`. A
 * block that no value resolves (no matching branch, no `other`) is left as it is. A block
 * whose variable is absent from `values` falls back to `other`, so a message rendered
 * without a `count` still reads. The plain placeholders (`{count}`, `{name}`) are NOT
 * substituted here: `applyReplace` does that afterwards, with the same rules as ever.
 */
export function formatIcuMessage(
  text: string,
  lang: string,
  values: Record<string, string | number | undefined> = {}
): string {
  let out = "";
  let from = 0;
  for (;;) {
    const block = findIcuBlock(text, from);
    if (!block) {
      out += text.slice(from);
      return out;
    }
    out += text.slice(from, block.start);
    const branch = selectIcuBranch(block, lang, values[block.variable]);
    if (branch === undefined) {
      out += text.slice(block.start, block.end);
    } else {
      const value = values[block.variable];
      const body = block.kind === "select" || value === undefined ? branch : branch.replace(/#/g, String(value));
      out += formatIcuMessage(body, lang, values);
    }
    from = block.end;
  }
}

/**
 * What a call asks the API for, derived from the options: `count` (a cardinal, or an
 * ordinal with `ordinal: true`) and / or `select` (one current value per variable).
 * Undefined when the call asks for neither, which is the regular flow.
 */
export type MessageFormatRequest = {
  plural?: "cardinal" | "ordinal";
  select?: Record<string, string>;
};

export function resolveMessageFormat(options?: TranslationOptions): MessageFormatRequest | undefined {
  const plural = options?.count !== undefined ? (options.ordinal ? "ordinal" : "cardinal") : undefined;
  const select = options?.select && Object.keys(options.select).length > 0 ? options.select : undefined;
  if (!plural && !select) return undefined;
  return { ...(plural ? { plural } : {}), ...(select ? { select } : {}) };
}

/**
 * True when a stored translation already carries what the options ask for: a plural (or
 * ordinal) block on `count` for a `count` call, and for each `select` variable a block that
 * names the current value (or is the regular flow). Used by the lookup to re-request a row
 * that predates the option, or that never saw this value, so the API upgrades it.
 */
export function hasRequestedFormat(translation: string, options?: TranslationOptions): boolean {
  const format = resolveMessageFormat(options);
  if (!format) return true;
  const blocks: IcuBlock[] = [];
  for (let block = findIcuBlock(translation); block; block = findIcuBlock(translation, block.end)) {
    blocks.push(block);
    for (const body of Object.values(block.branches)) {
      for (let nested = findIcuBlock(body); nested; nested = findIcuBlock(body, nested.end)) {
        blocks.push(nested);
      }
    }
  }
  if (format.plural) {
    const kind = format.plural === "ordinal" ? "selectordinal" : "plural";
    if (!blocks.some((block) => block.variable === "count" && block.kind === kind)) return false;
  }
  for (const [variable, value] of Object.entries(format.select ?? {})) {
    const block = blocks.find((candidate) => candidate.variable === variable && candidate.kind === "select");
    if (!block || !(value in block.branches)) return false;
  }
  return true;
}

/**
 * The values `formatIcuMessage` switches on and the placeholders `applyReplace` fills, from
 * the options: `{count}` and one `{variable}` per `select` entry, under the caller's own
 * `replace` (which wins on a clash).
 */
export function messageValuesOf(options?: TranslationOptions): {
  values: Record<string, string | number>;
  placeholders: Record<string, string>;
} {
  const values: Record<string, string | number> = {};
  const placeholders: Record<string, string> = {};
  if (options?.count !== undefined) {
    values.count = options.count;
    placeholders["{count}"] = String(options.count);
  }
  for (const [variable, value] of Object.entries(options?.select ?? {})) {
    values[variable] = value;
    placeholders[`{${variable}}`] = value;
  }
  return { values, placeholders };
}

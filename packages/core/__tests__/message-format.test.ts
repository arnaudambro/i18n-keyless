import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findIcuBlock,
  isIcuMessage,
  formatIcuMessage,
  pluralCategoriesFor,
  pluralCategoryFor,
  resolveMessageFormat,
  hasRequestedFormat,
  messageValuesOf
} from "../message-format.ts";
import { formatTranslation, getTranslationCore, queue } from "../service.ts";
import type { FetchTranslationParams } from "../types.ts";

const RU = "{count, plural, one {{count} товар} few {{count} товара} many {{count} товаров} other {{count} товара}}";
const FR = "{count, plural, one {{count} article} other {{count} articles}}";
const EN_ORDINAL = "You are {count, selectordinal, one {{count}st} two {{count}nd} few {{count}rd} other {{count}th}}";
const GENDER = "{gender, select, male {Il est connecté} female {Elle est connectée} other {Connecté}}";

describe("findIcuBlock", () => {
  it("parses a plural block and its branches", () => {
    const block = findIcuBlock(FR);
    expect(block).toMatchObject({ variable: "count", kind: "plural", start: 0, end: FR.length });
    expect(block?.branches).toEqual({ one: "{count} article", other: "{count} articles" });
  });

  it("skips a plain placeholder and finds the block after it", () => {
    const text = "Hello {name}, {n, select, a {A} other {B}}";
    const block = findIcuBlock(text);
    expect(block?.variable).toBe("n");
    expect(block?.start).toBe(text.indexOf("{n,"));
  });

  it("returns null for a plain text, a placeholder, an unknown kind or an unbalanced brace", () => {
    expect(findIcuBlock("Bonjour")).toBeNull();
    expect(findIcuBlock("Bonjour {name}")).toBeNull();
    expect(findIcuBlock("{count, number}")).toBeNull();
    expect(findIcuBlock("{count, plural, one {x}")).toBeNull();
    expect(findIcuBlock("{count, plural, 1 {x}}")).toBeNull();
    expect(findIcuBlock("{count, plural, }")).toBeNull();
  });

  it("accepts exact matches, whitespace and newlines between branches", () => {
    const block = findIcuBlock("{count, plural,\n  =0 {none}\n  one {one}\n  other {many}\n}");
    expect(block?.branches).toEqual({ "=0": "none", one: "one", other: "many" });
  });

  it("isIcuMessage is the boolean form", () => {
    expect(isIcuMessage(FR)).toBe(true);
    expect(isIcuMessage("{count} articles")).toBe(false);
  });
});

describe("plural categories", () => {
  it("names the CLDR categories of a language, sorted, other always present", () => {
    expect(pluralCategoriesFor("fr")).toEqual(["many", "one", "other"]);
    expect(pluralCategoriesFor("en")).toEqual(["one", "other"]);
    expect(pluralCategoriesFor("ru")).toEqual(["few", "many", "one", "other"]);
    expect(pluralCategoriesFor("ja")).toEqual(["other"]);
    expect(pluralCategoriesFor("ar")).toEqual(["few", "many", "one", "other", "two", "zero"]);
    expect(pluralCategoriesFor("en", "ordinal")).toEqual(["few", "one", "other", "two"]);
    expect(pluralCategoriesFor("fr", "ordinal")).toEqual(["one", "other"]);
  });

  it("selects the category of a number", () => {
    expect(pluralCategoryFor("ru", 1)).toBe("one");
    expect(pluralCategoryFor("ru", 3)).toBe("few");
    expect(pluralCategoryFor("ru", 5)).toBe("many");
    expect(pluralCategoryFor("ru", 21)).toBe("one");
    expect(pluralCategoryFor("en", 2, "ordinal")).toBe("two");
    expect(pluralCategoryFor("en", 11, "ordinal")).toBe("other");
  });

  it("falls back to one / other when Intl.PluralRules is unusable", () => {
    expect(pluralCategoriesFor("not a language tag !!")).toEqual(["one", "other"]);
    expect(pluralCategoryFor("not a language tag !!", 1)).toBe("one");
    expect(pluralCategoryFor("not a language tag !!", 4)).toBe("other");
  });
});

describe("formatIcuMessage", () => {
  it("picks the Russian branch by category and keeps the placeholder for applyReplace", () => {
    expect(formatIcuMessage(RU, "ru", { count: 1 })).toBe("{count} товар");
    expect(formatIcuMessage(RU, "ru", { count: 3 })).toBe("{count} товара");
    expect(formatIcuMessage(RU, "ru", { count: 5 })).toBe("{count} товаров");
    expect(formatIcuMessage(RU, "ru", { count: 21 })).toBe("{count} товар");
  });

  it("prefers an exact =N branch, then the category, then other", () => {
    const text = "{count, plural, =0 {Aucun article} one {Un article} other {{count} articles}}";
    expect(formatIcuMessage(text, "fr", { count: 0 })).toBe("Aucun article");
    expect(formatIcuMessage(text, "fr", { count: 1 })).toBe("Un article");
    expect(formatIcuMessage(text, "fr", { count: 7 })).toBe("{count} articles");
  });

  it("renders ordinals and text around the block", () => {
    expect(formatIcuMessage(EN_ORDINAL, "en", { count: 1 })).toBe("You are {count}st");
    expect(formatIcuMessage(EN_ORDINAL, "en", { count: 2 })).toBe("You are {count}nd");
    expect(formatIcuMessage(EN_ORDINAL, "en", { count: 3 })).toBe("You are {count}rd");
    expect(formatIcuMessage(EN_ORDINAL, "en", { count: 11 })).toBe("You are {count}th");
    expect(formatIcuMessage(EN_ORDINAL, "en", { count: 42 })).toBe("You are {count}nd");
    expect(formatIcuMessage(EN_ORDINAL, "en", { count: 103 })).toBe("You are {count}rd");
  });

  it("renders a select by value, other when the value is unknown or missing", () => {
    expect(formatIcuMessage(GENDER, "fr", { gender: "female" })).toBe("Elle est connectée");
    expect(formatIcuMessage(GENDER, "fr", { gender: "robot" })).toBe("Connecté");
    expect(formatIcuMessage(GENDER, "fr", {})).toBe("Connecté");
  });

  it("falls back to other when the count is absent, so a row rendered without count still reads", () => {
    expect(formatIcuMessage(FR, "fr", {})).toBe("{count} articles");
  });

  it("substitutes # with the number inside a plural branch", () => {
    expect(formatIcuMessage("{count, plural, one {# item} other {# items}}", "en", { count: 4 })).toBe("4 items");
  });

  it("formats nested blocks and several blocks in one text", () => {
    const text =
      "{gender, select, female {Elle a {count, plural, one {# message} other {# messages}}} other {Il a {count, plural, one {# message} other {# messages}}}}";
    expect(formatIcuMessage(text, "fr", { gender: "female", count: 1 })).toBe("Elle a 1 message");
    expect(formatIcuMessage(text, "fr", { gender: "male", count: 2 })).toBe("Il a 2 messages");
    const two = "{a, select, x {X} other {O}} and {b, select, y {Y} other {O}}";
    expect(formatIcuMessage(two, "en", { a: "x", b: "y" })).toBe("X and Y");
  });

  it("leaves a block with no matching branch and no other untouched, and plain text as it is", () => {
    const text = "{count, plural, one {un}}";
    expect(formatIcuMessage(text, "fr", { count: 3 })).toBe(text);
    expect(formatIcuMessage("Bonjour {name}", "fr", { count: 3 })).toBe("Bonjour {name}");
  });
});

describe("resolveMessageFormat / hasRequestedFormat / messageValuesOf", () => {
  it("derives the request from the options", () => {
    expect(resolveMessageFormat()).toBeUndefined();
    expect(resolveMessageFormat({ replace: { "{a}": "b" } })).toBeUndefined();
    expect(resolveMessageFormat({ count: 0 })).toEqual({ plural: "cardinal" });
    expect(resolveMessageFormat({ count: 2, ordinal: true })).toEqual({ plural: "ordinal" });
    expect(resolveMessageFormat({ select: { gender: "female" } })).toEqual({ select: { gender: "female" } });
    expect(resolveMessageFormat({ select: {} })).toBeUndefined();
    expect(resolveMessageFormat({ count: 1, select: { gender: "male" } })).toEqual({
      plural: "cardinal",
      select: { gender: "male" }
    });
  });

  it("knows whether a stored translation carries what the call asks for", () => {
    expect(hasRequestedFormat("Bonjour", {})).toBe(true);
    expect(hasRequestedFormat("{count} articles", { count: 1 })).toBe(false);
    expect(hasRequestedFormat(FR, { count: 1 })).toBe(true);
    expect(hasRequestedFormat(FR, { count: 1, ordinal: true })).toBe(false);
    expect(hasRequestedFormat(EN_ORDINAL, { count: 1, ordinal: true })).toBe(true);
    expect(hasRequestedFormat(GENDER, { select: { gender: "female" } })).toBe(true);
    expect(hasRequestedFormat(GENDER, { select: { gender: "nonbinary" } })).toBe(false);
    expect(hasRequestedFormat(GENDER, { select: { role: "admin" } })).toBe(false);
    const nested = "{gender, select, female {{count, plural, one {a} other {b}}} other {{count, plural, one {a} other {b}}}}";
    expect(hasRequestedFormat(nested, { count: 1, select: { gender: "female" } })).toBe(true);
  });

  it("builds the values and the placeholders", () => {
    expect(messageValuesOf({ count: 3, select: { gender: "female" } })).toEqual({
      values: { count: 3, gender: "female" },
      placeholders: { "{count}": "3", "{gender}": "female" }
    });
    expect(messageValuesOf()).toEqual({ values: {}, placeholders: {} });
  });
});

describe("formatTranslation", () => {
  it("is applyReplace in the regular flow, an upgraded row falling back to `other`", () => {
    expect(formatTranslation("Bonjour {name}", "fr", { replace: { "{name}": "Ada" } })).toBe("Bonjour Ada");
    expect(formatTranslation("Bonjour", "fr")).toBe("Bonjour");
    expect(formatTranslation(FR, "fr")).toBe("{count} articles");
    expect(formatTranslation(FR, "fr", { replace: { "{count}": "12" } })).toBe("12 articles");
  });

  it("renders the block, fills {count} and applies replace, the caller's map winning", () => {
    expect(formatTranslation(RU, "ru", { count: 5 })).toBe("5 товаров");
    expect(formatTranslation(FR, "fr", { count: 0 })).toBe("0 article"); // CLDR: French 0 is `one`
    expect(formatTranslation(FR, "fr", { count: 1000, replace: { "{count}": "1 000" } })).toBe("1 000 articles");
    expect(formatTranslation(GENDER, "fr", { select: { gender: "female" } })).toBe("Elle est connectée");
    expect(formatTranslation("{gender} est là", "fr", { select: { gender: "Ada" } })).toBe("Ada est là");
  });

  it("renders the source form while the row is not upgraded yet", () => {
    expect(formatTranslation("{count} articles", "fr", { count: 3 })).toBe("3 articles");
  });
});

describe("getTranslationCore with count / select", () => {
  const storeWith = (currentLanguage: "fr" | "ru", translations: Record<string, string>): FetchTranslationParams => ({
    uniqueId: null,
    lastRefresh: null,
    currentLanguage,
    config: { API_KEY: "k", languages: { primary: "fr", supported: ["fr", "ru"] } },
    translations
  });
  // The queue is a module singleton: observe what is queued instead of running it.
  const queued = vi.spyOn(queue, "add").mockImplementation(async () => undefined);
  beforeEach(() => queued.mockClear());

  it("looks the key up in the primary language too and renders the model's form", () => {
    const store = storeWith("fr", { "{count} articles": FR });
    expect(getTranslationCore("{count} articles", store, { count: 1 })).toBe("1 article");
    expect(getTranslationCore("{count} articles", store, { count: 2 })).toBe("2 articles");
    expect(queued).not.toHaveBeenCalled();
  });

  it("queues a request in the primary language when the row is missing, and renders the key meanwhile", () => {
    const store = storeWith("fr", {});
    expect(getTranslationCore("{count} articles", store, { count: 3 })).toBe("3 articles");
    expect(queued).toHaveBeenCalledTimes(1);
  });

  it("re-requests a plain row when the call asks for a plural, and renders the plain row meanwhile", () => {
    const store = storeWith("ru", { "{count} articles": "{count} товаров" });
    expect(getTranslationCore("{count} articles", store, { count: 3 })).toBe("3 товаров");
    expect(queued).toHaveBeenCalledTimes(1);
  });

  it("re-requests a select row that never saw the value, and renders `other` meanwhile", () => {
    const store = storeWith("fr", { "Il est connecté": GENDER });
    expect(getTranslationCore("Il est connecté", store, { select: { gender: "nonbinary" } })).toBe("Connecté");
    expect(queued).toHaveBeenCalledTimes(1);
  });

  it("renders the Russian branches once the row is upgraded, without a request", () => {
    const store = storeWith("ru", { "{count} articles": RU });
    expect(getTranslationCore("{count} articles", store, { count: 3 })).toBe("3 товара");
    expect(queued).not.toHaveBeenCalled();
  });

  it("keeps the regular flow untouched: the primary language renders the key with no lookup", () => {
    const store = storeWith("fr", {});
    expect(getTranslationCore("Bonjour {name}", store, { replace: { "{name}": "Ada" } })).toBe("Bonjour Ada");
    expect(queued).not.toHaveBeenCalled();
  });
});

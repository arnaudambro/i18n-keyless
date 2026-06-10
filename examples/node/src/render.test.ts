import { describe, it, expect, beforeAll, vi } from "vitest";
import { renderPage } from "./render";

// Translations as the all-languages endpoint would return them (the Node SDK bulk-loads
// every language on init). We mock fetch so the test is self-contained — no server needed.
const TRANSLATIONS = {
  fr: {},
  en: {
    "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.":
      "Here is a phrase available in all your languages, you can change it if you want.",
    "8 heures__heure": "8 AM",
    "8 heures__durée": "8 hours",
  },
  es: {},
};

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 200,
      json: async () => ({
        ok: true,
        data: { translations: TRANSLATIONS, uniqueId: "demo", lastRefresh: "now" },
        error: "",
        message: "",
      }),
    }))
  );
});

describe("node example", () => {
  it("renders translated HTML for ?lang=en", async () => {
    const html = await renderPage("en");
    expect(html).toContain("Here is a phrase available in all your languages, you can change it if you want.");
    expect(html).toContain("8 AM"); // 8 heures / heure
    expect(html).toContain("8 hours"); // 8 heures / durée
    expect(html).toContain('lang="en"');
  });

  it("renders the French source for the primary language", async () => {
    const html = await renderPage("fr");
    expect(html).toContain("Voici une phrase disponible dans toutes vos langues");
  });
});

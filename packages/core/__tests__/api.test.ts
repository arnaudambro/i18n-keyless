import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../api.ts";

const methods = [
  "fetchTranslation",
  "fetchTranslationsForOneLanguage",
  "fetchAllTranslationsForAllLanguages",
  "postLastUsedTranslations",
] as const;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("api", () => {
  it.each(methods)("%s parses the body on a 200", async (method) => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true }) }) as never;
    await expect(api[method]("https://x.test", {})).resolves.toEqual({ ok: true });
  });

  it.each(methods)("%s reports the status text on a non-200, without throwing", async (method) => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ status: 500, statusText: "Internal Server Error", json: async () => ({}) }) as never;
    await expect(api[method]("https://x.test", {})).resolves.toEqual({
      ok: false,
      error: "Internal Server Error",
    });
  });

  it.each(methods)("%s turns a network failure into an ok:false result", async (method) => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as never;
    await expect(api[method]("https://x.test", {})).resolves.toEqual({ ok: false, error: "offline" });
  });

  it("passes the url and init through to fetch untouched", async () => {
    const spy = vi.fn().mockResolvedValue({ status: 200, json: async () => ({}) });
    global.fetch = spy as never;
    const init = { method: "POST", headers: { Authorization: "Bearer k" } };

    await api.fetchTranslation("https://x.test/translate", init);

    expect(spy).toHaveBeenCalledWith("https://x.test/translate", init);
  });
});

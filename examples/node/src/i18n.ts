import { init } from "i18n-keyless-node";

// Source strings are written in French → `fr` is the primary language.
export const PRIMARY = "fr";
export const SUPPORTED_LANGUAGES = ["fr", "en", "es"] as const;

let ready: Promise<unknown> | undefined;

// Initialize once. `i18n-keyless-node` bulk-loads all languages up front (no DOM storage).
export function initI18n() {
  if (!ready) {
    const key = process.env.I18N_KEYLESS_API_KEY;
    ready = init({
      API_KEY: key || "demo",
      // With a real key, API_URL defaults to https://api.i18n-keyless.com.
      // Without one, use the local mock backend so the demo runs offline.
      ...(key ? {} : { API_URL: "http://localhost:8787" }),
      languages: { primary: PRIMARY, supported: [...SUPPORTED_LANGUAGES] },
    });
  }
  return ready;
}

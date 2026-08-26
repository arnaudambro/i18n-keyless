import { init, type Lang } from "i18n-keyless-react";

// Source strings are written in French → `fr` is the primary language.
export const PRIMARY: Lang = "fr";
export const SUPPORTED_LANGUAGES = ["fr", "en", "es"] as const;

function apiKey(): string | undefined {
  // Server reads process.env; client reads Vite's import.meta.env.
  return typeof window === "undefined"
    ? process.env.I18N_KEYLESS_API_KEY
    : import.meta.env.VITE_I18N_KEYLESS_API_KEY;
}

function baseConfig() {
  const key = apiKey();
  return {
    API_KEY: key || "demo",
    // With a real key, API_URL defaults to https://api.i18n-keyless.com.
    // Without one, fall back to the local mock backend so the demo runs offline.
    ...(key ? {} : { API_URL: "http://localhost:8787" }),
    // `I18nConfig.languages.supported` is a mutable `Lang[]`; the tuple above is readonly.
    languages: { primary: PRIMARY, supported: [...SUPPORTED_LANGUAGES] as Lang[] },
  };
}

// Server: no storage → i18n-keyless uses an in-memory store. Call once per process.
export function initI18nServer() {
  return init({ ...baseConfig() });
}

// Client: persist to localStorage. Called before hydration (src/client.tsx).
export function initI18nClient() {
  return init({ ...baseConfig(), storage: window.localStorage });
}

// Normalizes any candidate (`?lang=` value, loader dep, etc.) to a supported language,
// falling back to the primary. Single source of truth for "which language is this request?".
export function normalizeLang(value?: string | null): Lang {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value ?? "") ? (value as Lang) : PRIMARY;
}

// The request language comes from `?lang=` (drives the server render). Defaults to primary.
export function langFromRequest(request: Request): Lang {
  return normalizeLang(new URL(request.url).searchParams.get("lang"));
}

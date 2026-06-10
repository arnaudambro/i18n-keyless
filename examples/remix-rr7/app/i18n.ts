import { init, type Lang } from "i18n-keyless-react";

export const PRIMARY = "fr";
export const SUPPORTED_LANGUAGES = ["fr", "en", "es"] as const;

function apiKey(): string | undefined {
  return typeof window === "undefined"
    ? process.env.I18N_KEYLESS_API_KEY
    : import.meta.env.VITE_I18N_KEYLESS_API_KEY;
}

function baseConfig() {
  const key = apiKey();
  return {
    API_KEY: key || "demo",
    ...(key ? {} : { API_URL: "http://localhost:8787" }),
    languages: { primary: PRIMARY, supported: [...SUPPORTED_LANGUAGES] },
  } as const;
}

// Server: no storage → in-memory. Client: localStorage.
export function initI18nServer() {
  return init({ ...baseConfig() });
}
export function initI18nClient() {
  return init({ ...baseConfig(), storage: window.localStorage });
}

export function langFromRequest(request: Request): Lang {
  const value = new URL(request.url).searchParams.get("lang");
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value ?? "") ? (value as Lang) : PRIMARY;
}

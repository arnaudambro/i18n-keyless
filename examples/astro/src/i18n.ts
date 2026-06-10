import { init, type Lang } from "i18n-keyless-react";

export const PRIMARY = "fr";
export const SUPPORTED_LANGUAGES = ["fr", "en", "es"] as const;

function apiKey(): string | undefined {
  // Server: process.env. Client: Astro exposes PUBLIC_* vars on import.meta.env.
  return typeof window === "undefined"
    ? process.env.I18N_KEYLESS_API_KEY
    : import.meta.env.PUBLIC_I18N_KEYLESS_API_KEY;
}

function baseConfig() {
  const key = apiKey();
  return {
    API_KEY: key || "demo",
    ...(key ? {} : { API_URL: "http://localhost:8787" }),
    languages: { primary: PRIMARY, supported: [...SUPPORTED_LANGUAGES] },
  } as const;
}

let serverReady: Promise<unknown> | undefined;
export function initI18nServer() {
  if (!serverReady) serverReady = init({ ...baseConfig() });
  return serverReady;
}
export function initI18nClient() {
  return init({ ...baseConfig(), storage: window.localStorage });
}
export function normalizeLang(value: string | undefined): Lang {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value ?? "") ? (value as Lang) : PRIMARY;
}

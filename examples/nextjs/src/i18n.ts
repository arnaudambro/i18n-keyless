import { init, type I18nConfig, type Lang } from "i18n-keyless-react";

export const PRIMARY: Lang = "fr";
export const SUPPORTED_LANGUAGES = ["fr", "en", "es"] as const;

function apiKey(): string | undefined {
  // Server reads I18N_KEYLESS_API_KEY; client reads NEXT_PUBLIC_I18N_KEYLESS_API_KEY.
  return typeof window === "undefined"
    ? process.env.I18N_KEYLESS_API_KEY
    : process.env.NEXT_PUBLIC_I18N_KEYLESS_API_KEY;
}

function baseConfig(): I18nConfig {
  const key = apiKey();
  return {
    API_KEY: key || "demo",
    ...(key ? {} : { API_URL: "http://localhost:8787" }),
    languages: { primary: PRIMARY, supported: [...SUPPORTED_LANGUAGES] },
  };
}

let serverReady: Promise<unknown> | undefined;
// Server: no storage → in-memory. Memoized so getServerTranslations always has config.
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

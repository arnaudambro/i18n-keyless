import { provideI18nKeyless } from "i18n-keyless-angular";
import { I18N_KEYLESS_API_KEY } from "./environment";

// Source strings in this demo are written in French, so `fr` is the primary language.
export const PRIMARY = "fr";
export const SUPPORTED_LANGUAGES = ["fr", "en", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// One provider in the root injector. `init` runs when the injector is created: the app
// renders immediately in the primary language and re-renders into the target language as
// translations arrive (instantly on later visits, from localStorage).
export function provideAppI18n() {
  return provideI18nKeyless({
    API_KEY: I18N_KEYLESS_API_KEY || "demo",
    // With a real key, API_URL defaults to https://api.i18n-keyless.com.
    // Without one, fall back to the local mock backend (examples/_mock-server) so the
    // demo still runs offline.
    ...(I18N_KEYLESS_API_KEY ? {} : { API_URL: "http://localhost:8787" }),
    languages: {
      primary: PRIMARY,
      supported: [...SUPPORTED_LANGUAGES],
    },
    // storage defaults to window.localStorage in the browser.
  });
}

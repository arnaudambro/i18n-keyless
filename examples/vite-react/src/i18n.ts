import { init } from "i18n-keyless-react";
// The precompiled bundle: `node scripts/export-bundle.mjs` writes it, the repo commits it.
import manifest from "./i18n-keyless/manifest.json";

// Source strings in this demo are written in French, so `fr` is the primary language.
export const PRIMARY = "fr";
export const SUPPORTED_LANGUAGES = ["fr", "en", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Real-life setup: put your i18n-keyless API key in `.env`
//   VITE_I18N_KEYLESS_API_KEY=sk_...
// and the app talks to the real service (translations are produced on demand with AI).
const apiKey = import.meta.env.VITE_I18N_KEYLESS_API_KEY;

export function initI18n() {
  return init({
    API_KEY: apiKey || "demo",
    // With a real key, API_URL defaults to https://api.i18n-keyless.com.
    // Without one, fall back to the local mock backend (examples/_mock-server) so the
    // demo still runs offline.
    ...(apiKey ? {} : { API_URL: "http://localhost:8787" }),
    languages: {
      primary: PRIMARY,
      supported: [...SUPPORTED_LANGUAGES]
    },
    // SPA: persist translations so they load instantly on the next visit.
    storage: window.localStorage,
    // Ship the dictionaries with the app: a language the manifest covers is read from the
    // file, never downloaded. The dynamic import() makes Vite split one chunk per language,
    // so only the rendered language ships. The API is still called for a string the bundle
    // does not have. Delete these two lines to go back to the default runtime fetch.
    bundle: { manifest, load: (namespace, lang) => import(`./i18n-keyless/${namespace}/${lang}.json`) }
  });
}

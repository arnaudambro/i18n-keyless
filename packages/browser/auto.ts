/**
 * The zero-code entry: one `<script type="module">` tag, and the page is translated.
 *
 * ```html
 * <script type="module"
 *   src="https://esm.sh/i18n-keyless-browser/auto"
 *   data-api-key="YOUR_API_KEY"
 *   data-primary="fr"
 *   data-supported="fr,en,es"
 *   data-lang="fr"></script>
 * ```
 *
 * On load it reads the `data-*` attributes of its own tag (see `auto-config.ts` for the
 * full list), calls `init`, defines `<i18n-t>`, runs `translateDom()` once the DOM is
 * parsed, and exposes the whole JS API as `window.i18nKeyless` for inline scripts.
 */
import * as api from "./index.ts";
import { findAutoScript, parseAutoConfig } from "./auto-config.ts";

export type I18nKeylessGlobal = typeof api & {
  /** Resolves once `init` has hydrated the store. */
  ready: Promise<void>;
};

declare global {
  interface Window {
    i18nKeyless: I18nKeylessGlobal;
  }
}

const script = findAutoScript(import.meta.url);
const config = parseAutoConfig(script?.dataset ?? {});

// `init` validates and stores the config synchronously, before its first `await`: every
// `<i18n-t>` upgraded by `defineI18nT()` below already finds an API key in the store.
const ready = api.init(config).catch((error: unknown) => {
  console.error("i18n-keyless: init failed", error);
});
api.defineI18nT();

const boot = () => {
  api.translateDom(document.body);
};
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

window.i18nKeyless = { ...api, ready };

export * from "./index.ts";
export { ready };

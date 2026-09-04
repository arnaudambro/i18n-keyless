import { reactive, toRef, type App, type MaybeRefOrGetter } from "vue";
import { type Lang, type Translations } from "i18n-keyless-core";
import { I18N_KEYLESS_SCOPE } from "./context.ts";
import { I18nKeylessText } from "./I18nKeylessText.ts";
import { I18nKeylessProvider, warnIfPrimaryIsMissing } from "./I18nKeylessProvider.ts";
import { hydrateFromServer, init } from "./store.ts";
import type { I18nConfig } from "./types.ts";

export interface I18nKeylessPluginOptions {
  /**
   * When given, `init(config)` is called at install time. Leave it out when you call
   * `init` yourself (e.g. once per process, before creating the app).
   */
  config?: I18nConfig;
  /**
   * The language this app instance renders in (SSR: the request's language). A ref or a
   * getter is tracked. When given, every `<T>`, `t()` and `useTranslation()` in the app
   * resolves in this language against `translations`, exactly like an
   * `<I18nKeylessProvider>` around the root. When absent, the app runs in SPA mode
   * against the store (`setCurrentLanguage`).
   */
  lang?: MaybeRefOrGetter<Lang>;
  /**
   * The translations map for `lang`: `await getServerTranslations(lang)` on the server,
   * the serialized snapshot on the client.
   */
  translations?: MaybeRefOrGetter<Translations>;
  /**
   * The language the source strings are written in (`languages.primary`). Optional when the
   * plugin also receives `config`, or when `init()` ran in this module graph: it then defaults
   * to the store's primary. See docs/SSR.md.
   */
  primary?: Lang;
  /**
   * Register `<I18nKeylessText>`, `<T>` and `<I18nKeylessProvider>` as global components.
   * Defaults to true.
   */
  registerComponents?: boolean;
}

/**
 * The app plugin: `app.use(I18nKeyless, { lang, translations })`.
 *
 * - Provides the per-request scope app-wide (`lang` + `translations`), so an SSR
 *   framework (Nuxt, Vite SSR) does not need an `<I18nKeylessProvider>` in the tree: one
 *   app instance per request means one scope per request.
 * - In the browser, seeds the store synchronously with that snapshot (`hydrateFromServer`),
 *   so the very first client render matches the server HTML, with no flash.
 * - Registers the components globally (opt out with `registerComponents: false`).
 * - Optionally calls `init(config)`.
 */
export const I18nKeyless = {
  install(app: App, options: I18nKeylessPluginOptions = {}): void {
    if (options.config) {
      init(options.config);
    }
    if (options.lang) {
      const langRef = toRef(options.lang);
      const translationsRef = toRef(options.translations ?? {});
      const primary = options.primary ?? options.config?.languages.primary;
      warnIfPrimaryIsMissing(primary);
      app.provide(I18N_KEYLESS_SCOPE, reactive({ lang: langRef, translations: translationsRef, primary }));
      if (typeof window !== "undefined") {
        hydrateFromServer({ lang: langRef.value, translations: translationsRef.value });
      }
    }
    if (options.registerComponents !== false) {
      app.component("I18nKeylessText", I18nKeylessText);
      app.component("T", I18nKeylessText);
      app.component("I18nKeylessProvider", I18nKeylessProvider);
    }
  },
};

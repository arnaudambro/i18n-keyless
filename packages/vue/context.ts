import { inject, hasInjectionContext, type InjectionKey } from "vue";
import { type Lang, type Translations } from "i18n-keyless-core";

export interface I18nKeylessContextValue {
  /**
   * The language this subtree renders in (typically derived from the URL / Accept-Language).
   */
  lang: Lang;
  /**
   * The translations map for `lang`, typically produced by `getServerTranslations(lang)`.
   */
  translations: Translations;
}

/**
 * The provide/inject key of the per-request scope. Exported so a custom provider (a Nuxt
 * plugin, a test) can `provide(I18N_KEYLESS_SCOPE, reactive({ lang, translations }))`
 * itself instead of going through `<I18nKeylessProvider>` or the `I18nKeyless` plugin.
 *
 * Its own module, with no import from the store, so both the store (`useCurrentLanguage`)
 * and the provider can read it without an import cycle.
 */
export const I18N_KEYLESS_SCOPE: InjectionKey<I18nKeylessContextValue> = Symbol.for("i18n-keyless-scope");

/**
 * Returns the nearest provided scope (`<I18nKeylessProvider>` or the `I18nKeyless` plugin),
 * or `null` when none is present. When `null`, `<I18nKeylessText>` and `t()` fall back to
 * the global store (SPA mode).
 *
 * The value is the reactive object the provider registered: reading `.lang` or
 * `.translations` inside a template, a computed or a watcher tracks it. Safe to call outside
 * `setup()` (it then returns `null` instead of warning).
 */
export function useI18nKeylessContext(): I18nKeylessContextValue | null {
  if (!hasInjectionContext()) {
    return null;
  }
  return inject(I18N_KEYLESS_SCOPE, null);
}

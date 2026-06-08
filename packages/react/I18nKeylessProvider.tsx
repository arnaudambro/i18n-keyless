import React, { createContext, useContext, useEffect } from "react";
import { type Lang, type Translations } from "i18n-keyless-core";
import { useI18nKeyless } from "./store.ts";

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

const I18nKeylessContext = createContext<I18nKeylessContextValue | null>(null);

/**
 * Returns the nearest `I18nKeylessProvider` value, or `null` when none is present.
 * When `null`, `<I18nKeylessText>` falls back to the global zustand store (SPA mode).
 */
export function useI18nKeylessContext(): I18nKeylessContextValue | null {
  return useContext(I18nKeylessContext);
}

export interface I18nKeylessProviderProps {
  /**
   * The language to render in for this subtree (typically from the URL: `/{lang}/...`
   * or `?lang={lang}`, or from `Accept-Language`).
   */
  lang: Lang;
  /**
   * The translations map for `lang`. On the server, produce it with
   * `getServerTranslations(lang)`; serialize it into the HTML and pass the same map
   * here on the client so the first client render matches the server output.
   */
  translations: Translations;
  children: React.ReactNode;
}

/**
 * Per-request language provider for SSR.
 *
 * When present, `<I18nKeylessText>` ("`<T>`") reads `lang` and `translations` from
 * this context instead of the module-scope store. This is what lets a single server
 * render produce HTML in a chosen non-primary language without leaking language state
 * across concurrent requests (the store is a process-wide singleton; the context is
 * per-render).
 *
 * On the client it additionally seeds the global store once on mount, so store-based
 * consumers (e.g. `useCurrentLanguage`) stay consistent and there is no flash after
 * hydration.
 *
 * In provider mode the language is controlled by the `lang` prop (drive it from the
 * URL). `setCurrentLanguage` is for non-provider SPA mode. See docs/SSR.md.
 */
export const I18nKeylessProvider: React.FC<I18nKeylessProviderProps> = ({ lang, translations, children }) => {
  // Client-only (effects don't run during SSR): seed the global store so reads after
  // hydration match the server-rendered, context-driven output.
  useEffect(() => {
    useI18nKeyless.setState((state) => ({
      currentLanguage: lang,
      translations: { ...state.translations, ...translations },
    }));
  }, [lang, translations]);

  return <I18nKeylessContext.Provider value={{ lang, translations }}>{children}</I18nKeylessContext.Provider>;
};

"use client";

import { createContext, useContext } from "react";
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
  /**
   * The language the source strings are written in. Carried by the provider so the
   * resolution never depends on the store's config: under Next.js the client components are
   * server-rendered in a module graph where `init()` never ran, and the store there holds
   * the default primary. See docs/SSR.md.
   */
  primary: Lang;
}

// Its own module, with no import from the store, so both the store (`useCurrentLanguage`)
// and the provider can read it without an import cycle.
export const I18nKeylessContext = createContext<I18nKeylessContextValue | null>(null);

/**
 * Returns the nearest `I18nKeylessProvider` value (`{ lang, translations, primary }`), or
 * `null` when none is present.
 * When `null`, `<I18nKeylessText>` falls back to the global zustand store (SPA mode).
 */
export function useI18nKeylessContext(): I18nKeylessContextValue | null {
  return useContext(I18nKeylessContext);
}

"use client";

import React, { useEffect } from "react";
import { type Lang, type Translations } from "i18n-keyless-core";
import { useI18nKeyless } from "./hooks.ts";
import { I18nKeylessContext } from "./context.ts";

export { useI18nKeylessContext, type I18nKeylessContextValue } from "./context.ts";

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
  /**
   * The language the source strings are written in (`languages.primary` of your config).
   *
   * Optional where the provider renders in the same module graph as `init()` (Remix,
   * TanStack Start, Astro, a hand-rolled `renderToString`): it then defaults to the store's
   * primary. **Pass it under Next.js App Router**: Next server-renders client components in
   * a second module graph where `init()` never ran, so the store there holds the default
   * primary and a subtree in the real primary language would render the source strings
   * only by coincidence. See docs/SSR.md.
   */
  primary?: Lang;
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
let warnedAboutMissingPrimary = false;

export const I18nKeylessProvider: React.FC<I18nKeylessProviderProps> = ({ lang, translations, primary, children }) => {
  const config = useI18nKeyless((state) => state.config);
  // The provider is the one source of the primary language for its subtree: the hooks read
  // it from context and never from the store, so a store that never ran `init()` (Next's
  // SSR module graph) cannot make them mistake the request language for the source language.
  const resolvedPrimary = primary ?? config.languages.primary;

  if (process.env.NODE_ENV !== "production" && primary === undefined && !config.API_KEY && !warnedAboutMissingPrimary) {
    warnedAboutMissingPrimary = true;
    console.warn(
      "i18n-keyless: <I18nKeylessProvider> rendered without `primary` on a store where init() never ran, " +
        `so it falls back to the default primary "${config.languages.primary}". Pass primary={languages.primary}: ` +
        "Next.js renders client components in a module graph where init() does not run. See docs/SSR.md."
    );
  }

  // Client-only (effects don't run during SSR): seed the global store so reads after
  // hydration match the server-rendered, context-driven output.
  useEffect(() => {
    useI18nKeyless.setState((state) => ({
      currentLanguage: lang,
      translations: { ...state.translations, ...translations },
    }));
  }, [lang, translations]);

  return (
    <I18nKeylessContext.Provider value={{ lang, translations, primary: resolvedPrimary }}>{children}</I18nKeylessContext.Provider>
  );
};

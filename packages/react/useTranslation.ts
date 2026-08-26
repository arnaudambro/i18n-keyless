import { useEffect, useMemo } from "react";
import { type TranslationOptions } from "i18n-keyless-core";
import { useI18nKeyless, getTranslation } from "./store.ts";
import { useI18nKeylessContext } from "./I18nKeylessProvider.tsx";
import { getRequestScope, recordUsedKey } from "./request-scope.ts";

const warnAboutWhitespace = (text: string) => {
  if (process.env.NODE_ENV === "development" && text !== text.trim()) {
    console.warn(
      `i18n-keyless received text with leading/trailing whitespace: "${text}". ` +
        "This may cause inconsistencies in translations. Consider trimming the text."
    );
  }
};

/**
 * The translated *string* for `text`, resolved exactly the way `<I18nKeylessText>` resolves it.
 *
 * Use it where an element will not do — a `placeholder`, a `title`, an `aria-label`, a
 * string handed to another library. Everywhere else prefer `<I18nKeylessText>`, which is
 * this hook plus a fragment.
 *
 * It is a hook, so unlike `getTranslation()` it is reactive (re-renders when the
 * translation lands or the language changes) and, under SSR, it reads the request's
 * language from `<I18nKeylessProvider>` — which is what makes it correct in frameworks that
 * render the component tree outside the `runWithI18nKeyless` scope (TanStack Start). See
 * docs/SSR.md.
 */
export function useTranslation(text: string, options: TranslationOptions = {}): string {
  return useTranslationState(text, options).text;
}

/**
 * The hook behind `useTranslation` and `<I18nKeylessText>`. Also hands back the language the
 * text resolved in, which the component uses to key its fragment. Not exported from the
 * package: `useTranslation` is the public surface.
 */
export function useTranslationState(text: string, options: TranslationOptions = {}): { text: string; lang: string | null } {
  const { replace, context, namespace, unpersistedNamespace, debug = false, forceTemporary, originLanguage } =
    options;

  // Trim the source text immediately. Pure computation, kept above the hooks so the
  // translation selector below can close over this call's own storage key.
  const sourceText = text.trim();
  const storageKey = context ? `${sourceText}__${context}` : sourceText;

  // Select ONLY this key's translation, never the whole `translations` map. Every batch
  // that lands replaces the map with a new object, so a map selector makes zustand
  // re-render every caller on the page — including the ones whose text did not change, and
  // the ones belonging to another namespace entirely. Selecting the string keeps the
  // default Object.is check meaningful: a caller re-renders only when its own text changes.
  // See __tests__/render-count.test.tsx.
  const storeTranslation = useI18nKeyless((store) => store.translations[storageKey]);
  const storeCurrentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const config = useI18nKeyless((store) => store.config);

  // In SSR mode, language and translations come from the per-request scope so concurrent
  // requests don't share state: the React-context provider first, then the
  // AsyncLocalStorage request scope (set by runWithI18nKeyless). Otherwise (SPA mode)
  // both are absent and we use the global store. See docs/SSR.md.
  const requestScope = useI18nKeylessContext() ?? getRequestScope();
  const translation = requestScope?.translations ? requestScope.translations[storageKey] : storeTranslation;
  const currentLanguage = requestScope?.lang ?? storeCurrentLanguage;

  useEffect(() => {
    warnAboutWhitespace(text);
  }, [text]);

  // Translate-on-miss. In an effect, so it never runs on the server and never writes to
  // the store during render.
  useEffect(() => {
    getTranslation(sourceText, { context, namespace, unpersistedNamespace, debug, forceTemporary, originLanguage });
  }, [sourceText, currentLanguage, context, namespace, unpersistedNamespace, debug, forceTemporary, originLanguage]);

  // Record the key for the per-page SSR snapshot (no-op off-server; pure Set.add, no
  // setState, so no render-time update warning). See docs/SSR.md.
  recordUsedKey(storageKey);

  // The text renders as-is when the current language is the one it's written in: the
  // primary language, except for UGC (originLanguage) — a UGC key looks up the map even
  // when the current language is the primary one.
  const sourceLanguage =
    originLanguage && originLanguage !== config!.languages.primary ? originLanguage : config!.languages.primary;
  const translatedText = currentLanguage === sourceLanguage ? sourceText : translation || sourceText;

  const finalText = useMemo(() => {
    if (!replace) {
      return translatedText;
    }

    // Create a regex that matches all keys to replace
    // Escape special regex characters in keys
    const pattern = Object.keys(replace)
      .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");

    const regex = new RegExp(pattern, "g");

    // Replace all occurrences in a single pass
    return translatedText.replace(regex, (matched) => replace[matched] || matched);
  }, [translatedText, replace]);

  if (debug) {
    console.log({
      text,
      sourceText,
      currentLanguage,
      translatedText,
      finalText,
      replace,
      context,
      forceTemporary,
      originLanguage
    });
  }

  return { text: finalText, lang: currentLanguage };
}

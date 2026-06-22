import React, { useEffect, useMemo } from "react";
import { type TranslationOptions } from "i18n-keyless-core";
import { useI18nKeyless, getTranslation } from "./store.ts";
import { useI18nKeylessContext } from "./I18nKeylessProvider.tsx";
import { getRequestScope, recordUsedKey } from "./request-scope.ts";

export interface I18nKeylessTextProps {
  /**
   * The `children` prop must be a string.
   * It's the text to translate from your primary language.
   */
  children: string | React.ReactNode;
  /**
   * The keys to replace in the text.
   * It's an object where the key is the placeholder and the value is the replacement.
   * Example: { "{{name}}": "John" } will replace all the {{name}} in the text with "John".
   * RegEx is `key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))` so you can use use your own syntax.
   */
  replace?: TranslationOptions["replace"];
  /**
   * The context of the translation.
   * It's useful for ambiguous translations, like "8 heures" in French could be "8 AM" or "8 hours".
   */
  context?: TranslationOptions["context"];
  /**
   * The namespace this translation belongs to. Translations are fetched and persisted per
   * namespace, so splitting a large app into namespaces keeps each storage item small
   * (avoids the localStorage quota error). Defaults to `defaultNamespace` from config.
   */
  namespace?: TranslationOptions["namespace"];
  /**
   * When true, this namespace's translations live in memory only (never persisted, never
   * reloaded at boot). Use for high-cardinality, transient namespaces (e.g. one per discussion).
   */
  unpersistedNamespace?: TranslationOptions["unpersistedNamespace"];
  /**
   * If true, some helpful logs will be displayed in the console.
   */
  debug?: TranslationOptions["debug"];
  /**
   * If the proposed translation from AI is not satisfactory,
   * you can use this field to setup your own translation.
   * You can leave it there forever, or remove it once your translation is saved.
   */
  forceTemporary?: TranslationOptions["forceTemporary"];
}

const warnAboutWhitespace = (text: string) => {
  if (process.env.NODE_ENV === "development" && text !== text.trim()) {
    console.warn(
      `I18nKeylessText received text with leading/trailing whitespace: "${text}". ` +
        "This may cause inconsistencies in translations. Consider trimming the text."
    );
  }
};

export const I18nKeylessText: React.FC<I18nKeylessTextProps> = ({
  children,
  replace,
  context,
  namespace,
  unpersistedNamespace,
  debug = false,
  forceTemporary
}) => {
  const storeTranslations = useI18nKeyless((store) => store.translations);
  const storeCurrentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const config = useI18nKeyless((store) => store.config);

  // In SSR mode, language and translations come from the per-request scope so concurrent
  // requests don't share state: the React-context provider first, then the
  // AsyncLocalStorage request scope (set by runWithI18nKeyless). Otherwise (SPA mode)
  // both are absent and we use the global store. See docs/SSR.md.
  const requestScope = useI18nKeylessContext() ?? getRequestScope();
  const translations = requestScope?.translations ?? storeTranslations;
  const currentLanguage = requestScope?.lang ?? storeCurrentLanguage;

  // Trim the source text immediately
  const rawText = Array.isArray(children) ? children.join("") : String(children ?? "");
  const sourceText = rawText.trim();

  useEffect(() => {
    warnAboutWhitespace(rawText);
  }, [rawText]);

  useEffect(() => {
    getTranslation(sourceText, { context, namespace, unpersistedNamespace, debug, forceTemporary });
  }, [sourceText, currentLanguage, context, namespace, unpersistedNamespace, debug, forceTemporary]);

  const storageKey = context ? `${sourceText}__${context}` : sourceText;
  // Record the key for the per-page SSR snapshot (no-op off-server; pure Set.add, no
  // setState, so no render-time update warning). See docs/SSR.md.
  recordUsedKey(storageKey);
  const translatedText =
    currentLanguage === config!.languages.primary ? sourceText : translations[storageKey] || sourceText;
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
      children,
      sourceText,
      currentLanguage,
      translatedText,
      finalText,
      replace,
      context,
      forceTemporary
    });
  }
  return <React.Fragment key={currentLanguage}>{finalText}</React.Fragment>;
};

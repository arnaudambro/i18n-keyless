import React, { useEffect, useMemo } from "react";
import { useI18nKeyless } from "./store";
import { TranslationOptions } from "i18n-keyless-core";

export interface I18nKeylessTextProps {
  /**
   * The `children` prop must be a string.
   * It's the text to translate from your primary language.
   */
  children: string;
  /**
   * The keys to replace in the text.
   * It's an object where the key is the placeholder and the value is the replacement.
   * Example: { "{{name}}": "John" } will replace all the {{name}} in the text with "John".
   * RegEx is `key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))` so you can use use your own syntax.
   */
  replace?: Record<string, string>;
  /**
   * The context of the translation.
   * It's useful for ambiguous translations, like "8 heures" in French could be "8 AM" or "8 hours".
   */
  context?: TranslationOptions["context"];
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

export const I18nKeylessText: React.FC<I18nKeylessTextProps> = ({
  children,
  replace,
  context,
  debug = false,
  forceTemporary,
}) => {
  const translations = useI18nKeyless((store) => store.translations);
  const currentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const config = useI18nKeyless((store) => store.config);
  const translateKey = useI18nKeyless((store) => store.translateKey);

  useEffect(() => {
    translateKey(children, { context, debug, forceTemporary });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, currentLanguage, context, debug, forceTemporary]);

  const translatedText =
    currentLanguage === config!.languages.primary
      ? children
      : translations[context ? `${children}__${context}` : children] || children;
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
      currentLanguage,
      translatedText,
      finalText,
      replace,
      context,
      forceTemporary,
    });
  }
  return <React.Fragment key={currentLanguage}>{finalText}</React.Fragment>;
};

import React, { useEffect, useMemo } from "react";
import { useI18nKeyless } from "./store";
import { TranslationOptions } from "i18n-keyless-core";

export interface I18nKeylessTextProps {
  /**
   * children must be a string
   * it's the text to translate from your primary language
   */
  children: string;
  /**
   * the keys to replace in the text
   * it's an object where the key is the placeholder and the value is the replacement
   * example: { "{{name}}": "John" } will replace all the {{name}} in the text with "John"
   * RegEx is `key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))` so you can use use your own syntax
   */
  replace?: Record<string, string>;
  /**
   * the context of the translation
   * it's useful for ambiguous translations, like "8 heures" in French could be "8 AM" or "8 hours"
   */
  context?: string;
  /**
   * if true, some helpful logs will be displayed in the console
   */
  debug?: boolean;
  /**
   * if true, the translation will be saved as temporary
   * it's useful if you want to use the translation in a different context
   * you can leave it there forever, or remove it once your translation is saved
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

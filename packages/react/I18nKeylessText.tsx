import React, { useEffect, useMemo } from "react";
import { type TranslationOptions } from "i18n-keyless-core";
import { useI18nKeyless, getTranslation } from "./store";

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
  debug = false,
  forceTemporary,
}) => {
  const translations = useI18nKeyless((store) => store.translations);
  const currentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const config = useI18nKeyless((store) => store.config);

  // Trim the source text immediately
  const sourceText = children.trim();

  useEffect(() => {
    warnAboutWhitespace(children);
  }, [children]);

  useEffect(() => {
    getTranslation(sourceText, { context, debug, forceTemporary });
  }, [sourceText, currentLanguage, context, debug, forceTemporary]);

  const translatedText =
    currentLanguage === config!.languages.primary
      ? sourceText
      : translations[context ? `${sourceText}__${context}` : sourceText] || sourceText;
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
      forceTemporary,
    });
  }
  return <React.Fragment key={currentLanguage}>{finalText}</React.Fragment>;
};

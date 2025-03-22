import React, { useEffect, useMemo } from "react";
import { useI18nKeyless } from "./store";

interface I18nKeylessTextProps {
  children: string;
  replace?: Record<string, string>;
  context?: string;
  debug?: boolean;
}

export const I18nKeylessText: React.FC<I18nKeylessTextProps> = ({ children, replace, context, debug = false }) => {
  const translations = useI18nKeyless((store) => store.translations);
  const currentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const config = useI18nKeyless((store) => store.config);
  const translateKey = useI18nKeyless((store) => store.translateKey);

  useEffect(() => {
    translateKey(children, { context, debug });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, currentLanguage, context, debug]);

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
    console.log(
      "children",
      children,
      "translatedText",
      translatedText,
      "finalText",
      finalText,
      "replace",
      replace,
      "context",
      context
    );
  }
  return <React.Fragment key={currentLanguage}>{finalText}</React.Fragment>;
};

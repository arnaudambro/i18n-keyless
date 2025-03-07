import React, { useEffect, useMemo } from "react";
import { useI18nKeyless } from "./store";

interface I18nTextProps {
  children: string;
}

export const I18nKeylessText: React.FC<I18nTextProps> = ({ children }) => {
  const translations = useI18nKeyless((store) => store.translations);
  const currentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const config = useI18nKeyless((store) => store.config);
  const translateKey = useI18nKeyless((store) => store.translateKey);

  useEffect(() => {
    translateKey(children);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, currentLanguage]);

  const translatedText = currentLanguage === config!.languages.primary ? children : translations[children] || children;
  return <React.Fragment key={currentLanguage}>{translatedText}</React.Fragment>;
};

interface I18nKeylessTextWithReplacementProps {
  children: string;
  replace?: Record<string, string>;
}

export const I18nKeylessTextWithReplacement: React.FC<I18nKeylessTextWithReplacementProps> = ({
  children,
  replace,
}) => {
  const translations = useI18nKeyless((store) => store.translations);
  const currentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const config = useI18nKeyless((store) => store.config);
  const translateKey = useI18nKeyless((store) => store.translateKey);

  useEffect(() => {
    translateKey(children);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, currentLanguage]);

  const translatedText = currentLanguage === config!.languages.primary ? children : translations[children] || children;
  const replacedText = useMemo(() => {
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

  return <React.Fragment key={currentLanguage}>{replacedText}</React.Fragment>;
};

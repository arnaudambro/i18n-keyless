import React, { useEffect } from "react";
import { useI18nKeyless } from "./store";

type MyI18nTextProps = {
  children: string;
};

export const I18nText: React.FC<MyI18nTextProps> = ({ children }) => {
  const translations = useI18nKeyless((store) => store.translations);
  const currentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const config = useI18nKeyless((store) => store.config);
  const translateKey = useI18nKeyless((store) => store.translateKey);

  useEffect(() => {
    translateKey(children);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, currentLanguage]);

  if (!config) {
    return null;
  }

  const translatedText = currentLanguage === config.languages.primary ? children : translations[children] || children;

  return <React.Fragment key={currentLanguage}>{translatedText}</React.Fragment>;
};

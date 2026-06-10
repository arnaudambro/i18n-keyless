import { I18nKeylessText, useCurrentLanguage, setCurrentLanguage, type Lang } from "i18n-keyless-react";
import { SUPPORTED_LANGUAGES } from "../i18n";

// Cycles through the supported languages. `setCurrentLanguage` updates the store and
// fetches the new language's translations; `useCurrentLanguage` re-renders on change.
export function LanguageSwitcher() {
  const currentLanguage = useCurrentLanguage();
  return (
    <button
      className="switch"
      onClick={() => {
        const i = SUPPORTED_LANGUAGES.indexOf(currentLanguage as SupportedTuple);
        const next = SUPPORTED_LANGUAGES[(i + 1) % SUPPORTED_LANGUAGES.length];
        setCurrentLanguage(next as Lang);
      }}
    >
      <I18nKeylessText>Changer de langue</I18nKeylessText> ({currentLanguage})
    </button>
  );
}

type SupportedTuple = (typeof SUPPORTED_LANGUAGES)[number];

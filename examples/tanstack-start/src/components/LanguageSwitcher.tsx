import { I18nKeylessText, useCurrentLanguage, setCurrentLanguage, type Lang } from "i18n-keyless-react";
import { SUPPORTED_LANGUAGES } from "../i18n";

// Client-side instant switch. (The INITIAL server-rendered language comes from `?lang=` —
// see src/server.ts. Try /about?lang=en to get English HTML from the server.)
export function LanguageSwitcher() {
  const currentLanguage = useCurrentLanguage();
  return (
    <button
      className="switch"
      onClick={() => {
        const list = SUPPORTED_LANGUAGES as readonly Lang[];
        const i = list.indexOf((currentLanguage ?? "fr") as Lang);
        setCurrentLanguage(list[(i + 1) % list.length]);
      }}
    >
      <I18nKeylessText>Changer de langue</I18nKeylessText> ({currentLanguage})
    </button>
  );
}

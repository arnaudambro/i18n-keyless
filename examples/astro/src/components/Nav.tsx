import { I18nKeylessText, useCurrentLanguage, type Lang } from "i18n-keyless-react";
import { SUPPORTED_LANGUAGES } from "../i18n";

export function Nav({ lang }: { lang: string }) {
  const current = (useCurrentLanguage() ?? lang) as Lang;
  return (
    <header>
      <h1>i18n-keyless · Astro</h1>
      <nav>
        <a href={`/${current}`}>
          <I18nKeylessText>Accueil</I18nKeylessText>
        </a>
        <a href={`/${current}/about`}>
          <I18nKeylessText>À propos</I18nKeylessText>
        </a>
        <button
          className="switch"
          onClick={() => {
            const list = SUPPORTED_LANGUAGES as readonly Lang[];
            const next = list[(list.indexOf(current) + 1) % list.length];
            window.location.href = `/${next}`; // full nav → Astro re-renders in the new language
          }}
        >
          <I18nKeylessText>Changer de langue</I18nKeylessText> ({current})
        </button>
      </nav>
    </header>
  );
}

import { I18nKeylessText, useI18nKeylessContext, useCurrentLanguage } from "i18n-keyless-react";

// Page A — COMPONENT path (<I18nKeylessText>) + the `replace` option.
export function HomeContent() {
  // Read the active language from the provider (correct on both server and client) and fall
  // back to the store for SPA mode. Reading useCurrentLanguage() alone would show the global
  // store's language on the server (the primary), not the request's → hydration mismatch.
  const contextLang = useI18nKeylessContext()?.lang;
  const storeLang = useCurrentLanguage();
  const currentLanguage = contextLang ?? storeLang;
  return (
    <section className="card">
      <p className="lang-line">
        <I18nKeylessText replace={{ "{{current_lang}}": currentLanguage ?? "" }}>
          {`Langue : {{current_lang}}`}
        </I18nKeylessText>
      </p>
      <p>
        <I18nKeylessText>
          Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le
          souhaitez.
        </I18nKeylessText>
      </p>
      <p className="muted">
        <I18nKeylessText>
          Attention, vous traduisez en 15 langues, cela prend plus de temps que 2 ou 5, qui sont des
          cas d'usage plus courants.
        </I18nKeylessText>
      </p>
    </section>
  );
}

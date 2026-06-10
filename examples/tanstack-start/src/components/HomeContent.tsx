import { I18nKeylessText, useCurrentLanguage } from "i18n-keyless-react";

// Page A — component path (<I18nKeylessText>) + the `replace` option.
export function HomeContent() {
  const currentLanguage = useCurrentLanguage();
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

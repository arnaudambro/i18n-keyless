import { I18nKeylessText, getTranslation, useCurrentLanguage } from "i18n-keyless-react";

// Page B — getTranslation() function + `context`. As with Next, the function path renders
// the primary language during SSR and resolves after hydration (no render hook for
// runWithI18nKeyless in island mode); <T> above is SSR-correct. See the README.
export function AboutContent() {
  useCurrentLanguage();

  const intro = getTranslation(
    "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>."
  );
  const asTime = getTranslation("8 heures", { context: "heure" });
  const asDuration = getTranslation("8 heures", { context: "durée" });

  return (
    <section className="card">
      <h2>
        <I18nKeylessText>À propos de cette démo</I18nKeylessText>
      </h2>
      <p>{intro}</p>
      <p className="context-line">
        <code>8 heures</code> (heure) → <strong>{asTime}</strong>
        {"  ·  "}
        <code>8 heures</code> (durée) → <strong>{asDuration}</strong>
      </p>
    </section>
  );
}

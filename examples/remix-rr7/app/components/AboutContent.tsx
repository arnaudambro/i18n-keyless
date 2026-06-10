import { I18nKeylessText, getTranslation, useCurrentLanguage } from "i18n-keyless-react";

// Page B — different strings, the imperative getTranslation() function, and `context`.
export function AboutContent() {
  useCurrentLanguage(); // re-render (and re-run getTranslation) on language change

  const intro = getTranslation(
    "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>."
  );
  const note = getTranslation(
    "Cette page utilise des chaînes différentes de la page d'accueil — en SSR, chaque page ne sérialise que ses propres clés."
  );
  const asTime = getTranslation("8 heures", { context: "heure" });
  const asDuration = getTranslation("8 heures", { context: "durée" });

  return (
    <section className="card">
      <h2>
        <I18nKeylessText>À propos de cette démo</I18nKeylessText>
      </h2>
      <p>{intro}</p>
      <p className="muted">{note}</p>
      <p className="context-line">
        <code>8 heures</code> (heure) → <strong>{asTime}</strong>
        {"  ·  "}
        <code>8 heures</code> (durée) → <strong>{asDuration}</strong>
      </p>
    </section>
  );
}

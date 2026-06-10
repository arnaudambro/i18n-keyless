import { I18nKeylessText, getTranslation, useCurrentLanguage } from "i18n-keyless-react";

// Page B — DIFFERENT strings than Home (so the per-page SSR snapshot serializes a
// different key subset), the imperative getTranslation() function, and the `context` option.
export function AboutContent() {
  useCurrentLanguage(); // re-render (and re-run getTranslation) on language change

  const intro = getTranslation(
    "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>."
  );
  const note = getTranslation(
    "Cette page utilise des chaînes différentes de la page d'accueil — en SSR, chaque page ne sérialise que ses propres clés."
  );
  // `context` disambiguates "8 heures" → "8 AM" (a time) vs "8 hours" (a duration).
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

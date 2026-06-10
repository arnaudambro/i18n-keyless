"use client";

import { I18nKeylessText, getTranslation, useCurrentLanguage } from "i18n-keyless-react";

// Page B — the imperative getTranslation() function + `context`. NOTE: in Next App Router,
// getTranslation renders the PRIMARY language during SSR (no render hook for
// runWithI18nKeyless) and resolves to the target language after hydration. <T> (above) has
// no such flash. See the README.
export function AboutContent() {
  useCurrentLanguage(); // re-render on language change

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

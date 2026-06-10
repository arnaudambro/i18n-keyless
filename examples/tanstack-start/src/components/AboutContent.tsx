import { I18nKeylessText } from "i18n-keyless-react";

export interface AboutContentProps {
  intro: string;
  note: string;
  asTime: string;
  asDuration: string;
}

// Page B — mixes BOTH paths:
//  • the <h2> uses the COMPONENT path (<I18nKeylessText>, resolved by <I18nKeylessProvider>)
//  • intro / note / asTime / asDuration come from the FUNCTION path: the imperative
//    getTranslation() runs in this route's loader (see routes/about.tsx) and is passed in as
//    props. This also demonstrates the `context` option ("8 heures" → time vs duration).
export function AboutContent({ intro, note, asTime, asDuration }: AboutContentProps) {
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

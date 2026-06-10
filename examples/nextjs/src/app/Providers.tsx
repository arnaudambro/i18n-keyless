"use client";

import { useEffect, type ReactNode } from "react";
import { I18nKeylessProvider, hydrateFromServer, type Translations } from "i18n-keyless-react";
import { initI18nClient } from "../i18n";

// Client boundary. Next serializes `translations` (fetched in the server layout) into the
// RSC payload automatically — no manual <script> needed.
//
// - <I18nKeylessProvider> makes the <T> component SSR-correct (it reads the provider via
//   React context, available during Next's server render of client components).
// - hydrateFromServer + initI18nClient run in an effect: getTranslation(...) renders the
//   PRIMARY language on the server and on the first client render (no hydration mismatch),
//   then resolves to `lang` after this effect. (Prefer <T> if you want zero flash for the
//   function path — Next App Router doesn't expose a render hook for runWithI18nKeyless.)
export function Providers({
  lang,
  translations,
  children,
}: {
  lang: string;
  translations: Translations;
  children: ReactNode;
}) {
  useEffect(() => {
    hydrateFromServer({ lang: lang as never, translations });
    initI18nClient();
  }, [lang, translations]);

  return (
    <I18nKeylessProvider lang={lang as never} translations={translations}>
      {children}
    </I18nKeylessProvider>
  );
}

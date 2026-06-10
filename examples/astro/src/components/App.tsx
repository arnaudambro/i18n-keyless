import { useEffect } from "react";
import { I18nKeylessProvider, hydrateFromServer, type Translations } from "i18n-keyless-react";
import { initI18nClient } from "../i18n";
import { Nav } from "./Nav";
import { HomeContent } from "./HomeContent";
import { AboutContent } from "./AboutContent";

// The whole app as one React island. Astro server-renders it (so <I18nKeylessText> is
// SSR-correct via the provider) and hydrates it on the client (client:load). Astro
// serializes the props automatically — no manual <script> needed.
export default function App({
  lang,
  translations,
  page,
}: {
  lang: string;
  translations: Translations;
  page: "home" | "about";
}) {
  useEffect(() => {
    hydrateFromServer({ lang: lang as never, translations });
    initI18nClient();
  }, [lang, translations]);

  return (
    <I18nKeylessProvider lang={lang as never} translations={translations}>
      <main className="app">
        <Nav lang={lang} />
        {page === "home" ? <HomeContent /> : <AboutContent />}
      </main>
    </I18nKeylessProvider>
  );
}

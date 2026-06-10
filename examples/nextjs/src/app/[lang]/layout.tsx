import type { ReactNode } from "react";
import { getServerTranslations } from "i18n-keyless-react";
import { initI18nServer, normalizeLang, SUPPORTED_LANGUAGES } from "../../i18n";
import { Providers } from "../Providers";
import { Nav } from "../../components/Nav";
import "../globals.css";

export function generateStaticParams() {
  return SUPPORTED_LANGUAGES.map((lang) => ({ lang }));
}

// Server component: fetch the language's translations and hand them to the client boundary.
export default async function LangLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const lang = normalizeLang((await params).lang);
  await initI18nServer();
  const translations = await getServerTranslations(lang);

  return (
    <html lang={lang}>
      <body>
        <Providers lang={lang} translations={translations}>
          <main className="app">
            <Nav />
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}

import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  I18nKeylessText,
  I18nKeylessProvider,
  getServerTranslations,
  useI18nKeyless,
  type Lang,
  type Translations,
} from "i18n-keyless-react";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { normalizeLang } from "../i18n";
import appCss from "../styles.css?url";

interface RootLoaderData {
  lang: Lang;
  translations: Translations;
}

export const Route = createRootRoute({
  // `?lang=` must be validated to be readable in `loaderDeps`.
  validateSearch: (search: Record<string, unknown>): { lang?: string } => ({
    lang: typeof search.lang === "string" ? search.lang : undefined,
  }),
  // Re-run the loader when `?lang=` changes (URL is the single source of truth).
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // Feed the COMPONENT PATH. The React tree renders outside the ALS in TanStack Start, so
  // `<I18nKeylessText>` can't read the request scope — it reads `<I18nKeylessProvider>`
  // instead. We hand the provider `{ lang, translations }` through the loader, which TanStack
  // serializes into the HTML and replays identically on the client → no hydration mismatch.
  loader: async ({ deps }): Promise<RootLoaderData> => {
    const lang = normalizeLang(deps.lang);
    const translations =
      typeof window === "undefined"
        ? await getServerTranslations(lang) // server: fetch the full map for this language
        : useI18nKeyless.getState().translations; // client nav: reuse what the store already has
    return { lang, translations };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "i18n-keyless · TanStack Start" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

// Drives <I18nKeylessProvider> from the (serialized) loader data. Same data server + client.
function AppI18nProvider({ children }: { children: ReactNode }) {
  const data = Route.useLoaderData() as RootLoaderData | undefined;
  return (
    <I18nKeylessProvider lang={data?.lang ?? "fr"} translations={data?.translations ?? {}}>
      {children}
    </I18nKeylessProvider>
  );
}

function RootComponent() {
  const data = Route.useLoaderData() as RootLoaderData | undefined;
  return (
    <html lang={data?.lang ?? "fr"}>
      <head>
        <HeadContent />
      </head>
      <body>
        {/* Everything that uses <I18nKeylessText> must be inside the provider. */}
        <AppI18nProvider>
          <main className="app">
            <header>
              <h1>i18n-keyless · TanStack Start</h1>
              <nav>
                {/* Preserve `?lang=` across navigation (URL is the source of truth). */}
                <Link to="/" search={(prev) => prev} activeProps={{ className: "active" }}>
                  <I18nKeylessText>Accueil</I18nKeylessText>
                </Link>
                <Link to="/about" search={(prev) => prev} activeProps={{ className: "active" }}>
                  <I18nKeylessText>À propos</I18nKeylessText>
                </Link>
                <LanguageSwitcher />
              </nav>
            </header>
            <Outlet />
          </main>
        </AppI18nProvider>
        <Scripts />
      </body>
    </html>
  );
}

import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import { I18nKeylessText } from "i18n-keyless-react";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { I18nKeylessSnapshot } from "../components/I18nKeylessSnapshot";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
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

function RootComponent() {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        <main className="app">
          <header>
            <h1>i18n-keyless · TanStack Start</h1>
            <nav>
              <Link to="/" activeProps={{ className: "active" }}>
                <I18nKeylessText>Accueil</I18nKeylessText>
              </Link>
              <Link to="/about" activeProps={{ className: "active" }}>
                <I18nKeylessText>À propos</I18nKeylessText>
              </Link>
              <LanguageSwitcher />
            </nav>
          </header>
          <Outlet />
        </main>
        {/* Placed AFTER <Outlet /> so it captures every key the page rendered. */}
        <I18nKeylessSnapshot />
        <Scripts />
      </body>
    </html>
  );
}

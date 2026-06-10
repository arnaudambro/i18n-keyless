import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, Link } from "react-router";
import { I18nKeylessText } from "i18n-keyless-react";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { I18nKeylessSnapshot } from "./components/I18nKeylessSnapshot";
import "./styles.css";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        {/* After the app content, so it captures every key the page rendered. */}
        <I18nKeylessSnapshot />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <main className="app">
      <header>
        <h1>i18n-keyless · React Router 7</h1>
        <nav>
          <Link to="/">
            <I18nKeylessText>Accueil</I18nKeylessText>
          </Link>
          <Link to="/about">
            <I18nKeylessText>À propos</I18nKeylessText>
          </Link>
          <LanguageSwitcher />
        </nav>
      </header>
      <Outlet />
    </main>
  );
}

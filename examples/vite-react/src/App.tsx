import { useState } from "react";
import { I18nKeylessText } from "i18n-keyless-react";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { Home } from "./pages/Home";
import { About } from "./pages/About";

type Page = "home" | "about";

// A tiny two-view "router" (no router dependency) so the demo stays focused on
// i18n-keyless. Switching views is client-side navigation: translations persist across it.
export function App() {
  const [page, setPage] = useState<Page>("home");
  return (
    <main className="app">
      <header>
        <h1>i18n-keyless · Vite + React</h1>
        <nav>
          <button className={page === "home" ? "active" : ""} onClick={() => setPage("home")}>
            <I18nKeylessText>Accueil</I18nKeylessText>
          </button>
          <button className={page === "about" ? "active" : ""} onClick={() => setPage("about")}>
            <I18nKeylessText>À propos</I18nKeylessText>
          </button>
          <LanguageSwitcher />
        </nav>
      </header>
      {page === "home" ? <Home /> : <About />}
    </main>
  );
}

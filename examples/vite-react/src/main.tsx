import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "./i18n";
import { App } from "./App";
import "./styles.css";

// Start i18n-keyless. It's async (it fetches translations for the current language in the
// background); the app renders immediately in the primary language and re-renders into the
// target language as translations arrive — and instantly on later visits from storage.
initI18n();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

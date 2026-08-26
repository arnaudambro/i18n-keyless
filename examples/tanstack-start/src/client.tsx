import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { initI18nClient } from "./i18n";

// The per-request { lang, translations } travels through the root loader (TanStack serializes
// it into the HTML and replays it here), and <I18nKeylessProvider> seeds the store from it on
// mount — so there is no manual snapshot to read before hydration. We just init the client
// store so background fetches and client-side language switches have the full language set.
initI18nClient();

// The router comes from `getRouter()` in src/router.tsx; the Start plugin wires it in.
hydrateRoot(document, <StartClient />);

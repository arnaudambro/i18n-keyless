import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { hydrateFromServer } from "i18n-keyless-react";
import { initI18nClient } from "./i18n";

// 1. Seed the store SYNCHRONOUSLY from the server snapshot, before hydration → no blink.
const snapshotEl = document.getElementById("i18n-keyless");
if (snapshotEl?.textContent) {
  hydrateFromServer(JSON.parse(snapshotEl.textContent));
}
// 2. init() so client-side navigation has the full language set in the background.
initI18nClient();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});

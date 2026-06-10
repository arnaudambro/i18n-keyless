import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start";
import { hydrateFromServer } from "i18n-keyless-react";
import { createRouter } from "./router";
import { initI18nClient } from "./i18n";

// 1. Seed the store SYNCHRONOUSLY from the server snapshot, before the first render, so
//    getTranslation(...) returns the right language on render 1 — no blink, no mismatch.
const snapshotEl = document.getElementById("i18n-keyless");
if (snapshotEl?.textContent) {
  hydrateFromServer(JSON.parse(snapshotEl.textContent));
}

// 2. init() so client-side navigation fetches the FULL language set in the background
//    (the SSR snapshot only carried this page's keys).
initI18nClient();

const router = createRouter();
hydrateRoot(document, <StartClient router={router} />);

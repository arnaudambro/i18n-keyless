import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { getServerTranslations, runWithI18nKeyless } from "i18n-keyless-react";
import { initI18nServer, langFromRequest } from "./i18n";

// Initialize i18n-keyless once per server process (so getServerTranslations has config).
await initI18nServer();

// Wrap the whole render in a per-request i18n scope. Inside it, BOTH the <T> component and
// the imperative getTranslation(...) resolve in `lang` — and each render records exactly
// which keys it used (see src/components/I18nKeylessSnapshot.tsx). AsyncLocalStorage keeps
// this isolated across concurrent requests, even through streaming.
const i18nHandler = defineHandlerCallback(async (ctx) => {
  const lang = langFromRequest(ctx.request);
  const translations = await getServerTranslations(lang);
  return runWithI18nKeyless({ lang, translations }, () => defaultStreamHandler(ctx));
});

const fetch = createStartHandler(i18nHandler);

export default createServerEntry({ fetch });

import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { getServerTranslations, runWithI18nKeyless } from "i18n-keyless-react";
import { initI18nServer, langFromRequest } from "./i18n";

// Initialize i18n-keyless once per server process (so getServerTranslations has config).
await initI18nServer();

const baseHandler = createStartHandler(defaultStreamHandler);

// Wrap the ENTIRE request in a per-request i18n scope — NOT just the render callback.
//
// `createStartHandler` resolves `head()` and route `loader`s AROUND the stream-render
// callback. If we wrapped only `defaultStreamHandler` (the inner render), `head()` and the
// loaders would run OUTSIDE the AsyncLocalStorage scope → the imperative `getTranslation()`
// on the *function path* (loaders, head) would fall back to the primary language.
//
// Wrapping the whole `fetch` puts loaders + head() inside the scope, so `getTranslation()`
// resolves in `lang`. (The *component path* — `<I18nKeylessText>` in the body — does NOT
// rely on this; it reads `<I18nKeylessProvider>` context instead, because in TanStack Start
// the React component tree renders outside the ALS. See __root.tsx and the README.)
//
// AsyncLocalStorage keeps this isolated across concurrent requests, even through streaming.
const fetch = (async (request: Request, ...rest: unknown[]) => {
  const lang = langFromRequest(request);
  const translations = await getServerTranslations(lang);
  return runWithI18nKeyless({ lang, translations }, () =>
    (baseHandler as (request: Request, ...rest: unknown[]) => Response | Promise<Response>)(request, ...rest)
  );
}) as typeof baseHandler;

export default createServerEntry({ fetch });

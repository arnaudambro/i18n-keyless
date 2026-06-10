import { getUsedTranslationsSnapshot } from "i18n-keyless-react";

// Serializes the per-page translation snapshot into the HTML, so the client can seed the
// store synchronously (see src/client.tsx). MUST be rendered AFTER the page content (placed
// after <Outlet /> in __root) so every key the page used has been recorded by then.
//
// Server: reads the used-keys snapshot from the AsyncLocalStorage scope.
// Client (hydration): no scope, so it reproduces the SAME JSON from the already-rendered
// <script> in the DOM — keeping server and client output identical (no hydration mismatch).
export function I18nKeylessSnapshot() {
  const fromScope = getUsedTranslationsSnapshot();
  const json = fromScope
    ? JSON.stringify(fromScope)
    : typeof document !== "undefined"
      ? document.getElementById("i18n-keyless")?.textContent
      : null;
  if (!json) return null;
  return (
    <script id="i18n-keyless" type="application/json" dangerouslySetInnerHTML={{ __html: json }} />
  );
}

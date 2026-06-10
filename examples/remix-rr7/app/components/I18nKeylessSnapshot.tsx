import { getUsedTranslationsSnapshot } from "i18n-keyless-react";

// Serializes the per-page translation snapshot into the HTML. MUST render AFTER the page
// content (placed after the app/Outlet in root.tsx). Server: reads the used-keys snapshot
// from the AsyncLocalStorage scope. Client (hydration): reproduces the same JSON from the
// already-rendered <script> so there's no hydration mismatch.
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

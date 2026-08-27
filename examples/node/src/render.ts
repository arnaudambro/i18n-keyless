import { awaitForTranslationOrFallbackToOriginal, type Lang } from "i18n-keyless-node";
import { initI18n, SUPPORTED_LANGUAGES, PRIMARY } from "./i18n";

export function langFromUrl(url: string): Lang {
  const value = new URL(url, "http://localhost").searchParams.get("lang");
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value ?? "") ? (value as Lang) : PRIMARY;
}

// Renders an HTML page in `lang` using the Node SDK. This is a request handler, so it uses
// `awaitForTranslationOrFallbackToOriginal`: it MUST still be awaited (and is, here) for
// rate limiting, but it never rejects — a failed POST falls back to the French source
// instead of failing the whole page. Use `awaitForTranslationOrThrow` instead in a script
// or a build step, where an ignored rejection crashing the process is the point.
export async function renderPage(lang: Lang): Promise<string> {
  await initI18n();

  // Both strings are written in French (the primary language); the SDK returns the
  // `lang` translation (or the French source for `fr`).
  const intro = await awaitForTranslationOrFallbackToOriginal(
    "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.",
    lang
  );
  // `context` disambiguates "8 heures" → "8 AM" (a time) vs "8 hours" (a duration).
  const asTime = await awaitForTranslationOrFallbackToOriginal("8 heures", lang, { context: "heure" });
  const asDuration = await awaitForTranslationOrFallbackToOriginal("8 heures", lang, { context: "durée" });

  return `<!doctype html>
<html lang="${lang}">
  <head><meta charset="utf-8" /><title>i18n-keyless · Node</title></head>
  <body>
    <h1>${intro}</h1>
    <p>8 heures → ${asTime} (heure) · ${asDuration} (durée)</p>
    <nav>${SUPPORTED_LANGUAGES.map((l) => `<a href="/?lang=${l}">${l}</a>`).join(" · ")}</nav>
  </body>
</html>`;
}

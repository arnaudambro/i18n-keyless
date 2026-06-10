import { createFileRoute } from "@tanstack/react-router";
import { getTranslation } from "i18n-keyless-react";
import { AboutContent } from "../components/AboutContent";

export const Route = createFileRoute("/about")({
  // FUNCTION PATH. `getTranslation()` runs in the route loader, which executes INSIDE the
  // per-request ALS scope (server.ts wraps the whole handler) → it resolves in the request's
  // `lang` via the scope. TanStack serializes the returned strings into the HTML and replays
  // them on the client, so there's no hydration mismatch.
  //
  // IMPORTANT: call the imperative `getTranslation()` in a loader/head() — NEVER in a
  // component render body. In TanStack Start the React tree renders OUTSIDE the ALS, so a
  // `getTranslation()` call during render would miss the scope and fall back to the primary
  // language. Body strings should use `<I18nKeylessText>` (the component path) instead.
  loader: () => ({
    intro: getTranslation(
      "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>."
    ),
    note: getTranslation(
      "Cette page utilise des chaînes différentes de la page d'accueil — en SSR, chaque page ne sérialise que ses propres clés."
    ),
    // `context` disambiguates "8 heures" → "8 AM" (a time) vs "8 hours" (a duration).
    asTime: getTranslation("8 heures", { context: "heure" }),
    asDuration: getTranslation("8 heures", { context: "durée" }),
  }),
  component: AboutRoute,
});

function AboutRoute() {
  const data = Route.useLoaderData();
  return <AboutContent {...data} />;
}

import { useNavigate } from "@tanstack/react-router";
import { I18nKeylessText, setCurrentLanguage, useCurrentLanguage, type Lang } from "i18n-keyless-react";
import { SUPPORTED_LANGUAGES } from "../i18n";

// The active language is driven by the URL `?lang=` — the single source of truth: a reload,
// a shared link and a crawler all get that language server-rendered. A click needs TWO
// calls, and both are needed:
//
// - `setCurrentLanguage(next)` fetches the language the browser has not seen yet and fills
//   the store. Without it, a click navigates to ?lang=en and the page KEEPS the previous
//   language: a client-side navigation never reaches the server, and the root loader is a
//   pure read of the store on the client (deliberately — see __root.tsx), so nothing else
//   translates the transition.
// - `navigate(...)` writes the URL, which is what every other entry point reads.
//
// What there must NOT be is an effect syncing the store back into the URL: the loader and
// the provider already seed the store from the URL, so a reverse sync is an infinite
// ?lang=en ↔ ?lang=fr navigation loop.
export function LanguageSwitcher() {
  const navigate = useNavigate();
  // The provider's language on the server and on the first client render; the store's in a
  // tree rendered without a provider. The SDK hook reads both.
  const current = useCurrentLanguage() ?? "fr";
  const list = SUPPORTED_LANGUAGES as readonly Lang[];
  const next = list[(list.indexOf(current as Lang) + 1) % list.length];
  const switchTo = (lang: Lang) => {
    setCurrentLanguage(lang);
    navigate({ to: ".", search: (prev) => ({ ...prev, lang }) });
  };
  return (
    <button className="switch" onClick={() => switchTo(next)}>
      <I18nKeylessText>Changer de langue</I18nKeylessText> ({current})
    </button>
  );
}

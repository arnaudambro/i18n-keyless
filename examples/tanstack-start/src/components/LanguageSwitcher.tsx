import { useNavigate } from "@tanstack/react-router";
import {
  I18nKeylessText,
  useI18nKeylessContext,
  useCurrentLanguage,
  type Lang,
} from "i18n-keyless-react";
import { SUPPORTED_LANGUAGES } from "../i18n";

// The active language is driven by the URL `?lang=` — the single source of truth. This
// button only NAVIGATES; it deliberately does NOT call setCurrentLanguage, and there is no
// effect syncing the store back into the URL. (A reverse sync would create an infinite
// ?lang=en ↔ ?lang=fr navigation loop, since the loader/provider already seed the store
// from the URL.) The server render picks the initial language from the same `?lang=`.
export function LanguageSwitcher() {
  const navigate = useNavigate();
  // Prefer the provider's language (correct on server + client); fall back to the store.
  const current = useI18nKeylessContext()?.lang ?? useCurrentLanguage() ?? "fr";
  const list = SUPPORTED_LANGUAGES as readonly Lang[];
  const next = list[(list.indexOf(current as Lang) + 1) % list.length];
  return (
    <button
      className="switch"
      onClick={() => navigate({ to: ".", search: (prev) => ({ ...prev, lang: next }) })}
    >
      <I18nKeylessText>Changer de langue</I18nKeylessText> ({current})
    </button>
  );
}

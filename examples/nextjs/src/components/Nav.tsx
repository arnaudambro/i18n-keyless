"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { I18nKeylessText, useCurrentLanguage, type Lang } from "i18n-keyless-react";
import { SUPPORTED_LANGUAGES } from "../i18n";

export function Nav() {
  const lang = (useCurrentLanguage() ?? "fr") as Lang;
  const router = useRouter();
  const pathname = usePathname();
  const rest = pathname.replace(/^\/[^/]+/, ""); // path without the /:lang prefix

  return (
    <header>
      <h1>i18n-keyless · Next.js</h1>
      <nav>
        <Link href={`/${lang}`}>
          <I18nKeylessText>Accueil</I18nKeylessText>
        </Link>
        <Link href={`/${lang}/about`}>
          <I18nKeylessText>À propos</I18nKeylessText>
        </Link>
        <button
          className="switch"
          onClick={() => {
            const list = SUPPORTED_LANGUAGES as readonly Lang[];
            const next = list[(list.indexOf(lang) + 1) % list.length];
            // Navigate to /:lang — Next server-renders the page in the new language.
            router.push(`/${next}${rest}`);
          }}
        >
          <I18nKeylessText>Changer de langue</I18nKeylessText> ({lang})
        </button>
      </nav>
    </header>
  );
}

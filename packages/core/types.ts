import type React from "react";

/**
 * Every language i18n-keyless can translate into: the 50 App Store localizations
 * (https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations/)
 * collapsed onto bare language codes, plus the handful of variants that are genuinely a
 * different translation.
 *
 * Why bare `fr` and not Apple's `fr-FR`: a bare language designator matches *every* region
 * of that language, so `fr` covers fr-FR, fr-CA, fr-BE and fr-CH at once. Adding a region
 * narrows it. The rule — Apple's own, for bundle localizations — is to add a region only
 * when you actually ship different content for it. So we regionalize exactly where the
 * output really differs:
 *
 * - `zh-Hans` / `zh-Hant` — a script, not a region. There is no bare `zh`: Simplified and
 *   Traditional are not mutually readable, and "Chinese" alone is ambiguous.
 * - `pt-BR` — Brazilian vocabulary diverges from European Portuguese in ordinary UI words
 *   (usuário/utilizador, arquivo/ficheiro, tela/ecrã).
 * - `es-MX` — Latin American Spanish (computadora/ordenador, celular/móvil).
 * - `fr-CA` — Québec French.
 * - `en-GB` — British spelling.
 *
 * Everything else stays bare. `supported: ["fr", "en", "es"]` is the common case and reads
 * like it. Reach for a variant only when you want that second, distinct translation — you
 * are billed per language you opt into, so `["pt", "pt-BR"]` is two translations, `["pt"]`
 * is one.
 *
 * To push metadata to App Store Connect, map a `Lang` onto its listing slot with
 * `toAppStoreLocale` (`"fr"` → `"fr-FR"`).
 */
export const AVAILABLE_LANGS = [
  "ar", // Arabic
  "bn", // Bangla
  "ca", // Catalan
  "zh-Hans", // Chinese (Simplified)
  "zh-Hant", // Chinese (Traditional)
  "hr", // Croatian
  "cs", // Czech
  "da", // Danish
  "nl", // Dutch
  "en", // English
  "en-GB", // English (U.K.)
  "fi", // Finnish
  "fr", // French
  "fr-CA", // French (Canada)
  "de", // German
  "el", // Greek
  "gu", // Gujarati
  "he", // Hebrew
  "hi", // Hindi
  "hu", // Hungarian
  "id", // Indonesian
  "it", // Italian
  "ja", // Japanese
  "kn", // Kannada
  "ko", // Korean
  "ms", // Malay
  "ml", // Malayalam
  "mr", // Marathi
  "no", // Norwegian
  "or", // Odia
  "pl", // Polish
  "pt", // Portuguese
  "pt-BR", // Portuguese (Brazil)
  "pa", // Punjabi
  "ro", // Romanian
  "ru", // Russian
  "sk", // Slovak
  "sl", // Slovenian
  "es", // Spanish
  "es-MX", // Spanish (Latin America)
  "sv", // Swedish
  "ta", // Tamil
  "te", // Telugu
  "th", // Thai
  "tr", // Turkish
  "uk", // Ukrainian
  "ur", // Urdu
  "vi" // Vietnamese
] as const;

export type Lang = (typeof AVAILABLE_LANGS)[number];

/**
 * Any supported language can be the one you write your app in.
 * (Until v3 this was restricted to `"fr" | "en"`.)
 */
export type PrimaryLang = Lang;

/**
 * The App Store Connect listing slot for each `Lang`. Apple qualifies some languages with a
 * region even when there is a single variant (`de-DE`, `nl-NL`, `ar-SA`, `fr-FR`) and leaves
 * others bare (`it`, `ja`, `pl`); that asymmetry is Apple's, and this map absorbs it.
 *
 * Apple's `en-AU`, `en-CA` and `pt-PT` slots have no dedicated `Lang`: fill them from `en`
 * and `pt` respectively, or opt into `en-GB` / `pt-BR` for a distinct translation.
 */
export const APP_STORE_LOCALES: Record<Lang, string> = {
  ar: "ar-SA",
  bn: "bn",
  ca: "ca",
  "zh-Hans": "zh-Hans",
  "zh-Hant": "zh-Hant",
  hr: "hr",
  cs: "cs",
  da: "da",
  nl: "nl-NL",
  en: "en-US",
  "en-GB": "en-GB",
  fi: "fi",
  fr: "fr-FR",
  "fr-CA": "fr-CA",
  de: "de-DE",
  el: "el",
  gu: "gu",
  he: "he",
  hi: "hi",
  hu: "hu",
  id: "id",
  it: "it",
  ja: "ja",
  kn: "kn",
  ko: "ko",
  ms: "ms",
  ml: "ml",
  mr: "mr",
  no: "no",
  or: "or",
  pl: "pl",
  pt: "pt-PT",
  "pt-BR": "pt-BR",
  pa: "pa",
  ro: "ro",
  ru: "ru",
  sk: "sk",
  sl: "sl",
  es: "es-ES",
  "es-MX": "es-MX",
  sv: "sv",
  ta: "ta",
  te: "te",
  th: "th",
  tr: "tr",
  uk: "uk",
  ur: "ur",
  vi: "vi"
};

/**
 * The App Store Connect locale shortcode for a `Lang`, to push localized metadata,
 * screenshots or release notes to the right listing slot.
 *
 * `toAppStoreLocale("fr")` → `"fr-FR"`, `toAppStoreLocale("pt")` → `"pt-PT"`.
 */
export function toAppStoreLocale(lang: Lang): string {
  return APP_STORE_LOCALES[lang];
}

/**
 * v2 language codes that changed in v3, mapped onto their v3 equivalent.
 *
 * Only these two moved: every other v2 code (`fr`, `en`, `es`, `de`, `nl`, `pt`, `ar`, `it`,
 * `pl`, `ro`, `hu`, `sv`, `tr`, `ja`, `ru`, `ko`, `el`) is unchanged in v3 and travels
 * identically on the wire — so a v2 client and a v3 client can talk to the same backend.
 *
 * Exported so a backend can alias the two legacy codes from the same source of truth as the
 * clients, rather than hardcoding the pair.
 */
export const LEGACY_LANG_MAP: Record<string, Lang> = {
  cn: "zh-Hans", // v2 used the country code for Simplified Chinese
  cz: "cs" // v2 used the country code for Czech
};

/**
 * Resolves a language code to a supported `Lang`:
 * - a v3 code is returned as-is
 * - a v2 code is upgraded through `LEGACY_LANG_MAP` (`"cn"` → `"zh-Hans"`)
 * - anything else returns `undefined`, so the caller can apply its own fallback
 *
 * This is the exact-code path. To resolve a full locale tag from a device or a browser
 * (`"fr-CH"`, `"zh-TW"`, `"pt_BR"`), use `resolveLang`.
 */
export function normalizeLang(lang: string | null | undefined): Lang | undefined {
  if (!lang) {
    return undefined;
  }
  if ((AVAILABLE_LANGS as readonly string[]).includes(lang)) {
    return lang as Lang;
  }
  return LEGACY_LANG_MAP[lang];
}

/** Lowercased `Lang` → canonical `Lang`, so lookups can be case-insensitive. */
const LANGS_BY_LOWERCASE = new Map<string, Lang>(AVAILABLE_LANGS.map((lang) => [lang.toLowerCase(), lang]));

/**
 * Chinese is selected by script, not by region, and the regions don't map to a script by
 * name — so the common region tags are spelled out.
 */
const CHINESE_REGION_SCRIPTS: Record<string, Lang> = {
  cn: "zh-Hans",
  sg: "zh-Hans",
  hans: "zh-Hans",
  tw: "zh-Hant",
  hk: "zh-Hant",
  mo: "zh-Hant",
  hant: "zh-Hant"
};

/**
 * Resolves any BCP-47 locale tag — `navigator.language`, `Localization.getLocales()[0]
 * .languageTag`, an `Accept-Language` entry, an App Store shortcode — onto a supported
 * `Lang`, most specific match first:
 *
 * ```ts
 * resolveLang("pt-BR")   // "pt-BR"  — exact variant
 * resolveLang("pt-AO")   // "pt"     — no Angolan variant, fall back to the bare language
 * resolveLang("fr-CH")   // "fr"
 * resolveLang("zh-TW")   // "zh-Hant"
 * resolveLang("zh_CN")   // "zh-Hans" — underscores are accepted
 * resolveLang("es-419")  // "es-MX"   — Latin America
 * resolveLang("cn")      // "zh-Hans" — v2 code
 * resolveLang("xx")      // undefined
 * ```
 *
 * Pass `supported` to only ever get a language you actually ship — the walk continues to
 * the next candidate when a more specific one isn't in the list, so a `pt-BR` device on an
 * app that only ships `pt` gets `pt`:
 *
 * ```ts
 * resolveLang("pt-BR", { supported: ["pt", "en"], fallback: "en" })  // "pt"
 * resolveLang("ja",    { supported: ["pt", "en"], fallback: "en" })  // "en"
 * ```
 */
export function resolveLang(
  tag: string | null | undefined,
  options?: { supported?: readonly Lang[]; fallback?: Lang }
): Lang | undefined {
  const supported = options?.supported;
  const isUsable = (lang: Lang) => !supported || supported.includes(lang);

  for (const candidate of langCandidates(tag)) {
    if (isUsable(candidate)) {
      return candidate;
    }
  }
  return options?.fallback;
}

/**
 * The supported `Lang`s a tag could mean, most specific first: the exact code, then the
 * script/region resolution, then the bare language.
 */
function langCandidates(tag: string | null | undefined): Lang[] {
  if (!tag) {
    return [];
  }
  // "pt_BR" and "PT-br" are the same tag as "pt-BR".
  const normalized = tag.replace(/_/g, "-").trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const [language, ...rest] = normalized.split("-");
  const region = rest[rest.length - 1];
  const candidates: Lang[] = [];
  const push = (lang: Lang | undefined) => {
    if (lang && !candidates.includes(lang)) {
      candidates.push(lang);
    }
  };

  // 1. the tag as written ("pt-BR", "zh-Hans"), then the v2 codes ("cn", "cz")
  push(LANGS_BY_LOWERCASE.get(normalized));
  push(LEGACY_LANG_MAP[normalized]);

  // 2. Chinese resolves by script and never falls back to a bare language
  if (language === "zh") {
    push(CHINESE_REGION_SCRIPTS[region] ?? "zh-Hans");
    return candidates;
  }

  // 3. UN M49 code for Latin America, which is what the es-MX slot really covers
  if (normalized === "es-419") {
    push("es-MX");
  }

  // 4. the bare language ("pt-AO" → "pt")
  push(LANGS_BY_LOWERCASE.get(language));
  return candidates;
}

/**
 * The namespace used when none is provided (per call or via `defaultNamespace` in config).
 * The default namespace reuses the legacy storage keys (`i18n-keyless-translations` and
 * `i18n-keyless-last-refresh`) so existing installs keep working without any migration.
 */
export const DEFAULT_NAMESPACE = "default";

/**
 * The translations for a key
 * { "un text": "a text" }
 */
export type Translations = Record<string, string>;
/**
 * The translations usage for a key
 * Useful to clean up the translations database and to avoid paying for translations that are not used anymore
 * Record<string, YYYY-MM-DD>;
 * { "un text": "2025-06-23" }
 */
export type TranslationsUsage = Record<string, string>;

export type HandleTranslateFunction = (
  key: string
) => Promise<{ ok: boolean; message: string; data: { translation: Translations } }>;
export type GetAllTranslationsFunction = () => Promise<I18nKeylessResponse>;
export type GetAllTranslationsForAllLanguagesFunction = () => Promise<I18nKeylessAllTranslationsResponse>;
export type SendTranslationsUsageFunction = (
  translationsUsage: TranslationsUsage
) => Promise<{ ok: boolean; message: string }>;
export type LastRefresh = string | null;
export type UniqueId = string | null;

export type LanguagesConfig = {
  /**
   * the language used by the developer
   */
  primary: PrimaryLang;
  /**
   * the languages supported for the user.
   * We support the 50 App Store localizations — see `AVAILABLE_LANGS`.
   *
   * If you need more, please reach out to @ambroselli_io on X/Twitter or by mail at arnaud.ambroselli.io@gmail.com
   */
  supported: Lang[];
  /**
   * if the user's langauge is not supported, the fallback language will be used
   */
  fallback?: Lang;
  /**
   * the language to use when the app is initialized
   */
  initWithDefault?: Lang;
  /**
   * if true, the current language will not be hydrated from the storage, and the app will use the initWithDefault language
   * this is useful if the language state commes from the url for example,
   * like /{lang}/path/to/something or /path/to/something?lang={lang}
   */
  skipCurrentLanguageHydration?: boolean;
};

export type TranslationOptions = {
  /**
   * The context of the translation.
   * Useful for ambiguous translations, like "8 heures" in French could be "8 AM" or "8 hours".
   * You'll find it useful when it occurs to you, don't worry :)
   */
  context?: string;
  /**
   * The namespace this translation belongs to.
   * Translations are fetched and persisted per namespace, so splitting a large project
   * into several namespaces keeps each storage item small (avoids the localStorage quota
   * error) and lets the app download only the namespaces it actually renders.
   * Defaults to `defaultNamespace` from the config, or "default" if neither is set.
   */
  namespace?: string;
  /**
   * When true, this namespace's translations live in memory only: they are never written
   * to storage, never added to the persisted namespaces index, and never reloaded at boot
   * or refetched on language change from storage. Use it for high-cardinality, transient
   * namespaces (e.g. one namespace per discussion) so they add zero storage weight and zero
   * boot / language-switch cost. Defaults to false (persisted).
   * Only affects the client (i18n-keyless-react); the node lib is in-memory regardless.
   */
  unpersistedNamespace?: boolean;
  /**
   * Could be helpful if something weird happens with this particular key.
   */
  debug?: boolean;
  /**
   * If the proposed translation from AI is not satisfactory,
   * you can use this field to setup your own translation.
   * You can leave it there forever, or remove it once your translation is saved.
   */
  forceTemporary?: Partial<Record<Lang, string>>;
  /**
   * The keys to replace in the text.
   * It's an object where the key is the placeholder and the value is the replacement.
   * Example: { "{{name}}": "John" } will replace all the {{name}} in the text with "John".
   * RegEx is `key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))` so you can use use your own syntax.
   */
  replace?: Record<string, string>;
  /**
   * The language the text is written in when it differs from the primary language —
   * i.e. user generated content (UGC). The backend translates it into the primary language,
   * keeps the raw text for viewers in that language, and AI-translates all the others.
   * When the current language IS the origin language, the text is rendered as-is (no API call).
   * Omitted or equal to the primary language means the regular flow.
   */
  originLanguage?: Lang;
};

export interface I18nKeylessRequestBody {
  key: string;
  context?: string;
  namespace?: string;
  forceTemporary?: TranslationOptions["forceTemporary"];
  languages: LanguagesConfig["supported"];
  primaryLanguage: LanguagesConfig["primary"];
  /**
   * Language the `key` text is written in when it differs from the primary language (UGC flow).
   * The backend translates `key` into the primary language, keys the row by that primary text,
   * stores the raw `key` in the origin-language cell, and AI-translates all other languages.
   * Omitted or equal to `primaryLanguage` means the regular flow.
   */
  originLanguage?: Lang;
}

export interface I18nKeylessTranslationsUsageRequestBody {
  primaryLanguage: LanguagesConfig["primary"];
  /**
   * Usage keyed by namespace: `{ "<namespace>": { "key__context": "YYYY-MM-DD" } }`. The
   * default namespace is included under the key "default". The backend marks `last_used` on
   * the exact `(key, context, namespace)` row.
   *
   * (Clients < 2.4.0 instead send a flat `translationsUsage` with no namespace; the backend
   * treats that as the "default" namespace.) `unpersistedNamespace` namespaces are excluded.
   */
  translationsUsageByNamespace: Record<string, TranslationsUsage>;
}

export interface I18nKeylessResponse {
  ok: boolean;
  data: {
    translations: Translations; // { "un text": "a text" } // already translated
    uniqueId: UniqueId;
    lastRefresh: LastRefresh;
  };
  error: string;
  message: string;
}

export interface I18nKeylessAllTranslationsResponse {
  ok: boolean;
  data: {
    translations: Record<Lang, Translations>; // { "fr": { "un text": "a text" }, "en": { "un text": "a text" }  } // already translated
    uniqueId: UniqueId;
    lastRefresh: LastRefresh;
  };
  error: string;
  message: string;
}

export type FetchTranslationParams = {
  uniqueId: UniqueId;
  lastRefresh: LastRefresh;
  currentLanguage: Lang;
  config: {
    API_KEY: string;
    API_URL?: string;
    languages: LanguagesConfig;
    defaultNamespace?: string;
    addMissingTranslations?: boolean;
    debug?: boolean;
    handleTranslate?: HandleTranslateFunction;
    getAllTranslations?: GetAllTranslationsFunction;
    getAllTranslationsForAllLanguages?: GetAllTranslationsForAllLanguagesFunction;
    sendTranslationsUsage?: SendTranslationsUsageFunction;
  };
  translations: Translations;
};

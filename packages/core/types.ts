import type React from "react";
export type PrimaryLang = "fr" | "en";

export const AVAILABLE_LANGS = [
  "fr",
  "en",
  "nl",
  "it",
  "de",
  "es",
  "pl",
  "pt",
  "ro",
  "hu",
  "sv",
  "tr",
  "ja",
  "cn",
  "cz",
  "ru",
  "ko",
  "ar"
] as const;

export type Lang = (typeof AVAILABLE_LANGS)[number];

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
   * For now we support:
   * fr, nl, it, de, es, pl, pt, ro, hu, sv, tr, ja, cn, cz, ru, ko, ar
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

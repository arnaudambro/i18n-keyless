import type React from "react";
export type PrimaryLang = "fr" | "en";
export type Lang =
  | "fr"
  | "en"
  | "nl"
  | "it"
  | "de"
  | "es"
  | "pl"
  | "pt"
  | "ro"
  | "sv"
  | "tr"
  | "ja"
  | "cn"
  | "ru"
  | "ko"
  | "ar";

export type Translations = Record<string, string>;

export type HandleTranslateFunction = (key: string) => Promise<{ ok: boolean; message: string }>;
export type GetAllTranslationsFunction = () => Promise<I18nKeylessResponse>;
export type GetAllTranslationsForAllLanguagesFunction = () => Promise<I18nKeylessAllTranslationsResponse>;

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
   * fr, nl, it, de, es, pl, pt, ro, sv, tr, ja, cn, ru, ko, ar
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
};

export type TranslationOptions = {
  /**
   * The context of the translation.
   * Useful for ambiguous translations, like "8 heures" in French could be "8 AM" or "8 hours".
   * You'll find it useful when it occurs to you, don't worry :)
   */
  context?: string;
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
};

export interface I18nKeylessRequestBody {
  key: string;
  context?: string;
  forceTemporary?: TranslationOptions["forceTemporary"];
  languages: LanguagesConfig["supported"];
  primaryLanguage: LanguagesConfig["primary"];
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
    addMissingTranslations?: boolean;
    debug?: boolean;
    handleTranslate?: HandleTranslateFunction;
    getAllTranslations?: GetAllTranslationsFunction;
    getAllTranslationsForAllLanguages?: GetAllTranslationsForAllLanguagesFunction;
  };
  translations: Translations;
};

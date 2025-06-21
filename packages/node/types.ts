import {
  HandleTranslateFunction,
  Lang,
  LastUsedTranslations,
  PrimaryLang,
  SendTranslationsUsageFunction,
} from "i18n-keyless-core";

export type Translations = Record<string, string>;

export interface I18nKeylessNodeConfig {
  /**
   * The API key for the i18n-keyless API
   *
   * contact @ambroselli_io on X/Twitter or by mail at arnaud.ambroselli.io@gmail.com for getting one
   */
  API_KEY: string;
  /**
   * Your own API URL for the i18n-keyless API
   *
   * You'll need to implement two routes on your server
   * - GET /translate/:lang
   * - POST /translate -- with a body of { key: string }
   */
  API_URL?: string; // Optional - will default to https://api.i18n-keyless.com
  /**
   * The languages config
   *
   * primary: the language used by the developer
   * supported: the languages supported for the user
   * fallback: if the user's langauge is not supported, the fallback language will be used
   * initWithDefault: the language to use when the app is initialized for the first time
   */
  languages: {
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
  };
  addMissingTranslations?: true;
  /**
   * called right after the store is initialized, maybe to hide screensplash. or init specific default langauge for dayjs, or whatever
   */
  onInit?: (lang: Lang) => void;
  /**
   * if true, all the logs will be displayed in the console
   */
  debug?: boolean;
  /**
   * if this function exists, it will be called instead of the API call
   * if this function doesn't exist, the default behavior is to call the API
   * therefore you would need either to
   * - use this `handleTranslate` function to handle the translation with your own API
   * - not use this `handleTranslate` function, and use the built in API call with API_KEY filled
   * - not use this `handleTranslate` function nor API_KEY key, and provide your own API_URL
   */
  handleTranslate?: HandleTranslateFunction;
  /**
   * if this function exists, it will be called instead of the API call
   * if this function doesn't exist, the default behavior is to call the API, with the API_KEY
   * therefore you need either to
   * - use this `getAllTranslationsForAllLanguages` function to handle the translation with your own API
   * - not use this `getAllTranslationsForAllLanguages` function, and use the built in API call with the API_KEY filled
   * - not use this `getAllTranslationsForAllLanguages` function nor API_KEY key, and provide your own API_URL
   */
  getAllTranslationsForAllLanguages?: () => Promise<I18nKeylessAllTranslationsResponse>;
  /**
   * if this function exists, it will be called instead of the API call
   * if this function doesn't exist, the default behavior is to call the API, with the API_KEY
   * therefore you need either to
   * - use this `sendTranslationsUsage` function to handle the translation with your own API
   * - not use this `sendTranslationsUsage` function, and use the built in API call with the API_KEY filled
   * - not use this `sendTranslationsUsage` function nor API_KEY key, and provide your own API_URL
   */
  sendTranslationsUsage?: SendTranslationsUsageFunction;
}

export interface I18nKeylessNodeStore {
  /**
   * the unique id of the consumer of i18n-keyless API, to help identify the usage API side
   */
  uniqueId: string | null;
  /**
   * the last refresh of the translations, to only fetch the new ones if any
   */
  lastRefresh: string | null;
  /**
   * the translations fetched from i18n-keyless' API
   */
  translations: Record<Lang, Translations>;
  /**
   * the last used translations
   */
  lastUsedTranslations: LastUsedTranslations;
  /**
   * i18n-keyless' config
   */
  config: I18nKeylessNodeConfig;
}

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
  languages: I18nKeylessNodeConfig["languages"]["supported"];
  primaryLanguage: I18nKeylessNodeConfig["languages"]["primary"];
}

export interface I18nKeylessAllTranslationsResponse {
  ok: boolean;
  data: {
    translations: Record<Lang, Translations>; // { "fr": { "un text": "a text" }, "en": { "un text": "a text" }  } // already translated
    uniqueId: string | null;
    lastRefresh: string | null;
  };
  error: string;
  message: string;
}

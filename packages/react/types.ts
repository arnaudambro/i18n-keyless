import type {
  I18nKeylessResponse,
  Lang,
  Translations,
  LastUsedTranslation,
  HandleTranslateFunction,
  GetAllTranslationsFunction,
  SendTranslationsUsageFunction,
  UniqueId,
  LastRefresh,
  LanguagesConfig,
} from "i18n-keyless-core";

type GetStorageFunction = (key: string) => string | null | undefined | Promise<string | null | undefined>;
type SetStorageFunction = (key: string, value: string) => void | Promise<void>;
type RemoveStorageFunction = (key: string) => void | Promise<void>;
type ClearStorageFunction = () => void | Promise<void>;

export interface I18nConfig {
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
  languages: LanguagesConfig;
  /**
   * if true, everytime a primary key is not found
   * there will be a call to POST /translate -- with a body of { key: string }
   * which should handle adding the key to the translations and, if needed,
   * translate the key to all the languages supported by the user
   *
   * Two scenarios
   * 1. Enable it in dev mode only: you'll may add some useless key, but you are 100% sure all the translations are up to date
   * 2. Enable it in prod mode only: you take a risk taht the translations is not available when required for the first user demanding
   * Best take: enable it all the time
   */
  addMissingTranslations?: boolean;
  /**
   * called right after the store is initialized, maybe to hide screensplash. or init specific default langauge for dayjs, or whatever
   */
  onInit?: (lang: Lang) => void;
  /**
   * if true, all the logs will be displayed in the console
   */
  debug?: boolean;
  /**
   * called everytime the language is set, maybe to set also the locale to dayjs or whatever
   */
  onSetLanguage?: (lang: Lang) => void;
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
   * - use this `getAllTranslations` function to handle the translation with your own API
   * - not use this `getAllTranslations` function, and use the built in API call with the API_KEY filled
   * - not use this `getAllTranslations` function nor API_KEY key, and provide your own API_URL
   */
  getAllTranslations?: GetAllTranslationsFunction;
  /**
   * if this function exists, it will be called instead of the API call
   * if this function doesn't exist, the default behavior is to call the API
   * therefore you need either to
   * - use this `sendTranslationsUsage` function to handle the translation with your own API
   * - not use this `sendTranslationsUsage` function, and use the built in API call with the API_KEY filled
   * - not use this `sendTranslationsUsage` function nor API_KEY key, and provide your own API_URL
   */
  sendTranslationsUsage?: SendTranslationsUsageFunction;
  /**
   * the storage to use for the translations
   *
   * you can use react-native-mmkv, @react-native-async-storage/async-storage, or window.localStorage, or idb-keyval for IndexedDB, or any storage that has a getItem, setItem, removeItem, or get, set, and remove method
   */
  storage?: {
    getItem?: GetStorageFunction;
    get?: GetStorageFunction;
    getString?: GetStorageFunction;
    setItem?: SetStorageFunction;
    set?: SetStorageFunction;
    removeItem?: RemoveStorageFunction;
    remove?: RemoveStorageFunction;
    delete?: RemoveStorageFunction;
    del?: RemoveStorageFunction;
    clear?: ClearStorageFunction;
    clearAll?: ClearStorageFunction;
  } & { getString?: GetStorageFunction; get?: GetStorageFunction; getItem?: GetStorageFunction } & {
    setItem?: SetStorageFunction;
    set?: SetStorageFunction;
  } & {
    removeItem?: RemoveStorageFunction;
    remove?: RemoveStorageFunction;
    delete?: RemoveStorageFunction;
    del?: RemoveStorageFunction;
  } & ({ clear: ClearStorageFunction; clearAll?: never } | { clearAll: ClearStorageFunction; clear?: never });
}

export interface TranslationStoreState {
  /**
   * the unique id of the consumer of i18n-keyless API, to help identify the usage API side
   */
  uniqueId: UniqueId;
  /**
   * the last refresh of the translations, to only fetch the new ones if any
   */
  lastRefresh: LastRefresh;
  /**
   * the translations fetched from i18n-keyless' API
   */
  translations: Translations;
  /**
   * save the date in format YYYY-MM-DD when a key is used
   * this information is sent to i18n-keyless' API on lib initialization
   * it's used to clean up the translations database
   * and to avoid paying for translations that are not used anymore
   */
  lastUsedTranslation: LastUsedTranslation;
  /**
   * the current language of the user
   */
  currentLanguage: Lang;
  /**
   * i18n-keyless' config
   */
  config: I18nConfig;
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

interface TranslationStoreActions {
  setTranslations: (translations: I18nKeylessResponse | void) => void;
  setLanguage: (lang: Lang) => void;
  sendTranslationsUsage: () => Promise<void>;
}

export type TranslationStore = TranslationStoreState & TranslationStoreActions;

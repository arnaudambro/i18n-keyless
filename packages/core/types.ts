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
// import { StateStorage } from "zustand/middleware";

export type Translations = Record<string, string>;

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
   * the component should be a React component, such as
   *
   * ```ts
   * export default function MyComponent({ style, className, whatever, children}) {
   *  return <Text style={style} className={className} whatever={whatever}>{children}</Text>;
   * }
   * ```
   *
   * Then you can pass MyComponent's props to i18n-keyless' MyI18nText
   *
   * ```ts
   * <MyI18nText style={style} className={className} whatever={whatever}>My text to translate</MyI18nText>
   * ```
   */
  component: React.ComponentType<{ children: string } & Record<string, unknown>>;
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
    /**
     * if the user's langauge is not supported, the fallback language will be used
     */
    fallback?: Lang;
    /**
     * the language to use when the app is initialized
     */
    initWithDefault?: Lang;
  };
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
  addMissingTranslations: boolean;
  /**
   * called right after the store is initialized, maybe to hide screensplash. or init specific default langauge for dayjs, or whatever
   */
  onInit?: (lang: Lang) => void;
  /**
   * called everytime the language is set, maybe to set also the locale to dayjs or whatever
   */
  onSetLanguage?: (lang: Lang) => void;
  // zustandStorage?: StateStorage;
  // onTranslate?: (key: string, lang: Lang, translation: string) => void;
  /**
   * if this function exists, it will be called instead of the API call
   * if this function doesn't exist, the default behavior is to call the API
   * therefore you would need either to
   * - use this `handleTranslate` function to handle the translation with your own API
   * - not use this `handleTranslate` function, and use the built in API call with API_KEY filled
   * - not use this `handleTranslate` function nor API_KEY key, and provide your own API_URL
   */
  handleTranslate?: (key: string) => Promise<{ ok: boolean; message: string }>;
  /**
   * if this function exists, it will be called instead of the API call
   * if this function doesn't exist, the default behavior is to call the API, with the API_KEY
   * therefore you need either to
   * - use this `getAllTranslations` function to handle the translation with your own API
   * - not use this `getAllTranslations` function, and use the built in API call with the API_KEY filled
   * - not use this `getAllTranslations` function nor API_KEY key, and provide your own API_URL
   */
  getAllTranslations?: () => Promise<I18nKeylessResponse>;
  /**
   * the storage to use for the translations
   *
   * you can use react-native-mmkv, @react-native-async-storage/async-storage, or window.localStorage, or idb-keyval for IndexedDB, or any storage that has a getItem, setItem, removeItem, or get, set, and remove method
   */
  storage: {
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

interface TranslationStoreState {
  uniqueId: string | null;
  lastRefresh: string | null;
  translations: Translations;
  currentLanguage: Lang;
  config: I18nConfig | null;
  translating: Record<string, boolean>;
  _hasHydrated: boolean;
  // it's a function that could be window.localstorage or mmkv or asyncstorage
  // i want to type that there should be
  storage: I18nConfig["storage"] | null;
}

interface TranslationStoreActions {
  _hydrate: () => Promise<void>;
  getTranslation: (text: string) => string | undefined;
  setTranslations: (translations: Translations) => void;
  translateKey: (key: string) => void;
  setLanguage: (lang: Lang) => void;
}

export type TranslationStore = TranslationStoreState & TranslationStoreActions;

export interface I18nKeylessRequestBody {
  key: string;
  languages: I18nConfig["languages"]["supported"];
  primaryLanguage: I18nConfig["languages"]["primary"];
}

export interface I18nKeylessResponse {
  ok: boolean;
  data: {
    translations: Translations; // { "un text": "a text" } // already translated
    uniqueId: string | null;
    lastRefresh: string | null;
  };
  error: string;
  message: string;
}

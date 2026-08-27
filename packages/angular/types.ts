import type {
  I18nKeylessResponse,
  Lang,
  Translations,
  TranslationsUsage,
  HandleTranslateFunction,
  GetAllTranslationsFunction,
  SendTranslationsUsageFunction,
  UniqueId,
  LastRefresh,
  LanguagesConfig,
  TranslationOptions,
} from "i18n-keyless-core";

export type { TranslationOptions };

type GetStorageFunction = (key: string) => string | null | undefined | Promise<string | null | undefined>;
type SetStorageFunction = (key: string, value: string) => void | Promise<void>;
type RemoveStorageFunction = (key: string) => void | Promise<void>;
type ClearStorageFunction = () => void | Promise<void>;

/**
 * Any storage that has a `getItem` / `setItem` / `removeItem` triplet (sync or async):
 * `window.localStorage`, `sessionStorage`, an `idb-keyval` wrapper, Capacitor
 * Preferences, an Ionic Storage instance... The `get` / `set` / `remove` and MMKV
 * `getString` / `set` / `delete` spellings are accepted too.
 */
export type I18nStorage = {
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
};

/**
 * The `provideI18nKeyless(config)` options. Identical to the `init` options of
 * `i18n-keyless-react`, with one Angular difference: `storage` is optional in the browser
 * and defaults to `window.localStorage` (the server defaults to an in-memory adapter).
 */
export interface I18nConfig {
  /**
   * The API key for the i18n-keyless API: https://i18n-keyless.com/#get-api-key
   */
  API_KEY: string;
  /**
   * Your own API URL for the i18n-keyless API (self-hosted backend).
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
   * fallback: if the user's language is not supported, the fallback language will be used
   * initWithDefault: the language to use when the app is initialized for the first time
   * skipCurrentLanguageHydration: if true, the current language will not be hydrated from the storage, and the app will use the initWithDefault language
   */
  languages: LanguagesConfig;
  /**
   * The default namespace applied to every translation that doesn't pass its own
   * `namespace` (per call, or via the `<i18n-t namespace>` input / the pipe options).
   *
   * Translations are fetched and persisted per namespace, so splitting a large project
   * into namespaces keeps each storage item small (avoids the localStorage quota error)
   * and only downloads the namespaces actually rendered. Defaults to "default".
   */
  defaultNamespace?: string;
  /**
   * if true, every time a primary key is not found
   * there will be a call to POST /translate -- with a body of { key: string }
   * which should handle adding the key to the translations and, if needed,
   * translate the key to all the languages supported by the user
   */
  addMissingTranslations?: boolean;
  /**
   * called right after the store is hydrated, maybe to hide a splash screen, or to set the
   * locale of a date library
   */
  onInit?: (lang: Lang) => void;
  /**
   * if true, all the logs will be displayed in the console
   */
  debug?: boolean;
  /**
   * Read-only mode for server-side rendering.
   *
   * When the lib runs on a server (no `window`) it is automatically treated as
   * read-only: usage analytics are not sent and not recorded (a server render can be
   * triggered by a crawler, which would pollute the prune signal, and serverless
   * per-request inits would POST on every request). Set `ssr: true` to force this
   * read-only behavior explicitly even in an environment where `window` exists.
   *
   * This does NOT affect translate-on-miss: missing keys are still requested.
   */
  ssr?: boolean;
  /**
   * called every time the language is set, maybe to also set the locale of a date library
   */
  onSetLanguage?: (lang: Lang) => void;
  /**
   * if this function exists, it will be called instead of the API call to POST /translate
   */
  handleTranslate?: HandleTranslateFunction;
  /**
   * if this function exists, it will be called instead of the API call to GET /translate/:lang
   */
  getAllTranslations?: GetAllTranslationsFunction;
  /**
   * if this function exists, it will be called instead of the API call to
   * POST /translate/last-used-translations
   */
  sendTranslationsUsage?: SendTranslationsUsageFunction;
  /**
   * the storage to use for the translations.
   *
   * Browser default: `window.localStorage`. Server default: an in-memory adapter.
   * Any object with `getItem` / `setItem` / `removeItem` (sync or async) works.
   */
  storage?: I18nStorage;
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
   * the translations fetched from i18n-keyless' API.
   * This is the flat, merged-across-namespaces map used for all lookups.
   */
  translations: Translations;
  /**
   * the translations split by namespace. Source of truth for persistence: each namespace
   * is saved under its own storage key so no single item grows past the storage quota.
   */
  translationsByNamespace: Record<string, Translations>;
  /**
   * the namespaces we know about (mirrors the persisted namespaces index)
   */
  namespaces: string[];
  /**
   * the subset of `namespaces` flagged `unpersistedNamespace`: memory only
   */
  unpersistedNamespaces: string[];
  /**
   * the last-refresh (delta) cursor per namespace
   */
  lastRefreshByNamespace: Record<string, LastRefresh>;
  /**
   * usage keyed by namespace: `{ "<namespace>": { "key__context": "YYYY-MM-DD" } }`
   */
  translationsUsageByNamespace: Record<string, TranslationsUsage>;
  /**
   * namespaces that ever looked up an origin-language (UGC) key
   */
  originNamespaces: string[];
  /**
   * the current language of the user
   */
  currentLanguage: Lang;
  /**
   * i18n-keyless' config
   */
  config: I18nConfig;
  /**
   * true once `init` has finished reading the storage (device id, cached translations,
   * current language). Before that, the store renders the primary language.
   */
  hydrated: boolean;
}

export type SetTranslationsFn = (response: I18nKeylessResponse | void, namespace: string, unpersisted?: boolean) => void;

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
   * skipCurrentLanguageHydration: if true, the current language will not be hydrated from the storage, and the app will use the initWithDefault language
   */
  languages: LanguagesConfig;
  /**
   * The default namespace applied to every translation that doesn't pass its own
   * `namespace` (per call or via the `<I18nKeylessText namespace>` prop).
   *
   * Translations are fetched and persisted per namespace, so splitting a large project
   * into namespaces keeps each storage item small (avoids the localStorage quota error)
   * and only downloads the namespaces actually rendered. Defaults to "default", which
   * reuses the legacy `i18n-keyless-translations` storage key (no migration needed).
   */
  defaultNamespace?: string;
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
   * Read-only mode for server-side rendering.
   *
   * When the lib runs on a server (no `window`) it is automatically treated as
   * read-only: usage analytics are not sent and not recorded (a server render can be
   * triggered by a crawler, which would pollute the prune signal, and serverless
   * per-request inits would POST on every request). Set `ssr: true` to force this
   * read-only behavior explicitly even in an environment where `window` exists.
   *
   * This does NOT affect translate-on-miss — missing keys are still requested. See docs/SSR.md.
   */
  ssr?: boolean;
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
   * the translations fetched from i18n-keyless' API.
   * This is the flat, merged-across-namespaces map used for all lookups (a given source
   * text translates the same regardless of namespace).
   */
  translations: Translations;
  /**
   * the translations split by namespace. Source of truth for persistence: each namespace
   * is saved under its own storage key so no single item grows past the storage quota.
   */
  translationsByNamespace: Record<string, Translations>;
  /**
   * the namespaces we know about (mirrors the persisted namespaces index), so hydrate()
   * knows which per-namespace storage keys to load.
   */
  namespaces: string[];
  /**
   * the subset of `namespaces` flagged `unpersistedNamespace`: kept in memory only, never
   * written to storage, never in the persisted index, never reloaded at boot.
   */
  unpersistedNamespaces: string[];
  /**
   * the last-refresh (delta) cursor per namespace, so each namespace only fetches what
   * changed since its own last fetch.
   */
  lastRefreshByNamespace: Record<string, LastRefresh>;
  /**
   * save the date in format YYYY-MM-DD when a key is used
   * this information is sent to i18n-keyless' API on lib initialization
   * it's used to clean up the translations database
   * and to avoid paying for translations that are not used anymore
   */
  /**
   * usage keyed by namespace: `{ "<namespace>": { "key__context": "YYYY-MM-DD" } }`, default
   * under "default". Sent so the backend can mark `last_used` on the exact per-namespace row.
   * `unpersistedNamespace` namespaces are excluded.
   */
  translationsUsageByNamespace: Record<string, TranslationsUsage>;
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
   * The namespace this translation belongs to. Translations are fetched and persisted per
   * namespace. Defaults to `defaultNamespace` from the config, or "default".
   */
  namespace?: string;
  /**
   * When true, this namespace's translations live in memory only: never written to storage,
   * never added to the persisted namespaces index, never reloaded at boot or refetched on
   * language change from storage. Use it for high-cardinality, transient namespaces (e.g.
   * one namespace per discussion). Defaults to false (persisted).
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
};

interface TranslationStoreActions {
  setTranslations: (response: I18nKeylessResponse | void, namespace: string, unpersisted?: boolean) => void;
  setLanguage: (lang: Lang) => void;
  sendTranslationsUsage: () => Promise<void>;
  setTranslationUsage: (
    key: string,
    context?: string,
    namespace?: string,
    unpersistedNamespace?: boolean
  ) => Promise<void>;
}

export type TranslationStore = TranslationStoreState & TranslationStoreActions;

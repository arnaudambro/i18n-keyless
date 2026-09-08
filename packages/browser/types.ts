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
  BundleConfig,
} from "i18n-keyless-core";

type GetStorageFunction = (key: string) => string | null | undefined | Promise<string | null | undefined>;
type SetStorageFunction = (key: string, value: string) => void | Promise<void>;
type RemoveStorageFunction = (key: string) => void | Promise<void>;
type ClearStorageFunction = () => void | Promise<void>;

/**
 * Any key/value storage: `window.localStorage`, `sessionStorage`, an `idb-keyval` wrapper,
 * or anything exposing `getItem` / `setItem` / `removeItem` (or `get` / `set` / `remove`,
 * sync or async). Same adapter contract as `i18n-keyless-react`.
 */
export type StorageAdapter = {
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

export interface I18nConfig {
  /**
   * The API key for the i18n-keyless API: https://i18n-keyless.com/#get-api-key
   */
  API_KEY: string;
  /**
   * Your own API URL for the i18n-keyless API (self-hosted backend).
   * Defaults to https://api.i18n-keyless.com
   */
  API_URL?: string;
  /**
   * primary: the language the source strings are written in
   * supported: the languages the user can switch to
   * fallback: used when the requested language is not supported
   * initWithDefault: the language to use on the first visit
   * skipCurrentLanguageHydration: ignore the language persisted in storage (the URL decides)
   */
  languages: LanguagesConfig;
  /**
   * The namespace applied to every translation that does not pass its own `namespace`.
   * Translations are fetched and persisted per namespace. Defaults to "default".
   */
  defaultNamespace?: string;
  /**
   * When a key is missing, POST it to `/translate` so the service translates it.
   * Defaults to true.
   */
  addMissingTranslations?: boolean;
  /**
   * Called once the store is hydrated, with the language it booted in.
   */
  onInit?: (lang: Lang) => void;
  /**
   * Log every step to the console.
   */
  debug?: boolean;
  /**
   * The precompiled bundle: dictionaries exported at build time and shipped with the app
   * (`manifest.json` plus one `<namespace>/<lang>.json` per dictionary, from the MCP
   * `export_bundle` tool or `GET /translate/bundle`). A namespace the manifest covers in the
   * current language is seeded from the bundle instead of fetched, at boot and on a language
   * switch, with the bundle's cursor — so the API is only called for a missing key (and the
   * delta that follows it). Storage still wins when it is newer for the same language.
   *
   * `load` is called per (namespace, language) and may return the module of a dynamic
   * `import()`, so a bundler ships only the language actually rendered:
   * `load: (ns, lang) => import(\`./i18n-keyless/${ns}/${lang}.json\`)`.
   */
  bundle?: BundleConfig;
  /**
   * Called every time the language is set.
   */
  onSetLanguage?: (lang: Lang) => void;
  /**
   * Custom handler used instead of `POST /translate`.
   */
  handleTranslate?: HandleTranslateFunction;
  /**
   * Custom handler used instead of `GET /translate/:lang`.
   */
  getAllTranslations?: GetAllTranslationsFunction;
  /**
   * Custom handler used instead of `POST /translate/last-used-translations`.
   */
  sendTranslationsUsage?: SendTranslationsUsageFunction;
  /**
   * Where translations, the current language and the device id are persisted.
   * Defaults to `window.localStorage`; falls back to an in-memory map when it is not
   * accessible (private mode with storage disabled, no `window`).
   */
  storage?: StorageAdapter;
}

export interface TranslationStoreState {
  /** the device id sent to the API, so a device counts as one user */
  uniqueId: UniqueId;
  /** the last refresh of the translations, to only fetch what changed */
  lastRefresh: LastRefresh;
  /** flat map merged across namespaces, used for every lookup */
  translations: Translations;
  /** per-namespace slices, source of truth for persistence */
  translationsByNamespace: Record<string, Translations>;
  /** the namespaces we know about (mirrors the persisted index) */
  namespaces: string[];
  /** the subset of `namespaces` kept in memory only */
  unpersistedNamespaces: string[];
  /** the delta cursor per namespace */
  lastRefreshByNamespace: Record<string, LastRefresh>;
  /** usage keyed by namespace: `{ "<namespace>": { "key__context": "YYYY-MM-DD" } }` */
  translationsUsageByNamespace: Record<string, TranslationsUsage>;
  /** namespaces that hold origin-language (UGC) keys */
  originNamespaces: string[];
  /** the current language of the user */
  currentLanguage: Lang;
  /** the config given to `init` */
  config: I18nConfig;
}

export type { TranslationOptions, Lang, Translations, I18nKeylessResponse };

/** A store listener: receives the new state and the previous one. */
export type Listener = (state: TranslationStoreState, previous: TranslationStoreState) => void;

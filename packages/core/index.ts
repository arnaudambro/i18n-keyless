export { AVAILABLE_LANGS, DEFAULT_NAMESPACE, APP_STORE_LOCALES, resolveLang, toAppStoreLocale } from "./types.ts";
export type {
  Lang,
  PrimaryLang,
  Translations,
  TranslationsUsage,
  HandleTranslateFunction,
  GetAllTranslationsFunction,
  SendTranslationsUsageFunction,
  GetAllTranslationsForAllLanguagesFunction,
  LanguagesConfig,
  LastRefresh,
  UniqueId,
  I18nKeylessRequestBody,
  I18nKeylessResponse,
  I18nKeylessTranslationsUsageRequestBody,
  I18nKeylessAllTranslationsResponse,
  FetchTranslationParams,
  TranslationOptions
} from "./types.ts";
export type { SdkRuntime } from "./unique-id.ts";
export {
  getTranslationCore,
  getAllTranslationsFromLanguage,
  sendTranslationsUsageToI18nKeyless,
  getNamespacesToFetchAfterTranslationFinished,
  resolveNamespace,
  resolveOriginLanguage,
  queue,
  // protocol helpers, pure: what the conformance vectors replay (see docs/PROTOCOL.md)
  DEFAULT_API_URL,
  storageKeyFor,
  queueIdFor,
  applyReplace,
  buildDictionaryUrl,
  etagCacheKey
} from "./service.ts";
export { api, TIMEOUT_MS, RETRY_DELAYS_MS, MAX_ATTEMPTS, isRetryableStatus, httpErrorMessage } from "./api.ts";
export {
  generateUniqueId,
  isUniqueId,
  setUniqueId,
  getUniqueId,
  holdRequestsUntilUniqueIdIsKnown,
  releaseUniqueIdGate,
  whenUniqueIdIsKnown,
  resolveUniqueIdForRequest,
  setSdkRuntime,
  getSdkRuntime,
  identityHeaders,
  resolveSdkRuntime,
  isUsageReportingEnabled,
  isServerRuntime,
  UNIQUE_ID_ALPHABET,
  UNIQUE_ID_LENGTH,
  // exported for the SDK test suites: clears the process-level id and any held gate
  resetUniqueIdState
} from "./unique-id.ts";

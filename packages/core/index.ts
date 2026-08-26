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
  queue
} from "./service.ts";
export { api } from "./api.ts";
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
  // exported for the SDK test suites: clears the process-level id and any held gate
  resetUniqueIdState
} from "./unique-id.ts";

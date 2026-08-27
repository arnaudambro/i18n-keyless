export {
  init,
  getAllTranslationsForAllLanguages,
  getSupportedLanguages,
  awaitForTranslation,
  awaitForTranslationOrThrow,
  awaitForTranslationOrFallbackToOriginal
} from "./service.ts";
export type {
  Translations,
  I18nKeylessNodeConfig,
  I18nKeylessNodeStore,
  TranslationOptions,
  I18nKeylessRequestBody,
  I18nKeylessAllTranslationsResponse
} from "./types.ts";
export {
  AVAILABLE_LANGS,
  APP_STORE_LOCALES,
  type Lang,
  type PrimaryLang,
  type I18nKeylessResponse,
  resolveLang,
  toAppStoreLocale,
  queue
} from "i18n-keyless-core";

export { init, getAllTranslationsForAllLanguages, getSupportedLanguages, awaitForTranslation } from "./service.ts";
export type {
  Translations,
  I18nKeylessNodeConfig,
  I18nKeylessNodeStore,
  TranslationOptions,
  I18nKeylessRequestBody,
  I18nKeylessAllTranslationsResponse
} from "./types.ts";
export { AVAILABLE_LANGS, type Lang, type PrimaryLang, type I18nKeylessResponse, queue } from "i18n-keyless-core";

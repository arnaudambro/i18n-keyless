export { init, getTranslation, getAllTranslationsForAllLanguages, awaitForTranslation } from "./service";
export type {
  Translations,
  I18nKeylessNodeConfig,
  I18nKeylessNodeStore,
  TranslationOptions,
  I18nKeylessRequestBody,
  I18nKeylessAllTranslationsResponse,
} from "./types";
export { type Lang, type PrimaryLang, type I18nKeylessResponse, queue } from "i18n-keyless-core";

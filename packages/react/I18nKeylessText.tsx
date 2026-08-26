import React from "react";
import { type TranslationOptions } from "i18n-keyless-core";
import { useTranslationState } from "./useTranslation.ts";

export interface I18nKeylessTextProps {
  /**
   * The `children` prop must be a string.
   * It's the text to translate from your primary language.
   */
  children: string | React.ReactNode;
  /**
   * The keys to replace in the text.
   * It's an object where the key is the placeholder and the value is the replacement.
   * Example: { "{{name}}": "John" } will replace all the {{name}} in the text with "John".
   * RegEx is `key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))` so you can use use your own syntax.
   */
  replace?: TranslationOptions["replace"];
  /**
   * The context of the translation.
   * It's useful for ambiguous translations, like "8 heures" in French could be "8 AM" or "8 hours".
   */
  context?: TranslationOptions["context"];
  /**
   * The namespace this translation belongs to. Translations are fetched and persisted per
   * namespace, so splitting a large app into namespaces keeps each storage item small
   * (avoids the localStorage quota error). Defaults to `defaultNamespace` from config.
   */
  namespace?: TranslationOptions["namespace"];
  /**
   * When true, this namespace's translations live in memory only (never persisted, never
   * reloaded at boot). Use for high-cardinality, transient namespaces (e.g. one per discussion).
   */
  unpersistedNamespace?: TranslationOptions["unpersistedNamespace"];
  /**
   * If true, some helpful logs will be displayed in the console.
   */
  debug?: TranslationOptions["debug"];
  /**
   * If the proposed translation from AI is not satisfactory,
   * you can use this field to setup your own translation.
   * You can leave it there forever, or remove it once your translation is saved.
   */
  forceTemporary?: TranslationOptions["forceTemporary"];
  /**
   * The language the text is written in when it differs from the primary language —
   * i.e. user generated content (UGC). The backend translates it into the primary language,
   * keeps the raw text for viewers in that language, and AI-translates all the others.
   * When the current language IS the origin language, the text is rendered as-is (no API call).
   */
  originLanguage?: TranslationOptions["originLanguage"];
}

/**
 * `useTranslation` as an element. Everything — the storage key, the provider / request-scope
 * / store resolution, translate-on-miss, the SSR snapshot, `replace` — lives in the hook, so
 * the two never drift. Reach for the hook where an element will not do (a `placeholder`, a
 * `title`, a string handed to another library).
 */
export const I18nKeylessText: React.FC<I18nKeylessTextProps> = ({ children, ...options }) => {
  const rawText = Array.isArray(children) ? children.join("") : String(children ?? "");
  const { text, lang } = useTranslationState(rawText, options);
  return <React.Fragment key={lang}>{text}</React.Fragment>;
};

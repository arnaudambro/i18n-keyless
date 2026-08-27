import { isDevMode } from "@angular/core";
import type { Lang, TranslationOptions } from "i18n-keyless-core";
import { store, getTranslation, isServerEnv } from "./store.ts";
import { getRequestScope, recordUsedKey, type I18nRequestScope } from "./request-scope.ts";

/**
 * The lookup behind `<i18n-t>`, the `t` pipe and `I18nKeylessService.translate()`.
 *
 * Pure and reactive: it reads the store *signals* (and the DI request scope when one is
 * given), so a template, a `computed` or an `effect` calling it re-evaluates when the
 * language changes or when a translation lands. It has no side effect: translate-on-miss
 * and usage recording live in `requestTranslation`, so the two never drift.
 */
export function resolveTranslation(
  sourceText: string,
  options: TranslationOptions | undefined,
  scope: I18nRequestScope | null | undefined
): { text: string; lang: Lang } {
  const context = options?.context;
  const storageKey = context ? `${sourceText}__${context}` : sourceText;

  // SSR: the DI scope first (provideI18nKeylessServer), then the AsyncLocalStorage scope
  // (runWithI18nKeyless), then the global store (SPA mode).
  const requestScope = scope ?? getRequestScope();
  const config = store.config();
  const currentLanguage = requestScope?.lang ?? store.currentLanguage();
  const translation = requestScope ? requestScope.translations[storageKey] : store.translations()[storageKey];

  // Record the key for the per-page SSR snapshot (pure Set.add, no-op off-server).
  recordUsedKey(storageKey);

  // The text renders as-is when the current language is the one it is written in: the
  // primary language, except for UGC (originLanguage), which looks up the map even when
  // the current language is the primary one.
  const primary = config.languages.primary;
  const originLanguage = options?.originLanguage;
  const sourceLanguage = originLanguage && originLanguage !== primary ? originLanguage : primary;
  const translatedText = currentLanguage === sourceLanguage ? sourceText : translation || sourceText;

  return { text: applyReplace(translatedText, options?.replace), lang: currentLanguage };
}

/**
 * Regex-safe interpolation: `{ "{name}": "Ada" }` replaces every literal `{name}`.
 * Same implementation as the core, so the pipe and the function path interpolate alike.
 */
export function applyReplace(text: string, replace: TranslationOptions["replace"]): string {
  if (!replace) {
    return text;
  }
  const pattern = Object.keys(replace)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!pattern) {
    return text;
  }
  const regex = new RegExp(pattern, "g");
  return text.replace(regex, (matched) => replace[matched] || matched);
}

/**
 * Translate-on-miss plus usage recording for one source text: the side-effect half of a
 * lookup. Browser only, and only once the config is in the store (before
 * `provideI18nKeyless` has run there is nothing to call). Never runs on the server: a
 * server render is read-only, exactly like `<I18nKeylessText>` in the react package.
 */
export function requestTranslation(sourceText: string, options?: TranslationOptions): void {
  if (!sourceText || isServerEnv()) {
    return;
  }
  if (!store.config().API_KEY) {
    return;
  }
  const { replace: _replace, ...rest } = options ?? {};
  void _replace;
  getTranslation(sourceText, rest);
}

/**
 * Same rule as the react package: the key is the trimmed text, and leading / trailing
 * whitespace is reported in dev mode because it silently changes the key.
 *
 * `<i18n-t>` passes `warn: false`: Angular's compiler leaves one space around multi-line
 * template text (`preserveWhitespaces: false` collapses, it does not trim), so a warning
 * there would fire on every wrapped line. The pipe and the service warn.
 */
export function normalizeSourceText(text: string, warn = true): string {
  const trimmed = text.trim();
  if (warn && isDevMode() && trimmed !== text && trimmed) {
    console.warn(
      `i18n-keyless received text with leading/trailing whitespace: "${text}". ` +
        "This may cause inconsistencies in translations. Consider trimming the text."
    );
  }
  return trimmed;
}

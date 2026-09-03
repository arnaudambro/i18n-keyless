import { useEffect, useMemo } from "react";
import { getTranslationCore, type TranslationOptions } from "i18n-keyless-core";
import { useI18nKeyless, getTranslation } from "./store.ts";
import { useI18nKeylessContext } from "./I18nKeylessProvider.tsx";
import { getRequestScope, recordUsedKey } from "./request-scope.ts";

/**
 * The reactive `t` function returned by `useTranslation()` called without a text.
 * `options` merge over the ones given to the hook, per call.
 */
export type TranslateFunction = (text: string, options?: TranslationOptions) => string;

const warnAboutWhitespace = (text: string) => {
  if (process.env.NODE_ENV === "development" && text !== text.trim()) {
    console.warn(
      `i18n-keyless received text with leading/trailing whitespace: "${text}". ` +
        "This may cause inconsistencies in translations. Consider trimming the text."
    );
  }
};

/**
 * The translated *string* for `text`, resolved exactly the way `<I18nKeylessText>` resolves it.
 *
 * Use it where an element will not do — a `placeholder`, a `title`, an `aria-label`, a
 * string handed to another library. Everywhere else prefer `<I18nKeylessText>`, which is
 * this hook plus a fragment.
 *
 * It is a hook, so unlike `getTranslation()` it is reactive (re-renders when the
 * translation lands or the language changes) and, under SSR, it reads the request's
 * language from `<I18nKeylessProvider>` — which is what makes it correct in frameworks that
 * render the component tree outside the `runWithI18nKeyless` scope (TanStack Start). See
 * docs/SSR.md.
 *
 * Called **without a text**, it returns a reactive `t(text, options?)` function instead —
 * for a component with many strings, strings inside an array or a `.map()`, or a helper
 * that builds its labels (a nav, a table header, a menu). Same resolution, same options
 * (the hook's options are the defaults, a call's options merge over them), same SSR
 * behaviour. The one difference: `t` cannot know its keys ahead of time, so the component
 * re-renders on every translation batch that lands, not only on its own strings. That is
 * the right trade for a nav with 25 labels; for one placeholder, pass the text to the hook.
 *
 * ```tsx
 * const t = useTranslation({ context: "navigation" });
 * <Nav items={links.map((l) => ({ ...l, label: t(l.label) }))} />
 * ```
 *
 * A call site uses one form or the other, never both: the two forms call different hooks.
 */
export function useTranslation(text: string, options?: TranslationOptions): string;
export function useTranslation(options?: TranslationOptions): TranslateFunction;
export function useTranslation(
  textOrOptions?: string | TranslationOptions,
  options: TranslationOptions = {}
): string | TranslateFunction {
  if (typeof textOrOptions === "string") {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a call site never switches form
    return useTranslationState(textOrOptions, options).text;
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks -- a call site never switches form
  return useTranslator(textOrOptions ?? {});
}

/**
 * The function form of `useTranslation`. Subscribes to the language and to the whole
 * translations map, then resolves each call the way `getTranslation()` does — through the
 * `<I18nKeylessProvider>` request scope when there is one (the SSR component tree), through
 * the store otherwise (the SPA, and the AsyncLocalStorage scope inside `getTranslation`).
 */
function useTranslator(defaults: TranslationOptions): TranslateFunction {
  const scope = useI18nKeylessContext();
  const currentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const translations = useI18nKeyless((store) => store.translations);
  const lang = scope?.lang ?? currentLanguage;

  return useMemo<TranslateFunction>(() => {
    return (text, callOptions) => {
      const merged = callOptions ? { ...defaults, ...callOptions } : defaults;
      const sourceText = text.trim();
      if (scope?.translations) {
        // Same view of the store that `getTranslation` builds for the AsyncLocalStorage
        // scope, keyed on the provider's language and dictionary instead.
        recordUsedKey(merged.context ? `${sourceText}__${merged.context}` : sourceText);
        const base = useI18nKeyless.getState();
        return getTranslationCore(sourceText, { ...base, currentLanguage: scope.lang, translations: scope.translations }, merged);
      }
      return getTranslation(sourceText, merged);
    };
    // `defaults` is usually an inline literal: key on its content, not its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, lang, translations, JSON.stringify(defaults)]);
}

/**
 * The hook behind `useTranslation` and `<I18nKeylessText>`. Also hands back the language the
 * text resolved in, which the component uses to key its fragment. Not exported from the
 * package: `useTranslation` is the public surface.
 */
export function useTranslationState(text: string, options: TranslationOptions = {}): { text: string; lang: string | null } {
  const { replace, context, namespace, unpersistedNamespace, debug = false, forceTemporary, originLanguage } =
    options;

  // Trim the source text immediately. Pure computation, kept above the hooks so the
  // translation selector below can close over this call's own storage key.
  const sourceText = text.trim();
  const storageKey = context ? `${sourceText}__${context}` : sourceText;

  // Select ONLY this key's translation, never the whole `translations` map. Every batch
  // that lands replaces the map with a new object, so a map selector makes zustand
  // re-render every caller on the page — including the ones whose text did not change, and
  // the ones belonging to another namespace entirely. Selecting the string keeps the
  // default Object.is check meaningful: a caller re-renders only when its own text changes.
  // See __tests__/render-count.test.tsx.
  const storeTranslation = useI18nKeyless((store) => store.translations[storageKey]);
  const storeCurrentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const config = useI18nKeyless((store) => store.config);

  // In SSR mode, language and translations come from the per-request scope so concurrent
  // requests don't share state: the React-context provider first, then the
  // AsyncLocalStorage request scope (set by runWithI18nKeyless). Otherwise (SPA mode)
  // both are absent and we use the global store. See docs/SSR.md.
  const requestScope = useI18nKeylessContext() ?? getRequestScope();
  const translation = requestScope?.translations ? requestScope.translations[storageKey] : storeTranslation;
  const currentLanguage = requestScope?.lang ?? storeCurrentLanguage;

  useEffect(() => {
    warnAboutWhitespace(text);
  }, [text]);

  // Translate-on-miss. In an effect, so it never runs on the server and never writes to
  // the store during render.
  useEffect(() => {
    getTranslation(sourceText, { context, namespace, unpersistedNamespace, debug, forceTemporary, originLanguage });
  }, [sourceText, currentLanguage, context, namespace, unpersistedNamespace, debug, forceTemporary, originLanguage]);

  // Record the key for the per-page SSR snapshot (no-op off-server; pure Set.add, no
  // setState, so no render-time update warning). See docs/SSR.md.
  recordUsedKey(storageKey);

  // The text renders as-is when the current language is the one it's written in: the
  // primary language, except for UGC (originLanguage) — a UGC key looks up the map even
  // when the current language is the primary one.
  const sourceLanguage =
    originLanguage && originLanguage !== config!.languages.primary ? originLanguage : config!.languages.primary;
  const translatedText = currentLanguage === sourceLanguage ? sourceText : translation || sourceText;

  const finalText = useMemo(() => {
    if (!replace) {
      return translatedText;
    }

    // Create a regex that matches all keys to replace
    // Escape special regex characters in keys
    const pattern = Object.keys(replace)
      .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");

    const regex = new RegExp(pattern, "g");

    // Replace all occurrences in a single pass
    return translatedText.replace(regex, (matched) => replace[matched] || matched);
  }, [translatedText, replace]);

  if (debug) {
    console.log({
      text,
      sourceText,
      currentLanguage,
      translatedText,
      finalText,
      replace,
      context,
      forceTemporary,
      originLanguage
    });
  }

  return { text: finalText, lang: currentLanguage };
}

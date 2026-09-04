import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import { type Lang, type TranslationOptions, resolveNamespace } from "i18n-keyless-core";
import { store, getTranslation, setCurrentLanguage, getSupportedLanguages, setState, getState } from "./store.ts";
import { useI18nKeylessContext, type I18nKeylessContextValue } from "./context.ts";
import { getRequestScope } from "./request-scope.ts";
import type { TranslationStore } from "./types.ts";

function isDevelopment(): boolean {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "development";
}

const warnAboutWhitespace = (text: string) => {
  if (isDevelopment() && text !== text.trim()) {
    console.warn(
      `i18n-keyless received text with leading/trailing whitespace: "${text}". ` +
        "This may cause inconsistencies in translations. Consider trimming the text."
    );
  }
};

function applyReplace(text: string, replace: TranslationOptions["replace"]): string {
  if (!replace) {
    return text;
  }
  // Create a regex that matches all keys to replace, escaping special regex characters in keys
  const pattern = Object.keys(replace)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(pattern, "g");
  // Replace all occurrences in a single pass
  return text.replace(regex, (matched) => replace[matched] || matched);
}

/**
 * The side effects of showing `sourceText` in a component: translate-on-miss, the usage
 * record and the SSR snapshot key, all through `getTranslation` (store / request scope).
 * Memoized per component instance: at most once per (language, namespace, storage key)
 * for the instance's lifetime, the way the React package's effect runs once per mount.
 *
 * Without the memo a miss re-requests itself forever: the bulk fetch that follows the
 * POST replaces the `translations` map, the new map re-renders the component, the render
 * finds the key still missing (or `forceTemporary` set) and queues the POST again.
 *
 * A language change is a new tuple, so it re-requests once for the new language. The
 * language is the one the request resolves in (the `runWithI18nKeyless` scope, else the
 * store), which is read here, in the render, so a store language change re-renders the
 * component and re-requests.
 */
export type TranslationRequester = (sourceText: string, options: TranslationOptions) => void;

export function createTranslationRequester(): TranslationRequester {
  const requested = new Set<string>();
  return (sourceText, options) => {
    const lang = getRequestScope()?.lang ?? store.currentLanguage;
    const namespace = resolveNamespace(options, store.config);
    const storageKey = options.context ? `${sourceText}__${options.context}` : sourceText;
    const memoKey = `${lang}\u0000${namespace}\u0000${storageKey}`;
    if (requested.has(memoKey)) {
      return;
    }
    requested.add(memoKey);
    getTranslation(sourceText, { ...options, replace: undefined });
  };
}

/**
 * The translated string for `text`, resolved exactly the way `<I18nKeylessText>` and
 * `t()` resolve it: the provided scope first (`<I18nKeylessProvider>` / plugin), then the
 * `runWithI18nKeyless` request scope, then the store. The lookup itself is pure: the
 * translate-on-miss request, the usage record and the SSR key recording go through
 * `request` (see `createTranslationRequester`), once per instance per key and language.
 *
 * Pure with respect to Vue: it reads reactive state (the store, the scope) and nothing
 * else, so a caller inside a template, a `computed` or a `watch` is tracked. Not exported
 * from the package.
 */
export function resolveTranslation(
  text: string,
  options: TranslationOptions,
  scope: I18nKeylessContextValue | null,
  request: TranslationRequester
): { text: string; lang: Lang } {
  const { replace, context, originLanguage, debug, forceTemporary } = options;

  // Trim the source text: the key is the trimmed text, always.
  const sourceText = text.trim();
  const storageKey = context ? `${sourceText}__${context}` : sourceText;

  // Translate-on-miss, usage, SSR snapshot: memoized, never more than once per instance
  // per (language, namespace, key). `replace` is applied once, below.
  request(sourceText, options);

  const requestScope = scope ?? getRequestScope();
  const currentLanguage = requestScope?.lang ?? store.currentLanguage;
  const translations = requestScope?.translations ?? store.translations;

  // The text renders as-is when the current language is the one it's written in: the
  // primary language, except for UGC (originLanguage), which looks the map up even when
  // the current language is the primary one. The primary comes from the provided scope
  // when it carries one, never from the store in that case: the store may never have run
  // `init()` in this module graph. The AsyncLocalStorage scope shares the store's graph.
  const primary = scope?.primary ?? store.config.languages.primary;
  const sourceLanguage = originLanguage && originLanguage !== primary ? originLanguage : primary;
  const translatedText = currentLanguage === sourceLanguage ? sourceText : translations[storageKey] || sourceText;

  const finalText = applyReplace(translatedText, replace);

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
      originLanguage,
    });
  }

  return { text: finalText, lang: currentLanguage };
}

/**
 * The translated *string* for `text`, as a reactive `computed`, resolved exactly the way
 * `<I18nKeylessText>` resolves it.
 *
 * Use it where an element will not do: a `placeholder`, a `title`, an `aria-label`, a
 * string handed to another library. Everywhere else prefer `<I18nKeylessText>`.
 *
 * `text` and `options` can be plain values, refs or getters, so the result follows them:
 *
 *   const placeholder = useTranslation("Votre email");
 *   const greeting = useTranslation(() => `Bonjour {name}`, () => ({ replace: { "{name}": props.name } }));
 *
 * Call it in `setup()` (or `<script setup>`): that is where it reads the
 * `<I18nKeylessProvider>` scope. In a template the ref unwraps by itself.
 */
export function useTranslation(
  text: MaybeRefOrGetter<string>,
  options: MaybeRefOrGetter<TranslationOptions> = {}
): ComputedRef<string> {
  return useTranslationState(text, options).text;
}

/**
 * The composable behind `useTranslation`: the text AND the language it resolved in. Not
 * exported from the package.
 */
export function useTranslationState(
  text: MaybeRefOrGetter<string>,
  options: MaybeRefOrGetter<TranslationOptions> = {}
): { text: ComputedRef<string>; lang: ComputedRef<Lang> } {
  const scope = useI18nKeylessContext();
  const request = createTranslationRequester();
  let lastWarned: string | undefined;
  const state = computed(() => {
    const rawText = toValue(text);
    if (rawText !== lastWarned) {
      lastWarned = rawText;
      warnAboutWhitespace(rawText);
    }
    return resolveTranslation(rawText, toValue(options), scope, request);
  });
  return {
    text: computed(() => state.value.text),
    lang: computed(() => state.value.lang),
  };
}

export interface UseI18nKeylessReturn {
  /**
   * Translates `text` for use in a template or a computed: `{{ t("Bonjour", { context }) }}`.
   * Reactive where it is read: it tracks the translations map, the current language and
   * the provider scope. Same options as `<I18nKeylessText>`. A miss is requested once per
   * component instance per key and language, however many times the read re-runs.
   */
  t: (text: string, options?: TranslationOptions) => string;
  /**
   * The language the component renders in: the provider's under a provider, else the store's.
   */
  currentLanguage: ComputedRef<Lang>;
  /**
   * The translations map in use: the provider's under a provider, else the store's.
   */
  translations: ComputedRef<Record<string, string>>;
  /**
   * The live, reactive store (state + actions).
   */
  store: TranslationStore;
  setCurrentLanguage: typeof setCurrentLanguage;
  getSupportedLanguages: typeof getSupportedLanguages;
}

function useI18nKeylessComposable(): UseI18nKeylessReturn {
  const scope = useI18nKeylessContext();
  // One memo per composable call, so per component instance: `t()` re-evaluated by a
  // template or a computed requests each key once per language.
  const request = createTranslationRequester();
  return {
    t: (text, options = {}) => resolveTranslation(text, options, scope, request).text,
    currentLanguage: computed(() => scope?.lang ?? store.currentLanguage),
    translations: computed(() => scope?.translations ?? store.translations),
    store,
    setCurrentLanguage,
    getSupportedLanguages,
  };
}

/**
 * The store composable. Call it in `setup()`:
 *
 *   const { t, currentLanguage, setCurrentLanguage } = useI18nKeyless();
 *
 * It also carries `getState()` / `setState()` (the store is a process-wide reactive
 * object), so `useI18nKeyless.getState().translations` works from plain script code and
 * tests, the way a zustand bound store does.
 */
export const useI18nKeyless = Object.assign(useI18nKeylessComposable, { getState, setState });

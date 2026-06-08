import { type Lang, type Translations, getAllTranslationsFromLanguage } from "i18n-keyless-core";
import { useI18nKeyless } from "./store.ts";

/**
 * Process-wide cache of translations per language.
 *
 * Translations for a given language are identical for every request, so they are
 * global, cacheable data — only the *choice* of language is per-request. Caching here
 * means each language is fetched at most once per server process. A process restart /
 * redeploy naturally picks up new translations.
 */
const cache = new Map<Lang, Translations>();

/**
 * Fetches the translations map for `lang` on the server, cached per process.
 *
 * Pass the result to `<I18nKeylessProvider lang={lang} translations={...}>` and
 * serialize it into the HTML so the client can hydrate without a flash.
 *
 * Requires `init()` to have been called first (so the store holds API config). Returns
 * an empty map for the primary language (no translation needed) and on fetch failure.
 *
 * See docs/SSR.md.
 */
export async function getServerTranslations(lang: Lang): Promise<Translations> {
  const store = useI18nKeyless.getState();
  if (lang === store.config.languages.primary) {
    return {};
  }
  const cached = cache.get(lang);
  if (cached) {
    return cached;
  }
  // lastRefresh: null forces a full fetch of the language.
  const response = await getAllTranslationsFromLanguage(lang, { ...store, lastRefresh: null });
  const translations = response?.ok ? response.data.translations : {};
  cache.set(lang, translations);
  return translations;
}

/**
 * Clears the per-process server translations cache. Pass a `lang` to evict a single
 * language, or omit it to clear everything (e.g. after publishing new translations).
 */
export function clearServerTranslationsCache(lang?: Lang): void {
  if (lang) {
    cache.delete(lang);
  } else {
    cache.clear();
  }
}

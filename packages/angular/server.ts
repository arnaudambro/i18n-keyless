import { type Lang, type Translations, getAllTranslationsFromLanguage } from "i18n-keyless-core";
import { store } from "./store.ts";

/**
 * Process-wide cache of translations per language.
 *
 * Translations for a given language are identical for every request, so they are
 * global, cacheable data; only the *choice* of language is per-request. Each language is
 * fetched at most once per server process. A restart / redeploy picks up new translations.
 */
const cache = new Map<Lang, Translations>();

/**
 * Fetches the translations map for `lang` on the server, cached per process.
 *
 * Hand the result to `provideI18nKeylessServer({ lang, translations })` and transfer it to
 * the client so it hydrates without a flash.
 *
 * Requires `init` (`provideI18nKeyless`) to have run first, so the store holds the API
 * config. Returns an empty map for the primary language and on fetch failure.
 */
export async function getServerTranslations(lang: Lang): Promise<Translations> {
  const state = store.getState();
  if (lang === state.config.languages.primary) {
    return {};
  }
  const cached = cache.get(lang);
  if (cached) {
    return cached;
  }
  // lastRefresh: null forces a full fetch of the language.
  const response = await getAllTranslationsFromLanguage(lang, { ...state, lastRefresh: null });
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

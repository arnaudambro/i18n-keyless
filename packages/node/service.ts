import {
  type Lang,
  type TranslationOptions,
  type I18nKeylessRequestBody,
  resolveOriginLanguage,
  AVAILABLE_LANGS,
  DEFAULT_NAMESPACE,
  I18nKeylessAllTranslationsResponse,
  api,
  identityHeaders,
  setSdkRuntime
} from "i18n-keyless-core";
import { I18nKeylessNodeConfig, I18nKeylessNodeStore } from "./types.ts";
import packageJson from "./package.json" with { type: "json" };
import { I18nKeylessTranslationsUsageRequestBody, SendTranslationsUsageFunction } from "i18n-keyless-core/types";

/**
 * An empty translations bucket for every supported language. Derived from
 * `AVAILABLE_LANGS` so adding a language to core never leaves this map behind.
 */
function emptyTranslationsByLang(): I18nKeylessNodeStore["translations"] {
  return Object.fromEntries(AVAILABLE_LANGS.map((lang) => [lang, {}])) as I18nKeylessNodeStore["translations"];
}

const store: I18nKeylessNodeStore = {
  translations: emptyTranslationsByLang(),
  translationsUsageByNamespace: {},
  lastRefresh: "",
  config: {
    API_KEY: "",
    languages: {
      primary: "fr",
      supported: ["fr"]
    }
  }
};

/**
 * Fetches all translations
 * @param store - The translation store
 * @returns Promise resolving to the translation response or void if failed
 */
/**
 * ETags of the all-languages dictionaries fetched by this process, keyed by namespace.
 * Replayed as `If-None-Match`: an unchanged namespace answers `304` with no body over a
 * stable, cache-friendly URL. In-memory only — after a restart the first fetch is a 200.
 */
const dictionaryEtags = new Map<string, string>();

export async function getAllTranslationsForAllLanguages(
  namespace?: string
): Promise<I18nKeylessAllTranslationsResponse | void> {
  const config = store.config;
  const lastRefresh = store.lastRefresh;
  if (!config.API_KEY) {
    console.error("i18n-keyless: No config found");
    return;
  }
  // if (config.languages.primary === targetLanguage) {
  //   return;
  // }

  // Omit the default namespace from the query so existing (non-namespaced) installs keep
  // hitting the exact same URL.
  const namespaceQuery =
    namespace && namespace !== DEFAULT_NAMESPACE ? `&namespace=${encodeURIComponent(namespace)}` : "";
  const etagKey = namespace || DEFAULT_NAMESPACE;
  const etag = dictionaryEtags.get(etagKey);
  // With an ETag in hand, freshness travels in the If-None-Match header and last_refresh
  // leaves the URL — the URL becomes stable, so shared HTTP caches can hold it.
  const query = etag
    ? namespaceQuery
      ? `?${namespaceQuery.slice(1)}`
      : ""
    : `?last_refresh=${lastRefresh}${namespaceQuery}`;
  try {
    const response = config.getAllTranslationsForAllLanguages
      ? await config.getAllTranslationsForAllLanguages()
      : await api
          .fetchAllTranslationsForAllLanguages(`${config.API_URL || "https://api.i18n-keyless.com"}/translate/${query}`, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.API_KEY}`,
              Version: packageJson.version,
              ...identityHeaders(),
              ...(etag ? { "If-None-Match": etag } : {})
            }
          })
          .then((res) => res as I18nKeylessAllTranslationsResponse);

    if (response.notModified) {
      // Nothing changed server-side: keep the in-memory dictionaries as they are.
      return;
    }

    if (!response.ok) {
      throw new Error(response.error);
    }

    if (response.etag) {
      dictionaryEtags.set(etagKey, response.etag);
    }

    if (response.message) {
      console.warn("i18n-keyless: ", response.message);
    }

    return response;
  } catch (error) {
    console.error("i18n-keyless: fetch all translations error:", error);
  }
}

/**
 * Send the translations usage to i18n-keyless API
 *
 * This is used to clean up the translations database
 * and to avoid paying for translations that are not used anymore
 *
 * It's called on lib initialization
 * and everytime the language is set
 * @param translationsUsage - The translations usage
 * @param store - The translation store
 * @returns Promise resolving to the translation response or void if failed
 */
export async function sendTranslationsUsageToI18nKeyless(): Promise<{ ok: boolean; message: string } | void> {
  const config = store.config;
  if (!config.API_KEY) {
    console.error("i18n-keyless: No config found");
    return;
  }
  const translationsUsageByNamespace = store.translationsUsageByNamespace;
  if (Object.keys(translationsUsageByNamespace).length === 0) {
    return;
  }
  const requestBody: I18nKeylessTranslationsUsageRequestBody = {
    primaryLanguage: config.languages.primary,
    translationsUsageByNamespace
  };
  try {
    const response = config.sendTranslationsUsage
      ? await config.sendTranslationsUsage(translationsUsageByNamespace.default ?? {})
      : await api
          .postLastUsedTranslations(
            `${config.API_URL || "https://api.i18n-keyless.com"}/translate/last-used-translations`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.API_KEY}`,
                // This route is counted like any other, so it must be labelled like any
                // other. It used to carry no identity header at all.
                ...identityHeaders(),
                Version: packageJson.version
              },
              body: JSON.stringify(requestBody)
            }
          )
          .then((res) => res as ReturnType<NonNullable<SendTranslationsUsageFunction>>);

    if (response.message) {
      console.warn("i18n-keyless: ", response.message);
    }

    return response;
  } catch (error) {
    console.error("i18n-keyless: send translations usage error:", error);
  }
}

/**
 * Applies the `replace` map to a text: keys are regex-escaped and replaced in a single pass.
 */
function applyReplace(text: string, replace?: TranslationOptions["replace"]): string {
  if (!replace) {
    return text;
  }
  // Create a regex that matches all keys to replace
  // Escape special regex characters in keys
  const pattern = Object.keys(replace)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!pattern) {
    return text;
  }
  const regex = new RegExp(pattern, "g");

  // Replace all occurrences in a single pass
  return text.replace(regex, (matched) => replace[matched] || matched);
}

/**
 * Keeps only the entries that name a language we know.
 *
 * A custom `handleTranslate` is free to return whatever it wants, and it must not grow
 * phantom entries in the store.
 */
function knownLanguagesOnly(
  translationByLang?: Partial<Record<Lang, string>>
): Partial<Record<Lang, string>> {
  const known: Partial<Record<Lang, string>> = {};
  if (!translationByLang) {
    return known;
  }
  for (const lang of Object.keys(translationByLang) as Lang[]) {
    const value = translationByLang[lang];
    // The API answers with the stored row: its flat `id` is the numeric row id, not the
    // Indonesian cell. Anything that is not a non-empty string is not a translation.
    if (typeof value !== "string" || !value || !AVAILABLE_LANGS.includes(lang)) {
      continue;
    }
    known[lang] = value;
  }
  return known;
}

/**
 * Merges a translation into the in-memory store for every language the API returned.
 *
 * The store is flat (one map per language, no namespace dimension), like the bulk fetch that
 * feeds it at init: two namespaces sharing the exact same source text share one cache entry.
 */
function cacheTranslation(translationKey: string, translationByLang?: Partial<Record<Lang, string>>) {
  const normalized = knownLanguagesOnly(translationByLang);
  for (const lang of Object.keys(normalized) as Lang[]) {
    // Every known language has a bucket from boot, and `knownLanguagesOnly` keeps only those.
    store.translations[lang] = { ...store.translations[lang], [translationKey]: normalized[lang]! };
  }
}

/**
 * Usage is flushed on a debounce instead of on every newly-seen key: a server rendering a
 * page with hundreds of keys would otherwise POST the (cumulative) usage map once per key,
 * which is what rate limits the process. One POST per window carries everything anyway,
 * since the map is cumulative and never reset.
 */
const USAGE_FLUSH_DEBOUNCE_MS = 10_000;
let usageFlushTimeout: ReturnType<typeof setTimeout> | null = null;
function scheduleTranslationsUsageFlush() {
  if (usageFlushTimeout) {
    return;
  }
  usageFlushTimeout = setTimeout(() => {
    usageFlushTimeout = null;
    sendTranslationsUsageToI18nKeyless();
  }, USAGE_FLUSH_DEBOUNCE_MS);
  // Never keep the process alive just to report analytics (scripts, serverless).
  (usageFlushTimeout as unknown as { unref?: () => void }).unref?.();
}

// No `queue.on("empty")` refetch here: that map is only fed by core's `translateKey`, which
// this package never calls (the awaitForTranslation* functions POST directly and cache the
// answer).

export async function init(newConfig: I18nKeylessNodeConfig): Promise<I18nKeylessNodeConfig> {
  if (!newConfig.languages) {
    throw new Error("i18n-keyless: languages is required");
  }
  if (!newConfig.languages.primary) {
    throw new Error("i18n-keyless: primary is required");
  }
  if (!newConfig.getAllTranslationsForAllLanguages || !newConfig.handleTranslate) {
    if (!newConfig.API_KEY) {
      if (!newConfig.API_URL) {
        throw new Error(
          "i18n-keyless: you didn't provide an API_KEY nor an API_URL nor a handleTranslate + getAllTranslationsForAllLanguages function. You need to provide one of them to make i18n-keyless work"
        );
      }
    }
  }
  newConfig.addMissingTranslations = true;
  store.config = newConfig;
  store.config.onInit?.(newConfig.languages.primary);

  // A server sends no `unique_id`: the API counts it by source IP, which it cannot shape.
  // Any id this process invented would be wrong in one direction or the other — a fresh one
  // per boot inflates the count, a pinned one collapses a fleet to a single billed user.
  // The `sdk` header tells the API to count this request that way.
  setSdkRuntime("node");

  // Boot fetch must target the configured namespace, otherwise a project using
  // `defaultNamespace` boots with the (empty) "default" namespace and every key misses.
  const response = await getAllTranslationsForAllLanguages(newConfig.defaultNamespace);
  if (response?.ok) {
    // Merge rather than assign, so the per-language buckets survive.
    for (const lang of Object.keys(response.data.translations) as Lang[]) {
      if (!AVAILABLE_LANGS.includes(lang)) {
        continue;
      }
      store.translations[lang] = { ...store.translations[lang], ...response.data.translations[lang] };
    }
    // `lastRefresh` is deliberately NOT stored: it's global here while fetches are per
    // namespace, so reusing namespace A's timestamp for namespace B would silently drop
    // everything B had before it.
    //
    // The id the server echoes back is ignored: we sent our own, it is the same value, and
    // adopting a response's id would let a hiccup re-identify a stable process.
  }

  return newConfig;
}

/** In-flight POSTs keyed by `namespace:key__context:originLanguage`, to dedup concurrent misses. */
const inFlightTranslations = new Map<string, Promise<Partial<Record<Lang, string>> | undefined>>();

/**
 * POSTs a missing key to the translation API and caches the result in the store, so the same
 * key never goes over the wire twice in the lifetime of the process.
 * @returns the translation for every language the API returned, or undefined
 */
async function fetchTranslationFromApi(
  key: string,
  translationKey: string,
  options?: TranslationOptions
): Promise<Partial<Record<Lang, string>> | undefined> {
  const config = store.config;
  const debug = options?.debug;
  const namespace = options?.namespace || config.defaultNamespace || DEFAULT_NAMESPACE;

  const body: I18nKeylessRequestBody = {
    key,
    context: options?.context,
    // Omit the default namespace so the wire format is unchanged for non-namespaced use.
    namespace: namespace === DEFAULT_NAMESPACE ? undefined : namespace,
    forceTemporary: options?.forceTemporary,
    languages: config.languages.supported,
    primaryLanguage: config.languages.primary,
    // UGC flow: `key` is written in originLanguage; the backend keys the row by its
    // primary-language AI translation and keeps the raw key for originLanguage viewers.
    // The bulk-fetch dictionaries also index UGC rows by the raw key, so store lookups
    // keep working for every language (identity for originLanguage itself).
    originLanguage: resolveOriginLanguage(options, config)
  };
  const apiUrl = config.API_URL || "https://api.i18n-keyless.com";
  const url = `${apiUrl}/translate`;

  if (debug) {
    console.log("i18n-keyless: Fetching translation from API:", { url, body });
  }

  // Type assertion for the expected API response structure
  type ApiResponse = {
    ok: boolean;
    data?: { translation: Partial<Record<Lang, string>> };
    error?: string;
    message?: string;
  };

  const response = await api
    .fetchTranslation(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.API_KEY}`,
        ...identityHeaders(),
        Version: packageJson.version
      },
      body: JSON.stringify(body)
    })
    .then((res) => res as ApiResponse);

  if (debug) {
    console.log("i18n-keyless: API response received:", response);
  }

  if (!response.ok) {
    // Throw an error if the API response indicates failure
    throw new Error(response.error || `i18n-keyless: API request failed for key "${key}"`);
  }

  if (response.message) {
    // Log any informational messages from the API
    console.warn("i18n-keyless: API message:", response.message);
  }

  // Feed the store, otherwise every later call for this key POSTs again — forever.
  cacheTranslation(translationKey, response.data?.translation);

  return knownLanguagesOnly(response.data?.translation);
}

/**
 * Core logic for fetching/retrieving a translation asynchronously.
 * @param key - The text to translate
 * @param currentLanguage - The language to translate to
 * @param options - Optional parameters for the translation process
 * @returns Promise resolving to the translated string or the original key
 */
async function awaitForTranslationFn(
  key: string,
  currentLanguage: Lang,
  options?: TranslationOptions
): Promise<string> {
  const config = store.config;
  const translations = store.translations;
  const context = options?.context;
  const namespace = options?.namespace || config.defaultNamespace || DEFAULT_NAMESPACE;
  const debug = options?.debug;
  const replace = options?.replace;

  try {
    // Ensure config is initialized enough for either API call or custom handler
    if (!config.API_KEY && !config.handleTranslate) {
      throw new Error("i18n-keyless: config lacks API_KEY and handleTranslate. Cannot proceed.");
    }

    if (!key) {
      return "";
    }

    if (debug) {
      console.log("i18n-keyless: awaitForTranslationFn called with:", { key, currentLanguage, context, options });
    }

    const forceTemporaryLang = options?.forceTemporary?.[currentLanguage];
    const translationKey = context ? `${key}__${context}` : key;

    // Usage is keyed by namespace (default under "default"). Transient (unpersisted)
    // namespaces don't report usage at all (no bucket → never recorded/sent).
    const usageBucket = options?.unpersistedNamespace
      ? null
      : (store.translationsUsageByNamespace[namespace] ??= {});
    const lastUsedAt = usageBucket?.[translationKey];
    const newLastUsedAt = new Date().toISOString().split("T")[0];
    const usageChanged = !!usageBucket && lastUsedAt !== newLastUsedAt;
    if (debug) {
      console.log("i18n-keyless: lastUsedAt", lastUsedAt);
      console.log("i18n-keyless: newLastUsedAt", newLastUsedAt);
    }
    if (usageChanged && usageBucket) {
      usageBucket[translationKey] = newLastUsedAt;
      scheduleTranslationsUsageFlush();
    }

    // The language the key is already written in: the primary language, except for UGC
    // (originLanguage). When the current language is that one, the key renders as-is — no
    // store lookup and, above all, no API call. Same short-circuit as `getTranslationCore`
    // on the client, except that an explicit `forceTemporary` for that very language still
    // goes through, to keep registering the override. Usage is still recorded above, so the
    // backend doesn't prune keys that only ever render in their source language.
    const sourceLanguage = resolveOriginLanguage(options, config) ?? config.languages.primary;
    if (currentLanguage === sourceLanguage && !forceTemporaryLang) {
      if (debug) {
        console.log(`i18n-keyless: "${translationKey}" is already in "${currentLanguage}", returning it as-is`);
      }
      return applyReplace(key, replace);
    }

    // Safe navigation for potentially undefined language store
    const translation = translations[currentLanguage]?.[translationKey];

    if (debug) {
      console.log("i18n-keyless: translation", translation);
    }
    // Return existing translation if found and not forced temporary
    if (translation && !forceTemporaryLang) {
      if (debug) {
        console.log(`i18n-keyless: Translation found in store for key: "${translationKey}"`);
      }
      return applyReplace(translation, replace);
    }
    if (debug) {
      console.log(`i18n-keyless: Translation not found in store for key: "${translationKey}"`);
    }

    // Use custom handler if provided
    if (config.handleTranslate) {
      if (debug) {
        console.log(`i18n-keyless: Using handleTranslate for key: "${key}"`);
      }
      // Expect handleTranslate to manage its own errors/state updates
      const handlerResponse = await config.handleTranslate(key); // Pass only the key
      // Cache whatever the handler returned, so this key doesn't call it again on every render
      cacheTranslation(translationKey, handlerResponse?.data?.translation as Partial<Record<Lang, string>>);
      // Re-check store after custom handler, maybe it populated the translation
      const updatedTranslation = translations[currentLanguage]?.[translationKey];
      if (updatedTranslation) {
        if (debug) {
          console.log(`i18n-keyless: Translation found for key "${translationKey}" after handleTranslate`);
        }
        return applyReplace(updatedTranslation, replace);
      }
      // If still not found after custom handler, return original key
      if (debug) {
        console.warn(`i18n-keyless: Translation for key "${translationKey}" still not found after handleTranslate.`);
      }
      return key;
    }

    // No custom handler, so `config.API_KEY` is set: the guard at the top of this try block
    // already threw when both were missing, and nothing awaited in between.

    // Collapse concurrent misses of the same key: a server handling N simultaneous requests
    // would otherwise fire N identical POSTs before the first one comes back and fills the
    // store. `forceTemporary` calls are never shared (they carry a caller-specific value).
    const dedupKey = `${namespace}:${translationKey}:${options?.originLanguage ?? ""}`;
    const canDedup = !options?.forceTemporary;
    let request = canDedup ? inFlightTranslations.get(dedupKey) : undefined;
    if (!request) {
      request = fetchTranslationFromApi(key, translationKey, options);
      if (canDedup) {
        inFlightTranslations.set(dedupKey, request);
        // Both handlers, so a rejection here is never an unhandled one — callers still get
        // the rejection through their own `await request`.
        request.then(
          () => inFlightTranslations.delete(dedupKey),
          () => inFlightTranslations.delete(dedupKey)
        );
      }
    }
    const translationByLang = await request;

    // Return the fetched translation or the original key if not available for the current language
    const fetchedTranslation = translationByLang?.[currentLanguage];
    if (debug && !fetchedTranslation) {
      console.log(
        `i18n-keyless: Translation for lang "${currentLanguage}" not found in API response for key "${key}". Returning original key.`
      );
    }
    return applyReplace(fetchedTranslation || key, replace);
  } catch (error) {
    // Log the specific error during translation attempt
    console.error(`i18n-keyless: Error during awaitForTranslationFn for key "${key}":`, error);
    // Re-throw the error to ensure the promise returned by this async function rejects
    throw error;
  }
}

/**
 * **MANDATORY AWAIT / PROMISE HANDLING REQUIRED IN NODE.JS**
 *
 * Asynchronously retrieves a translation for a key, fetching from the backend if necessary.
 * In a Node.js environment, failure to `await` this function inside a `try...catch` block
 * or attach a `.catch()` handler WILL lead to an unhandled promise rejection if an error
 * occurs during translation (e.g., network error, API error). This unhandled rejection
 * is designed to cause a **FATAL ERROR** and **CRASH** the Node.js process to prevent
 * silent failures. Ensure all calls are properly handled.
 *
 * Handling it IS honoured, though: a caller with a `try/catch` or a `.catch()` gets the
 * error and keeps running, so it can fall back to its own text. Only an ignored rejection
 * is fatal. (Until 3.2.0 the reverse was true: the wrapper returned a promise it had
 * already marked as handled, so ignoring the error was silent, while a correct `try/catch`
 * crashed the process anyway.)
 *
 * **Recommendation:** Use the `@typescript-eslint/no-floating-promises` lint rule.
 *
 * @param key - The text to translate
 * @param currentLanguage - The language to translate to
 * @param options - Optional parameters for the translation process
 * @returns A Promise resolving to the translated string, or the original key when the
 *          current language has no translation for it.
 * @throws An Error naming the key, with the underlying failure as its `cause`. Ignore it
 *         and the process crashes; catch it and you own the fallback.
 */
export const awaitForTranslationOrThrow = new Proxy(
  awaitForTranslationFn, // Target the named async function
  {
    apply(target, thisArg, args) {
      // Crashing on an ignored rejection is the point of this wrapper: a server that
      // cannot translate must fail loudly, not serve the wrong text and carry on.
      //
      // Which promise we hand back is what makes that work. A `.catch()` marks the promise
      // it is attached to as HANDLED. This used to attach a logger to the promise and then
      // return that same promise, which inverted both cases: the caller's promise counted
      // as handled, so ignoring it crashed nothing, while the logger's own re-throw built a
      // second, unreachable rejection that crashed even the callers who had written a
      // correct try/catch.
      //
      // So we return the DERIVED promise instead. It is the only one the caller holds, and
      // it is the one carrying the rejection:
      //   - the caller ignores it → nothing handles it → Node crashes the process,
      //   - the caller catches it → their handler runs → their own fallback is honoured.
      //
      // The guidance travels in the error rather than in a console.error, so the crash
      // report Node prints already says what failed and what to do about it.
      return (Reflect.apply(target, thisArg, args) as Promise<string>).catch((error: unknown) => {
        const original = error instanceof Error ? error.message : String(error);
        const guided = new Error(
          `i18n-keyless: FATAL: awaitForTranslationOrThrow failed for key "${String(args[0])}". ` +
            `Wrap the call in try/catch (or attach a .catch()) to handle it yourself, ` +
            `or leave it unhandled on purpose to crash this process. ` +
            `Original error: ${original}`
        );
        // `cause` by assignment, not the second constructor argument: this package is ES2020.
        (guided as Error & { cause?: unknown }).cause = error;
        throw guided;
      });
    }
  }
);

/**
 * Same lookup and the same POST as `awaitForTranslationOrThrow`, but never rejects.
 *
 * On a failed POST (network error, a not-ok API answer, or a custom `handleTranslate`
 * throw) it resolves to the key with `replace` applied — exactly what a miss already
 * returns when the API answers with no text for the current language. "Original" here
 * means the key as written: the primary-language text, or the origin-language text for a
 * UGC call carrying `originLanguage`.
 *
 * The failure is still logged: `awaitForTranslationFn` prints a `console.error` naming the
 * key before it re-throws, so wrong-language output stays visible even though nothing
 * rejects.
 *
 * It still has to be awaited, exactly like `awaitForTranslationOrThrow`: this package POSTs
 * directly, without a queue, so fire-and-forget calls hit the API's 429 rate limit.
 *
 * @param key - The text to translate
 * @param currentLanguage - The language to translate to
 * @param options - Optional parameters for the translation process
 * @returns A Promise resolving to the translated string, or the original key (with
 *          `replace` applied) when translation failed or no translation exists.
 */
export async function awaitForTranslationOrFallbackToOriginal(
  key: string,
  currentLanguage: Lang,
  options?: TranslationOptions
): Promise<string> {
  try {
    return await awaitForTranslationFn(key, currentLanguage, options);
  } catch {
    return applyReplace(key, options?.replace);
  }
}

/**
 * @deprecated since 3.5.0: use `awaitForTranslationOrThrow` (same behaviour) or
 * `awaitForTranslationOrFallbackToOriginal`. Removed in 4.0.0.
 */
export const awaitForTranslation = awaitForTranslationOrThrow;

export function getSupportedLanguages() {
  return store.config.languages.supported;
}

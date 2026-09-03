import type {
  HandleTranslateFunction,
  I18nKeylessRequestBody,
  I18nKeylessTranslationsUsageRequestBody,
  Lang,
  TranslationOptions,
  I18nKeylessResponse,
  FetchTranslationParams,
  GetAllTranslationsFunction,
  TranslationsUsage,
  SendTranslationsUsageFunction,
} from "./types.ts";
import { DEFAULT_NAMESPACE } from "./types.ts";
import MyPQueue from "./my-pqueue.ts";
import packageJson from "./package.json" with { type: "json" };
import { api } from "./api.ts";
import { identityHeaders, whenUniqueIdIsKnown } from "./unique-id.ts";

export const queue = new MyPQueue({ concurrency: 30 });

/** The official service. `config.API_URL` replaces it for a self-hosted backend. */
export const DEFAULT_API_URL = "https://api.i18n-keyless.com";

/**
 * The key a translation is stored (and looked up) under: the source text, suffixed with
 * `__<context>` when a context is given. An empty context is the same as no context.
 */
export function storageKeyFor(key: string, context?: string): string {
  return context ? `${key}__${context}` : key;
}

/**
 * The id that deduplicates translate requests in the queue: one per (namespace, source
 * text). The context is deliberately not part of it, see docs/PROTOCOL.md.
 */
export function queueIdFor(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

/**
 * Applies the `replace` option to a text. Every placeholder is a literal (regex
 * metacharacters are escaped), all occurrences are replaced in one pass, and a placeholder
 * whose replacement is falsy (`""`) is left as is.
 */
export function applyReplace(text: string, replace?: TranslationOptions["replace"]): string {
  if (!replace) {
    return text;
  }
  // Create a regex that matches all keys to replace
  // Escape special regex characters in keys
  const pattern = Object.keys(replace)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  const regex = new RegExp(pattern, "g");

  // Replace all occurrences in a single pass.
  return text.replace(regex, (matched) => replace[matched] || matched);
}

/**
 * Resolves the effective namespace for a translation call: an explicit per-call
 * `namespace` wins, then the config-level `defaultNamespace`, then `DEFAULT_NAMESPACE`.
 */
export function resolveNamespace(
  options: TranslationOptions | undefined,
  config: FetchTranslationParams["config"]
): string {
  return options?.namespace || config.defaultNamespace || DEFAULT_NAMESPACE;
}

/**
 * Resolves the effective origin language of a key (UGC flow): the per-call `originLanguage`
 * when it exists and differs from the primary language, undefined otherwise (regular flow).
 */
export function resolveOriginLanguage(
  options: TranslationOptions | undefined,
  config: Pick<FetchTranslationParams["config"], "languages">
): Lang | undefined {
  const originLanguage = options?.originLanguage;
  if (!originLanguage || originLanguage === config.languages.primary) {
    return undefined;
  }
  return originLanguage;
}

/**
 * Scratchpad of namespaces that had at least one missing key queued for translation since
 * the last bulk fetch (mapped to whether that namespace is `unpersisted`). The queue's
 * "empty" handler (in the react store / node service) reads this to know which namespaces
 * to bulk-fetch — so we only re-download the namespaces that were actually rendered, never
 * the whole project — and whether to persist the result.
 */
const namespacesToFetchAfterTranslationFinished = new Map<string, boolean>();

/**
 * Returns the namespaces queued since the last call (with their `unpersisted` flag) and
 * clears the map.
 */
export function getNamespacesToFetchAfterTranslationFinished(): Array<{ namespace: string; unpersisted: boolean }> {
  const namespaces = Array.from(namespacesToFetchAfterTranslationFinished, ([namespace, unpersisted]) => ({
    namespace,
    unpersisted,
  }));
  namespacesToFetchAfterTranslationFinished.clear();
  return namespaces;
}

/**
 * Gets a translation for the specified key from the store
 * @param key - The translation key (text in primary language)
 * @param store - The translation store containing translations and config
 * @param options - Optional parameters for translation retrieval
 * @returns The translated text, or the key itself when there is no translation yet — or when
 * `init()` has not run: a component tree rendered before or without init (Storybook, a unit
 * test, a build step) shows the primary language instead of throwing.
 */
export function getTranslationCore(key: string, store: FetchTranslationParams, options?: TranslationOptions): string {
  const currentLanguage = store.currentLanguage;
  const config = store.config;
  const translations = store.translations;
  if (!config?.API_KEY) {
    return applyReplace(key, options?.replace);
  }
  // The language the key is already written in: the primary language, except for UGC
  // (originLanguage). When the current language is that one, the key renders as-is —
  // notably, a UGC key DOES need a lookup/translation when the current language is the
  // primary one (its primary version is an AI translation, not the key itself).
  const sourceLanguage = resolveOriginLanguage(options, config) ?? config.languages.primary;
  let translation = key;
  if (currentLanguage === sourceLanguage) {
    translation = key;
  } else {
    if (options?.forceTemporary?.[currentLanguage]) {
      translateKey(key, store, options);
    }
    translation = translations[storageKeyFor(key, options?.context)];
    if (!translation) {
      translateKey(key, store, options);
    }
  }
  // `translation` can be undefined when the current language's translation hasn't arrived
  // yet (translateKey was just queued above) — fall back to the key before interpolating.
  return applyReplace(translation || key, options?.replace);
}

const translating: Record<string, boolean> = {};
/**
 * Queues a key for translation if not already translated
 * @param key - The text to translate
 * @param store - The translation store
 * @param options - Optional parameters for the translation process
 * @throws Error if config is not initialized
 */
export function translateKey(key: string, store: FetchTranslationParams, options?: TranslationOptions) {
  const currentLanguage = store.currentLanguage;
  const config = store.config;
  const translations = store.translations;
  const uniqueId = store.uniqueId;
  if (!config.API_KEY) {
    throw new Error("i18n-keyless: config is not initialized");
  }
  const context = options?.context;
  const debug = options?.debug;
  const namespace = resolveNamespace(options, config);
  // if (key.length > 280) {
  //   console.error("i18n-keyless: Key length exceeds 280 characters limit:", key);
  //   return;
  // }
  if (!key) {
    return;
  }
  if (debug) {
    console.log("translateKey", key, context, namespace, debug);
  }
  const forceTemporaryLang = options?.forceTemporary?.[currentLanguage];
  const translation = translations[storageKeyFor(key, context)];
  if (translation && !forceTemporaryLang) {
    if (debug) {
      console.log("translation exists", `${key}__${context}`);
    }
    return;
  }
  // Remember this namespace (and whether it's unpersisted) so the queue's "empty" handler
  // bulk-fetches it (and only it) and persists the result accordingly.
  namespacesToFetchAfterTranslationFinished.set(namespace, !!options?.unpersistedNamespace);
  // Dedup/guard per namespace so the same source text can be queued independently under
  // different namespaces.
  const queueId = queueIdFor(namespace, key);
  queue.add(
    async () => {
      try {
        if (translating[queueId]) {
          return;
        } else {
          translating[queueId] = true;
        }
        if (config.handleTranslate) {
          await config.handleTranslate?.(key);
        } else {
          // Wait for the device/server id before the first request of a session can leave.
          // `POST /translate` does not echo an id back, so one sent with an empty header is
          // counted as a brand-new user that we could never reuse. See unique-id.ts.
          const uniqueIdGate = whenUniqueIdIsKnown();
          if (uniqueIdGate) {
            await uniqueIdGate;
          }
          const body: I18nKeylessRequestBody = {
            key,
            context,
            // Omit the default namespace so the wire format is unchanged for projects that
            // don't use namespaces (the backend treats "no namespace" as the default).
            namespace: namespace === DEFAULT_NAMESPACE ? undefined : namespace,
            forceTemporary: options?.forceTemporary,
            languages: config.languages.supported,
            primaryLanguage: config.languages.primary,
            originLanguage: resolveOriginLanguage(options, config),
          };
          const apiUrl = config.API_URL || DEFAULT_API_URL;
          const url = `${apiUrl}/translate`;
          if (debug) {
            console.log("fetching translation", url, body);
          }
          const response = await api
            .fetchTranslation(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.API_KEY}`,
                ...identityHeaders(uniqueId),
                Version: packageJson.version,
              },
              body: JSON.stringify(body),
            })
            .then((res) => res as ReturnType<NonNullable<HandleTranslateFunction>>);

          if (debug) {
            console.log("response", response);
          }
          if (response.message) {
            console.warn("i18n-keyless: ", response.message);
          }
        }
        translating[queueId] = false;
        return;
      } catch (error) {
        console.error("i18n-keyless: Error translating key:", error);
        translating[queueId] = false;
      }
    },
    { priority: 1, id: queueId }
  );
}

/**
 * Fetches all translations for a target language
 * @param targetLanguage - The language code to fetch translations for
 * @param store - The translation store
 * @returns Promise resolving to the translation response or void if failed
 */
/**
 * ETags of the dictionaries fetched this session, keyed by (api key, language, namespace).
 * Replayed as `If-None-Match`: an unchanged namespace answers `304` with no body — and the
 * request URL carries no per-client query, so any HTTP cache (CDN, proxy) can serve it.
 * In-memory only: after a restart the first fetch is a plain 200, exactly like today.
 */
const dictionaryEtags = new Map<string, string>();

export function etagCacheKey(apiKey: string, lang: string, namespace?: string): string {
  return `${apiKey}|${lang}|${namespace || DEFAULT_NAMESPACE}`;
}

/**
 * The URL of the per-language dictionary fetch (`GET /translate/:lang`).
 *
 * - the default namespace is omitted from the query, other namespaces travel URL-encoded,
 * - without a known ETag the delta cursor travels as `?last_refresh=<lastRefresh>`, where
 *   a `null` cursor is written literally (`last_refresh=null`),
 * - with a known ETag the cursor leaves the URL (freshness travels in `If-None-Match`), so
 *   the URL is stable for shared HTTP caches.
 */
export function buildDictionaryUrl(params: {
  apiUrl?: string;
  targetLanguage: string;
  lastRefresh: FetchTranslationParams["lastRefresh"];
  namespace?: string;
  etag?: string;
}): string {
  const { apiUrl, targetLanguage, lastRefresh, namespace, etag } = params;
  const namespaceQuery =
    namespace && namespace !== DEFAULT_NAMESPACE ? `&namespace=${encodeURIComponent(namespace)}` : "";
  const query = etag
    ? namespaceQuery
      ? `?${namespaceQuery.slice(1)}`
      : ""
    : `?last_refresh=${lastRefresh}${namespaceQuery}`;
  return `${apiUrl || DEFAULT_API_URL}/translate/${targetLanguage}${query}`;
}

export async function getAllTranslationsFromLanguage(
  targetLanguage: Lang,
  store: FetchTranslationParams,
  namespace?: string
): Promise<I18nKeylessResponse | void> {
  const config = store.config;
  const lastRefresh = store.lastRefresh;
  const uniqueId = store.uniqueId;
  if (!config.API_KEY) {
    console.error("i18n-keyless: No config found");
    return;
  }
  // if (config.languages.primary === targetLanguage) {
  //   return;
  // }

  const etagKey = etagCacheKey(config.API_KEY, targetLanguage, namespace);
  const etag = dictionaryEtags.get(etagKey);
  // Omit the default namespace from the query so existing (non-namespaced) installs keep
  // hitting the exact same URL. With an ETag in hand, freshness travels in the
  // If-None-Match header and last_refresh leaves the URL — the URL becomes stable, so
  // shared HTTP caches can hold it.
  const url = buildDictionaryUrl({ apiUrl: config.API_URL, targetLanguage, lastRefresh, namespace, etag });
  // Same gate as `translateKey`: never let a bulk fetch race hydration and go out
  // unidentified. See unique-id.ts.
  const uniqueIdGate = whenUniqueIdIsKnown();
  if (uniqueIdGate) {
    await uniqueIdGate;
  }
  try {
    const response = config.getAllTranslations
      ? await config.getAllTranslations()
      : await api
          .fetchTranslationsForOneLanguage(
            url,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.API_KEY}`,
                Version: packageJson.version,
                ...identityHeaders(uniqueId),
                ...(etag ? { "If-None-Match": etag } : {}),
              },
            }
          )
          .then((res) => res as ReturnType<NonNullable<GetAllTranslationsFunction>>);

    if (response.notModified) {
      // Nothing changed server-side: keep the stored dictionary, nothing to merge.
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
 * @param translationsUsageByNamespace - Usage keyed by namespace (default under "default")
 * @param store - The translation store
 * @returns Promise resolving to the translation response or void if failed
 */
export async function sendTranslationsUsageToI18nKeyless(
  translationsUsageByNamespace: Record<string, TranslationsUsage>,
  store: FetchTranslationParams
): Promise<{ ok: boolean; message: string } | void> {
  const config = store.config;
  if (!config.API_KEY) {
    console.error("i18n-keyless: No config found");
    return;
  }
  if (Object.keys(translationsUsageByNamespace).length === 0) {
    return;
  }
  const requestBody: I18nKeylessTranslationsUsageRequestBody = {
    primaryLanguage: config.languages.primary,
    translationsUsageByNamespace,
  };
  // This route is counted like any other. It used to carry no `unique_id` header at all,
  // so the API minted one throwaway "user" per `init()` — one per app launch, for every
  // install, forever. See unique-id.ts.
  const uniqueIdGate = whenUniqueIdIsKnown();
  if (uniqueIdGate) {
    await uniqueIdGate;
  }
  try {
    const response = config.sendTranslationsUsage
      ? // custom handlers keep their flat signature: hand them the default-namespace bucket
        await config.sendTranslationsUsage(translationsUsageByNamespace.default ?? {})
      : await api
          .postLastUsedTranslations(
            `${config.API_URL || DEFAULT_API_URL}/translate/last-used-translations`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.API_KEY}`,
                ...identityHeaders(store.uniqueId),
                Version: packageJson.version,
              },
              body: JSON.stringify(requestBody),
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

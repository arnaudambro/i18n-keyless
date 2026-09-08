import {
  type Lang,
  type I18nKeylessResponse,
  type Translations,
  type TranslationOptions,
  type LastRefresh,
  type TranslationsUsage,
  type TranslationStatus,
  queue,
  getAllTranslationsFromLanguage,
  getTranslationCore,
  getTranslationStatusCore,
  getNamespacesToFetchAfterTranslationFinished,
  DEFAULT_NAMESPACE,
  sendTranslationsUsageToI18nKeyless,
  resolveNamespace,
  resolveOriginLanguage,
  resolveMessageFormat,
  formatTranslation,
  generateUniqueId,
  isUniqueId,
  setUniqueId,
  setSdkRuntime,
  holdRequestsUntilUniqueIdIsKnown,
  bundleNamespaces,
  bundleCovers,
  loadBundleSeed,
  mergeBundleWithStorage,
  isTranslationPending,
  subscribeToPendingTranslations,
  settlePendingTranslationsAfter,
  resolveTranslationStatus as resolveTranslationStatusCore,
} from "i18n-keyless-core";
import type { I18nConfig, Listener, TranslationStoreState } from "./types.ts";
import {
  storeKeys,
  setItem,
  getItem,
  clearI18nKeylessStorage,
  validateLanguage,
  createDefaultStorage,
  translationsKeyFor,
  lastRefreshKeyFor,
  warnAboutWhitespace,
} from "./utils.ts";

/*
 * A plain store: one state object, one Set of listeners, no framework. Every wrapper that
 * has no dedicated package (Svelte, Alpine, htmx, jQuery, a legacy site) reads `getState()`
 * and reacts through `subscribe()`. The semantics mirror `i18n-keyless-react/store.ts`.
 */

function initialState(): TranslationStoreState {
  return {
    uniqueId: null,
    lastRefresh: null,
    translations: {},
    translationsByNamespace: {},
    namespaces: [],
    unpersistedNamespaces: [],
    lastRefreshByNamespace: {},
    translationsUsageByNamespace: {},
    originNamespaces: [],
    currentLanguage: "fr",
    config: {
      API_KEY: "",
      languages: {
        primary: "fr",
        supported: ["fr"],
      },
      storage: undefined,
    },
  };
}

let state: TranslationStoreState = initialState();
const listeners = new Set<Listener>();

/**
 * The language the namespace slices currently in the store are written in. After `hydrate()`
 * it is the language storage was persisted in (which `skipCurrentLanguageHydration` may
 * differ from); after a `setLanguage` it is the language switched to. The bundle seed reads
 * it to decide whether a stored slice is comparable with the bundle (docs/PROTOCOL.md 7.4).
 */
let slicesLanguage: string | null = null;

/** The current state. The object is replaced on every change, never mutated. */
export function getState(): TranslationStoreState {
  return state;
}

/** Shallow-merges `partial` into the state and notifies every listener. */
export function setState(partial: Partial<TranslationStoreState>): void {
  const previous = state;
  state = { ...state, ...partial };
  for (const listener of Array.from(listeners)) {
    listener(state, previous);
  }
}

/**
 * Same merge as `setState`, but silent: usage bookkeeping never changes what a page shows,
 * so it must not wake every bound element.
 */
function setStateSilently(partial: Partial<TranslationStoreState>): void {
  state = { ...state, ...partial };
}

/**
 * Subscribes to state changes. Returns the function that unsubscribes.
 *
 * ```ts
 * const stop = subscribe((state) => render(state.currentLanguage));
 * stop();
 * ```
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Adopts the id the server echoed back, but only when this device has none yet (an
 * install upgrading from a version that never generated an id). The id we send is the
 * authoritative one: a response must never re-identify a device.
 */
function adoptServerUniqueId(serverUniqueId: string | null | undefined, storage: I18nConfig["storage"]): void {
  if (state.uniqueId || !isUniqueId(serverUniqueId)) {
    return;
  }
  setUniqueId(serverUniqueId);
  setStateSilently({ uniqueId: serverUniqueId });
  if (storage) {
    setItem(storeKeys.uniqueId, serverUniqueId, storage);
  }
}

queue.on("empty", () => {
  // A batch of missing keys finished translating: bulk-fetch the current language, but only
  // for the namespaces that had a miss this round, each with its own delta cursor.
  if (state.config.API_KEY) {
    for (const { namespace, unpersisted } of getNamespacesToFetchAfterTranslationFinished()) {
      // Snapshot the ids pending for this namespace right now, before the fetch: only they
      // are settled once it resolves, so a key queued while it is in flight waits for the
      // next drain (docs/PROTOCOL.md 5.5).
      const settle = settlePendingTranslationsAfter(namespace);
      getAllTranslationsFromLanguage(
        state.currentLanguage,
        { ...state, lastRefresh: state.lastRefreshByNamespace[namespace] ?? null },
        namespace
      ).then((response) => {
        setTranslations(response, namespace, unpersisted);
        // Settle even on failure (`getAllTranslationsFromLanguage` catches and resolves with
        // void): a missing cell then derives to "unavailable" instead of staying "pending"
        // forever, and the next render re-queues it exactly like the existing miss loop.
        settle();
      });
    }
  }
});

function setTranslations(response: I18nKeylessResponse | void, namespace: string, unpersisted = false): void {
  if (!response?.ok) {
    return;
  }
  const config = state.config;
  if (!config.API_KEY) {
    throw new Error(`i18n-keyless: config is not initialized setting translations`);
  }
  const storage = config.storage;
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized setting translations`);
  }
  const newTranslations = response.data.translations;

  const nextTranslations = { ...state.translations, ...newTranslations };
  const prevByNamespace = state.translationsByNamespace;
  const nextNamespaceSlice = { ...(prevByNamespace[namespace] ?? {}), ...newTranslations };
  const prevNamespaces = state.namespaces;
  const isNewNamespace = !prevNamespaces.includes(namespace);
  const nextNamespaces = isNewNamespace ? [...prevNamespaces, namespace] : prevNamespaces;
  const prevUnpersisted = state.unpersistedNamespaces;
  const nextUnpersisted =
    unpersisted && !prevUnpersisted.includes(namespace) ? [...prevUnpersisted, namespace] : prevUnpersisted;

  const lastRefreshPatch = response.data.lastRefresh
    ? {
        lastRefresh: response.data.lastRefresh,
        lastRefreshByNamespace: { ...state.lastRefreshByNamespace, [namespace]: response.data.lastRefresh },
      }
    : {};

  setState({
    translations: nextTranslations,
    translationsByNamespace: { ...prevByNamespace, [namespace]: nextNamespaceSlice },
    namespaces: nextNamespaces,
    unpersistedNamespaces: nextUnpersisted,
    ...lastRefreshPatch,
  });

  adoptServerUniqueId(response.data.uniqueId, storage);

  // Unpersisted namespaces live in memory only.
  if (unpersisted) {
    return;
  }

  setItem(translationsKeyFor(namespace), JSON.stringify(nextNamespaceSlice), storage);
  if (isNewNamespace) {
    const persistedNamespaces = nextNamespaces.filter((ns) => !nextUnpersisted.includes(ns));
    setItem(storeKeys.namespaces, JSON.stringify(persistedNamespaces), storage);
  }
  if (response.data.lastRefresh) {
    setItem(lastRefreshKeyFor(namespace), response.data.lastRefresh, storage);
  }
}

function registerOriginNamespace(namespace: string, unpersisted = false): void {
  const prev = state.originNamespaces;
  if (prev.includes(namespace)) {
    return;
  }
  const next = [...prev, namespace];
  setStateSilently({ originNamespaces: next });
  if (!unpersisted) {
    const storage = state.config.storage;
    if (storage) {
      const unpersistedNamespaces = state.unpersistedNamespaces;
      setItem(
        storeKeys.originNamespaces,
        JSON.stringify(next.filter((ns) => !unpersistedNamespaces.includes(ns))),
        storage
      );
    }
  }
}

async function sendTranslationsUsage(): Promise<void> {
  const storage = state.config.storage;
  const translationsUsageByNamespace = state.translationsUsageByNamespace;
  if (Object.keys(translationsUsageByNamespace).length === 0) {
    return;
  }
  const response = await sendTranslationsUsageToI18nKeyless(translationsUsageByNamespace, state);
  if (response?.ok) {
    setStateSilently({ translationsUsageByNamespace: {} });
    if (storage) {
      setItem(storeKeys.translationsUsage, "", storage);
    }
  }
}

function setTranslationUsage(key: string, context?: string, namespace?: string, unpersistedNamespace?: boolean): void {
  // Transient namespaces report no usage: they are reclaimed by their own lifecycle.
  if (unpersistedNamespace) {
    return;
  }
  const storage = state.config.storage;
  const resolvedNamespace = namespace || state.config.defaultNamespace || DEFAULT_NAMESPACE;
  const usageKey = context ? `${key}__${context}` : key;
  const lastUpdatedAt = new Date().toISOString().split("T")[0];

  const translationsUsageByNamespace = {
    ...state.translationsUsageByNamespace,
    [resolvedNamespace]: {
      ...(state.translationsUsageByNamespace[resolvedNamespace] ?? {}),
      [usageKey]: lastUpdatedAt,
    },
  };
  setStateSilently({ translationsUsageByNamespace });
  if (storage) {
    setItem(storeKeys.translationsUsage, JSON.stringify(translationsUsageByNamespace), storage);
  }
}

async function setLanguage(lang: Lang): Promise<void> {
  const config = state.config;
  if (!config.API_KEY) {
    throw new Error(`i18n-keyless: config is not initialized setting language`);
  }
  const debug = config.debug;
  const validatedLang = validateLanguage(lang, config)!;
  if (validatedLang !== lang) {
    if (debug) console.log("i18n-keyless: language", lang, "is not supported, fallback to", validatedLang);
  } else {
    if (debug) console.log("i18n-keyless: setLanguage", lang);
  }

  // What the slices held before this switch, for the bundle precedence rule: a stored slice
  // counts only when it is in the language being switched to and newer than the bundle
  // (docs/PROTOCOL.md 7.4).
  const previousSlicesLanguage = slicesLanguage;
  const previousSlices = state.translationsByNamespace;
  const previousCursors = state.lastRefreshByNamespace;
  slicesLanguage = validatedLang;
  const bundle = config.bundle;

  // The language changed, so every delta cursor is stale: reset them all and refetch the
  // full set for each known namespace. The flat lookup map still holds the previous
  // language's values (truthy), so bound elements do not re-queue on their own.
  // A namespace the bundle lists is known too, even before its first miss.
  const knownNamespaces = Array.from(
    new Set([...(state.namespaces.length ? state.namespaces : [DEFAULT_NAMESPACE]), ...bundleNamespaces(bundle?.manifest)])
  );
  const unpersistedNamespaces = state.unpersistedNamespaces;
  const isUnpersisted = (namespace: string) => unpersistedNamespaces.includes(namespace);
  setState({ currentLanguage: validatedLang, lastRefresh: null, lastRefreshByNamespace: {} });
  if (config.storage) {
    setItem(storeKeys.currentLanguage, validatedLang, config.storage);
    for (const namespace of knownNamespaces) {
      if (!isUnpersisted(namespace)) {
        setItem(lastRefreshKeyFor(namespace), "", config.storage);
      }
    }
  }

  // A namespace the bundle covers in this language is seeded from the shipped file with the
  // bundle's cursor instead of fetched: the next fetch for it is the delta after a miss.
  const seedFromBundle = async (namespace: string): Promise<boolean> => {
    const seed = await loadBundleSeed(bundle, namespace, validatedLang);
    if (!seed) {
      return false;
    }
    const stored =
      previousSlicesLanguage && previousSlices[namespace]
        ? {
            translations: previousSlices[namespace],
            lastRefresh: previousCursors[namespace] ?? null,
            lang: previousSlicesLanguage,
          }
        : null;
    const { translations, lastRefresh } = mergeBundleWithStorage(seed, stored, validatedLang);
    if (debug) console.log("i18n-keyless: setLanguage: seeded from the bundle", namespace, validatedLang);
    setTranslations(
      { ok: true, data: { translations, lastRefresh, uniqueId: null }, error: "", message: "" },
      namespace,
      isUnpersisted(namespace)
    );
    return true;
  };
  const fetchNamespace = (namespace: string) =>
    getAllTranslationsFromLanguage(validatedLang, { ...state, lastRefresh: null }, namespace).then((response) =>
      setTranslations(response, namespace, isUnpersisted(namespace))
    );
  // A namespace not covered by the bundle is fetched synchronously, exactly as before (no
  // bundle at all takes this branch for every namespace): the request is started in the same
  // tick as the reset above, so a config change racing the in-flight response is observed by
  // `setTranslations`. Only a covered namespace takes the async seed-then-fallback path.
  const seedOrFetch = (namespace: string): Promise<void> =>
    bundleCovers(bundle?.manifest, namespace, validatedLang)
      ? seedFromBundle(namespace).then((seeded) => (seeded ? undefined : fetchNamespace(namespace)))
      : fetchNamespace(namespace);

  if (validatedLang !== config.languages.primary) {
    await Promise.all(knownNamespaces.map(seedOrFetch));
  } else {
    // The primary language still needs fetched data for namespaces holding UGC keys: their
    // primary version is an AI translation, not the key itself. A bundled primary
    // dictionary is seeded for the same reason, from the file.
    const covered = knownNamespaces.filter((namespace) => bundleCovers(bundle?.manifest, namespace, validatedLang));
    const toFetch = state.originNamespaces.filter((namespace) => !covered.includes(namespace));
    await Promise.all([...covered.map(seedFromBundle), ...toFetch.map(fetchNamespace)]);
  }
}

async function hydrate(): Promise<void> {
  const config = state.config;
  if (!config.API_KEY) {
    throw new Error(`i18n-keyless: config is not initialized hydrating`);
  }
  const storage = config.storage;
  const debug = config.debug;
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized hydrating`);
  }
  // The device id first, before any other storage read: `init()` holds every outbound
  // request until this line has run. See i18n-keyless-core/unique-id.ts.
  setSdkRuntime("browser");
  const storedUniqueId = await getItem(storeKeys.uniqueId, storage);
  const uniqueId = isUniqueId(storedUniqueId) ? storedUniqueId : generateUniqueId();
  setUniqueId(uniqueId);
  setStateSilently({ uniqueId });
  if (uniqueId !== storedUniqueId) {
    setItem(storeKeys.uniqueId, uniqueId, storage);
  }
  if (debug) console.log("i18n-keyless: _hydrate: uniqueId", uniqueId);

  const storedNamespaces = (await getItem(storeKeys.namespaces, storage, JSON.parse)) as unknown as string[] | null;
  const namespacesToLoad =
    Array.isArray(storedNamespaces) && storedNamespaces.length ? storedNamespaces : [DEFAULT_NAMESPACE];

  const translationsByNamespace: Record<string, Translations> = {};
  const lastRefreshByNamespace: Record<string, LastRefresh> = {};
  let mergedTranslations: Translations = {};
  for (const namespace of namespacesToLoad) {
    const nsTranslations = (await getItem(translationsKeyFor(namespace), storage, JSON.parse)) as Translations | null;
    if (nsTranslations) {
      translationsByNamespace[namespace] = nsTranslations;
      mergedTranslations = { ...mergedTranslations, ...nsTranslations };
    }
    const nsLastRefresh = (await getItem(lastRefreshKeyFor(namespace), storage)) as string | null;
    if (nsLastRefresh) {
      lastRefreshByNamespace[namespace] = nsLastRefresh;
    }
  }
  const loadedNamespaces = Object.keys(translationsByNamespace);
  if (loadedNamespaces.length) {
    if (debug) console.log("i18n-keyless: _hydrate", mergedTranslations);
    slicesLanguage = ((await getItem(storeKeys.currentLanguage, storage)) as string | null) || null;
    setState({
      translations: mergedTranslations,
      translationsByNamespace,
      namespaces: loadedNamespaces,
      lastRefreshByNamespace,
    });
  } else {
    if (debug) console.log("i18n-keyless: _hydrate: no translations");
  }

  const storedOriginNamespaces = (await getItem(storeKeys.originNamespaces, storage, JSON.parse)) as unknown as
    | string[]
    | null;
  if (Array.isArray(storedOriginNamespaces) && storedOriginNamespaces.length) {
    setStateSilently({ originNamespaces: storedOriginNamespaces });
  }

  const storedUsage = await getItem(storeKeys.translationsUsage, storage, JSON.parse);
  if (storedUsage && typeof storedUsage === "object") {
    // A pre-2.4.0 flat usage map has string values: discard it rather than send a malformed body.
    const values = Object.values(storedUsage as Record<string, unknown>);
    const isNamespaced = values.length === 0 || typeof values[0] === "object";
    if (isNamespaced) {
      setStateSilently({ translationsUsageByNamespace: storedUsage as unknown as Record<string, TranslationsUsage> });
    } else if (debug) {
      console.log("i18n-keyless: _hydrate: discarding legacy flat usage");
    }
  }

  const currentLanguage = await getItem(storeKeys.currentLanguage, storage);
  if (config.languages.skipCurrentLanguageHydration) {
    if (debug) console.log("i18n-keyless: _hydrate: skip current language hydration");
    setState({ currentLanguage: config.languages.initWithDefault! });
  } else if (currentLanguage) {
    if (debug) console.log("i18n-keyless: _hydrate", currentLanguage);
    setState({ currentLanguage: currentLanguage as Lang });
  } else {
    if (debug) console.log("i18n-keyless: _hydrate: no current language");
    setState({ currentLanguage: config.languages.initWithDefault! });
  }
  const lastRefresh = await getItem(storeKeys.lastRefresh, storage);
  if (lastRefresh) {
    setStateSilently({ lastRefresh: lastRefresh as string });
  }
}

/**
 * Initializes the store: validates the config, hydrates from storage, fetches the current
 * language and sends the pending usage report once. Same options as `i18n-keyless-react`.
 *
 * `storage` defaults to `window.localStorage`.
 */
export async function init(newConfig: I18nConfig): Promise<void> {
  if (!newConfig.languages) {
    throw new Error("i18n-keyless: languages is required");
  }
  if (!newConfig.languages.primary) {
    throw new Error("i18n-keyless: primary is required");
  }
  if (!newConfig.languages.supported) {
    newConfig.languages.supported = [newConfig.languages.primary];
  }
  if (!newConfig.languages.initWithDefault) {
    newConfig.languages.initWithDefault = newConfig.languages.primary;
  }
  if (!newConfig.languages.fallback) {
    newConfig.languages.fallback = newConfig.languages.primary;
  }
  if (!newConfig.languages.supported.includes(newConfig.languages.initWithDefault)) {
    newConfig.languages.supported.push(newConfig.languages.initWithDefault);
  }
  if (!newConfig.storage) {
    newConfig.storage = createDefaultStorage();
  }
  if (!newConfig.getAllTranslations || !newConfig.handleTranslate) {
    if (!newConfig.API_KEY) {
      if (!newConfig.API_URL) {
        throw new Error(
          "i18n-keyless: you didn't provide an API_KEY nor an API_URL nor a handleTranslate + getAllTranslations function. You need to provide one of them to make i18n-keyless work"
        );
      }
    }
  }
  if (newConfig.addMissingTranslations !== false) {
    newConfig.addMissingTranslations = true;
  }
  if (!newConfig.API_KEY) {
    throw new Error(`i18n-keyless: API_KEY is required`);
  }

  // Close the boot race before the config lands: the moment a config with an API_KEY is in
  // the store, a bound element can queue a request, and `init` is async. Released in
  // `finally` so a failed hydration can never deadlock the queue.
  const releaseUniqueIdGate = holdRequestsUntilUniqueIdIsKnown();
  setState({ config: newConfig });
  try {
    await hydrate();
  } finally {
    releaseUniqueIdGate();
  }
  const currentLanguage = state.currentLanguage;
  newConfig.onInit?.(currentLanguage);
  setLanguage(currentLanguage);
  sendTranslationsUsage();
}

/**
 * The translated string for `key`, resolved against the current state, with no side
 * effect: no request, no usage record. Pure. Use it inside a `subscribe` listener.
 */
export function resolveTranslation(
  key: string,
  options: TranslationOptions = {},
  current: TranslationStoreState = state
): string {
  const sourceText = key.trim();
  const storageKey = options.context ? `${sourceText}__${options.context}` : sourceText;
  const primary = current.config.languages.primary;
  const sourceLanguage =
    options.originLanguage && options.originLanguage !== primary ? options.originLanguage : primary;
  // A `count` / `select` key looks the map up in the primary language too: its primary
  // cell holds the forms the model wrote.
  const translated =
    current.currentLanguage === sourceLanguage && !resolveMessageFormat(options)
      ? sourceText
      : current.translations[storageKey] || sourceText;
  return formatTranslation(translated, current.currentLanguage, options);
}

/**
 * The status of `key`'s translation (`ready` / `pending` / `unavailable`, see
 * docs/PROTOCOL.md 5.5), resolved against the exact same inputs `resolveTranslation` uses —
 * same source language, same storage key, same map — so a caller never sees the text and the
 * status disagree. Pure, no side effect: safe inside a `subscribe` listener.
 */
export function resolveTranslationStatus(
  key: string,
  options: TranslationOptions = {},
  current: TranslationStoreState = state
): TranslationStatus {
  const sourceText = key.trim();
  const storageKey = options.context ? `${sourceText}__${options.context}` : sourceText;
  const primary = current.config.languages.primary;
  const sourceLanguage =
    options.originLanguage && options.originLanguage !== primary ? options.originLanguage : primary;
  const namespace = resolveNamespace(options, current.config);
  return resolveTranslationStatusCore({
    translation: current.translations[storageKey],
    currentLanguage: current.currentLanguage,
    primary: sourceLanguage,
    options,
    pending: isTranslationPending(namespace, sourceText),
    initialized: !!current.config.API_KEY,
  });
}

/**
 * Translates a string right now: returns the cached translation, or the source text when
 * the translation is not there yet (and queues it). Records the usage of the key.
 *
 * Plain function: it does not subscribe. To keep a piece of UI in sync, use
 * `watchTranslation` or `subscribe`.
 */
export function getTranslation(key: string, options?: TranslationOptions): string {
  const base = state;
  // Deferred: usage bookkeeping must not run inside a listener that is being notified.
  queueMicrotask(() => {
    setTranslationUsage(key, options?.context, options?.namespace, options?.unpersistedNamespace);
    if (resolveOriginLanguage(options, base.config) || resolveMessageFormat(options)) {
      registerOriginNamespace(resolveNamespace(options, base.config), !!options?.unpersistedNamespace);
    }
  });
  return getTranslationCore(key, base, options);
}

/**
 * The status of `key`'s translation right now: `getTranslationStatusCore` on the store, no
 * side effect — it never queues a translate-on-miss request, even when the status it derives
 * is `unavailable`. Plain function: it does not subscribe. To keep a piece of UI in sync with
 * a status flip, use `watchTranslation` or subscribe to `subscribeToPendingTranslations`.
 */
export function getTranslationStatus(key: string, options?: TranslationOptions): TranslationStatus {
  return getTranslationStatusCore(key.trim(), state, options);
}

/**
 * Keeps `onText` fed with the translation of `text` and its status: called once right away,
 * then on every change of the string (translation landed, language switched) OR of the
 * status alone (queued → settled, even when the text stays the source text). Translate-on-
 * miss and usage are handled here, exactly like `<I18nKeylessText>` in React. Returns the
 * function that stops watching.
 *
 * Before `init`, the source text is delivered and nothing is requested; the request leaves
 * as soon as the config lands.
 */
export function watchTranslation(
  text: string,
  options: TranslationOptions = {},
  onText: (translated: string, lang: Lang, status: TranslationStatus) => void
): () => void {
  warnAboutWhitespace(text, options.debug);
  const sourceText = text.trim();
  let requestedForLanguage: Lang | null = null;
  let lastText: string | undefined;
  let lastStatus: TranslationStatus | undefined;

  const run = () => {
    const current = state;
    const ready = !!current.config.API_KEY;
    if (ready && requestedForLanguage !== current.currentLanguage) {
      requestedForLanguage = current.currentLanguage;
      getTranslation(sourceText, options);
    }
    const resolved = ready ? resolveTranslation(sourceText, options, current) : sourceText;
    const status = resolveTranslationStatus(sourceText, options, current);
    if (resolved !== lastText || status !== lastStatus) {
      lastText = resolved;
      lastStatus = status;
      onText(resolved, current.currentLanguage, status);
    }
  };

  run();
  const stopStore = subscribe(run);
  // A status flip (queued → settled) does not necessarily change the store's translation
  // map — the settle step alone is enough to move a still-missing cell to "unavailable".
  const stopPending = subscribeToPendingTranslations(run);
  return () => {
    stopStore();
    stopPending();
  };
}

/** Switches the language: persists it, refetches every known namespace. */
export function setCurrentLanguage(lang: Lang): Promise<void> {
  state.config.onSetLanguage?.(lang);
  return setLanguage(lang);
}

export function getCurrentLanguage(): Lang {
  return state.currentLanguage;
}

export function getSupportedLanguages(): Lang[] {
  return state.config.languages.supported;
}

/** Wipes the persisted cache (the device id stays) and resets the store to its defaults. */
export async function clearI18nKeylessStorageAndStore(): Promise<void> {
  const storage = state.config.storage;
  if (storage) {
    await clearI18nKeylessStorage(storage);
  }
  slicesLanguage = null;
  setState({ ...initialState(), uniqueId: state.uniqueId });
}

/** Test helper: back to the pristine module state, listeners included. */
export function resetStore(): void {
  state = initialState();
  slicesLanguage = null;
  listeners.clear();
}

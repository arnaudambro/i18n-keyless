import { signal, untracked, type Signal } from "@angular/core";
import {
  type Lang,
  type I18nKeylessResponse,
  type Translations,
  type TranslationOptions,
  type LastRefresh,
  type TranslationsUsage,
  queue,
  getAllTranslationsFromLanguage,
  getTranslationCore,
  getNamespacesToFetchAfterTranslationFinished,
  DEFAULT_NAMESPACE,
  sendTranslationsUsageToI18nKeyless,
  resolveNamespace,
  resolveOriginLanguage,
  generateUniqueId,
  isUniqueId,
  setUniqueId,
  setSdkRuntime,
  holdRequestsUntilUniqueIdIsKnown,
} from "i18n-keyless-core";
import type { I18nConfig, TranslationStoreState } from "./types.ts";
import {
  storeKeys,
  setItem,
  getItem,
  clearI18nKeylessStorage,
  validateLanguage,
  createMemoryStorage,
  createDefaultBrowserStorage,
  translationsKeyFor,
  lastRefreshKeyFor,
} from "./utils.ts";
import { getRequestScope, recordUsedKey } from "./request-scope.ts";

/**
 * True when running without a DOM (server-side rendering). Angular's platform-server does
 * not define a global `window` (the DOM is handed out through DI), so this is the same
 * check as in the react package. On the server the lib is read-only: usage analytics are
 * neither recorded nor sent. See docs/SSR.md.
 */
export function isServerEnv(): boolean {
  return typeof window === "undefined";
}

/**
 * True once a server snapshot has been applied synchronously on the client (via
 * `hydrateFromServer` / `provideI18nKeylessServer`). When set, the async `hydrate()`
 * treats the snapshot as authoritative and does not overwrite the seeded language /
 * translations from storage. Never set in SPA mode.
 */
let serverSnapshotApplied = false;

/**
 * Where the translate-on-miss network calls run. The service sets it to
 * `NgZone.runOutsideAngular` on the server, so a missing key never delays the SSR
 * response: Angular waits for the zone to be stable before serializing, and a
 * `POST /translate` can take seconds. Identity in the browser and outside Angular.
 */
let runOutsideZone: <T>(fn: () => T) => T = (fn) => fn();

export function setZoneRunner(runner: <T>(fn: () => T) => T): void {
  runOutsideZone = runner;
}

const DEFAULT_CONFIG: I18nConfig = {
  API_KEY: "",
  languages: {
    primary: "fr",
    supported: ["fr"],
  },
  storage: undefined,
};

// The reactive slices: what templates, pipes and computeds read.
const currentLanguageSignal = signal<Lang>("fr");
const translationsSignal = signal<Translations>({});
const configSignal = signal<I18nConfig>(DEFAULT_CONFIG);
const hydratedSignal = signal(false);

// The bookkeeping slices: nothing renders from them, so they are plain values. Keeping
// them out of the signals means a usage write (on every translation lookup) never
// notifies a template.
type Bookkeeping = Omit<TranslationStoreState, "currentLanguage" | "translations" | "config" | "hydrated">;
const bookkeeping: Bookkeeping = {
  uniqueId: null,
  lastRefresh: null,
  translationsByNamespace: {},
  namespaces: [],
  unpersistedNamespaces: [],
  lastRefreshByNamespace: {},
  translationsUsageByNamespace: {},
  originNamespaces: [],
};

function getState(): TranslationStoreState {
  return untracked(() => ({
    ...bookkeeping,
    currentLanguage: currentLanguageSignal(),
    translations: translationsSignal(),
    config: configSignal(),
    hydrated: hydratedSignal(),
  }));
}

function setState(partial: Partial<TranslationStoreState>): void {
  untracked(() => {
    for (const key of Object.keys(partial) as Array<keyof TranslationStoreState>) {
      const value = partial[key];
      switch (key) {
        case "currentLanguage":
          currentLanguageSignal.set(value as Lang);
          break;
        case "translations":
          translationsSignal.set(value as Translations);
          break;
        case "config":
          configSignal.set(value as I18nConfig);
          break;
        case "hydrated":
          hydratedSignal.set(value as boolean);
          break;
        default:
          (bookkeeping as Record<string, unknown>)[key] = value;
      }
    }
  });
}

/**
 * Adopts the id the server echoed back, but only when this device has none (an install
 * upgrading from a version that never generated an id). After that, the local id wins: a
 * response must never be able to re-identify a device, because a new id is a new billed
 * "user".
 */
function adoptServerUniqueId(serverUniqueId: string | null | undefined, storage: I18nConfig["storage"]): void {
  if (isServerEnv() || getState().config?.ssr) {
    return;
  }
  if (getState().uniqueId || !isUniqueId(serverUniqueId)) {
    return;
  }
  setUniqueId(serverUniqueId);
  setState({ uniqueId: serverUniqueId });
  if (storage) {
    setItem(storeKeys.uniqueId, serverUniqueId, storage);
  }
}

function setTranslations(response: I18nKeylessResponse | void, namespace: string, unpersisted = false): void {
  if (!response?.ok) {
    return;
  }
  const state = getState();
  const config = state.config;
  if (!config.API_KEY) {
    throw new Error(`i18n-keyless: config is not initialized setting translations`);
  }
  const storage = config.storage;
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized setting translations`);
  }
  const newTranslations = response.data.translations;

  // 1. flat, merged map used for lookups
  const nextTranslations = { ...state.translations, ...newTranslations };
  // 2. per-namespace slice, persisted under this namespace's own storage key
  const prevByNamespace = state.translationsByNamespace;
  const nextNamespaceSlice = { ...(prevByNamespace[namespace] ?? {}), ...newTranslations };
  // 3. known-namespaces index
  const prevNamespaces = state.namespaces;
  const isNewNamespace = !prevNamespaces.includes(namespace);
  const nextNamespaces = isNewNamespace ? [...prevNamespaces, namespace] : prevNamespaces;
  // 4. remember which namespaces are unpersisted
  const prevUnpersisted = state.unpersistedNamespaces;
  const nextUnpersisted =
    unpersisted && !prevUnpersisted.includes(namespace) ? [...prevUnpersisted, namespace] : prevUnpersisted;

  setState({
    translations: nextTranslations,
    translationsByNamespace: { ...prevByNamespace, [namespace]: nextNamespaceSlice },
    namespaces: nextNamespaces,
    unpersistedNamespaces: nextUnpersisted,
  });

  adoptServerUniqueId(response.data.uniqueId, storage);

  // Unpersisted namespaces live in memory only: never touch storage, never enter the
  // persisted index, never store a delta cursor.
  if (unpersisted) {
    if (response.data.lastRefresh) {
      setState({
        lastRefresh: response.data.lastRefresh,
        lastRefreshByNamespace: { ...getState().lastRefreshByNamespace, [namespace]: response.data.lastRefresh },
      });
    }
    return;
  }

  setItem(translationsKeyFor(namespace), JSON.stringify(nextNamespaceSlice), storage);
  if (isNewNamespace) {
    const persistedNamespaces = nextNamespaces.filter((ns) => !nextUnpersisted.includes(ns));
    setItem(storeKeys.namespaces, JSON.stringify(persistedNamespaces), storage);
  }

  if (response.data.lastRefresh) {
    setState({
      lastRefresh: response.data.lastRefresh,
      lastRefreshByNamespace: { ...getState().lastRefreshByNamespace, [namespace]: response.data.lastRefresh },
    });
    setItem(lastRefreshKeyFor(namespace), response.data.lastRefresh, storage);
  }
}

function registerOriginNamespace(namespace: string, unpersisted = false): void {
  const state = getState();
  if (state.originNamespaces.includes(namespace)) {
    return;
  }
  const next = [...state.originNamespaces, namespace];
  setState({ originNamespaces: next });
  if (!unpersisted) {
    const storage = state.config.storage;
    if (storage) {
      setItem(
        storeKeys.originNamespaces,
        JSON.stringify(next.filter((ns) => !state.unpersistedNamespaces.includes(ns))),
        storage
      );
    }
  }
}

async function sendTranslationsUsage(): Promise<void> {
  const state = getState();
  const storage = state.config.storage;
  const translationsUsageByNamespace = state.translationsUsageByNamespace;
  if (Object.keys(translationsUsageByNamespace).length === 0) {
    return;
  }
  const response = await sendTranslationsUsageToI18nKeyless(translationsUsageByNamespace, state);
  if (response?.ok) {
    setState({ translationsUsageByNamespace: {} });
    if (storage) {
      setItem(storeKeys.translationsUsage, "", storage);
    }
  }
}

async function setTranslationUsage(
  key: string,
  context?: string,
  namespace?: string,
  unpersistedNamespace?: boolean
): Promise<void> {
  // Transient (unpersisted) namespaces don't report usage.
  if (unpersistedNamespace) {
    return;
  }
  const state = getState();
  const storage = state.config.storage;
  const resolvedNamespace = namespace || state.config.defaultNamespace || DEFAULT_NAMESPACE;
  const usageKey = context ? `${key}__${context}` : key;
  const lastUpdatedAt = new Date().toISOString().split("T")[0];

  const translationsUsageByNamespace = state.translationsUsageByNamespace;
  translationsUsageByNamespace[resolvedNamespace] = {
    ...(translationsUsageByNamespace[resolvedNamespace] ?? {}),
    [usageKey]: lastUpdatedAt,
  };
  setState({ translationsUsageByNamespace });
  if (storage) {
    setItem(storeKeys.translationsUsage, JSON.stringify(translationsUsageByNamespace), storage);
  }
}

async function setLanguage(lang: Lang): Promise<void> {
  const state = getState();
  if (!state.config.API_KEY) {
    throw new Error(`i18n-keyless: config is not initialized setting language`);
  }
  const debug = state.config.debug;
  const validatedLang = validateLanguage(lang, state.config)!;
  if (validatedLang !== lang) {
    if (debug) console.log("i18n-keyless: language", lang, "is not supported, fallback to", validatedLang);
  } else {
    if (debug) console.log("i18n-keyless: setLanguage", lang);
  }

  setState({ currentLanguage: validatedLang });
  // The language changed, so every namespace's delta cursor is stale: reset them all and
  // refetch the full set for each known namespace.
  const knownNamespaces = state.namespaces.length ? state.namespaces : [DEFAULT_NAMESPACE];
  const isUnpersisted = (namespace: string) => state.unpersistedNamespaces.includes(namespace);
  setState({ lastRefresh: null, lastRefreshByNamespace: {} });
  if (state.config.storage) {
    setItem(storeKeys.currentLanguage, validatedLang, state.config.storage);
    for (const namespace of knownNamespaces) {
      if (!isUnpersisted(namespace)) {
        setItem(lastRefreshKeyFor(namespace), "", state.config.storage);
      }
    }
  }

  // Only fetch translations when the new language is not the primary language, except for
  // namespaces holding origin-language (UGC) keys, whose primary version is fetched data.
  const fetchState = { ...getState(), lastRefresh: null };
  if (validatedLang !== state.config.languages.primary) {
    await Promise.all(
      knownNamespaces.map((namespace) =>
        getAllTranslationsFromLanguage(validatedLang, fetchState, namespace).then((response) =>
          setTranslations(response, namespace, isUnpersisted(namespace))
        )
      )
    );
  } else if (state.originNamespaces.length) {
    await Promise.all(
      state.originNamespaces.map((namespace) =>
        getAllTranslationsFromLanguage(validatedLang, fetchState, namespace).then((response) =>
          setTranslations(response, namespace, isUnpersisted(namespace))
        )
      )
    );
  }
}

queue.on("empty", () => {
  // When a batch of missing words finishes translating, bulk-fetch the current language,
  // but only for the namespaces that had a miss this round, each with its own delta cursor.
  const state = getState();
  if (state.config.API_KEY) {
    for (const { namespace, unpersisted } of getNamespacesToFetchAfterTranslationFinished()) {
      getAllTranslationsFromLanguage(
        state.currentLanguage,
        { ...state, lastRefresh: state.lastRefreshByNamespace[namespace] ?? null },
        namespace
      ).then((response) => setTranslations(response, namespace, unpersisted));
    }
  }
});

/**
 * The module-scoped store. One per process, like the zustand store of the react package:
 * the language and the translations are global data, only the *choice* of language is
 * per request under SSR (see `provideI18nKeylessServer`).
 */
export const store = {
  /** The current language (reactive). Under `provideI18nKeylessServer` prefer the service's signal. */
  currentLanguage: currentLanguageSignal.asReadonly() as Signal<Lang>,
  /** The flat translations map for the current language (reactive). */
  translations: translationsSignal.asReadonly() as Signal<Translations>,
  /** The config given to `provideI18nKeyless` / `init` (reactive). */
  config: configSignal.asReadonly() as Signal<I18nConfig>,
  /** True once storage has been read (reactive). */
  hydrated: hydratedSignal.asReadonly() as Signal<boolean>,
  getState,
  setState,
  setTranslations,
  registerOriginNamespace,
  sendTranslationsUsage,
  setTranslationUsage,
  setLanguage,
};

/**
 * Synchronously seeds the store from a server snapshot, BEFORE the first client render,
 * so `getTranslation(key)` returns the correct language on the very first render (no
 * hydration mismatch, no blink). `provideI18nKeylessServer` calls it for you in the
 * browser; call it yourself when you transfer `{ lang, translations }` by hand.
 */
export function hydrateFromServer(snapshot?: { lang?: Lang; translations?: Translations }): void {
  if (!snapshot?.lang) {
    return;
  }
  serverSnapshotApplied = true;
  const current = getState();
  setState({
    currentLanguage: snapshot.lang,
    translations: { ...current.translations, ...(snapshot.translations ?? {}) },
  });
}

async function hydrate(): Promise<void> {
  const config = getState().config;
  if (!config.API_KEY) {
    throw new Error(`i18n-keyless: config is not initialized hydrating`);
  }
  const storage = config.storage;
  const debug = config.debug;
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized hydrating`);
  }
  // The device id FIRST, before any other storage read: `init()` holds every outbound
  // request until this has run, because the API counts one new "user" for every request
  // whose `unique_id` header is empty. On a server there is no device to identify: the
  // request is labelled a server runtime and carries no id (the API counts the source IP).
  if (isServerEnv() || config.ssr) {
    setSdkRuntime("angular-server");
    if (debug) console.log("i18n-keyless: _hydrate: server runtime, no device id");
  } else {
    setSdkRuntime("angular-client");
    const storedUniqueId = await getItem(storeKeys.uniqueId, storage);
    const uniqueId = isUniqueId(storedUniqueId) ? storedUniqueId : generateUniqueId();
    setUniqueId(uniqueId);
    setState({ uniqueId });
    if (uniqueId !== storedUniqueId) {
      setItem(storeKeys.uniqueId, uniqueId, storage);
    }
    if (debug) console.log("i18n-keyless: _hydrate: uniqueId", uniqueId);
  }
  // When a server snapshot was applied, it is authoritative for the current request's
  // language: skip loading translations / currentLanguage from storage.
  if (!serverSnapshotApplied) {
    const storedNamespaces = (await getItem(storeKeys.namespaces, storage, JSON.parse)) as unknown as
      | string[]
      | null;
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
      setState({
        translations: mergedTranslations,
        translationsByNamespace,
        namespaces: loadedNamespaces,
        lastRefreshByNamespace,
      });
    } else {
      if (debug) console.log("i18n-keyless: _hydrate: no translations");
    }
  }
  const storedOriginNamespaces = (await getItem(storeKeys.originNamespaces, storage, JSON.parse)) as unknown as
    | string[]
    | null;
  if (Array.isArray(storedOriginNamespaces) && storedOriginNamespaces.length) {
    if (debug) console.log("i18n-keyless: _hydrate: origin namespaces", storedOriginNamespaces);
    setState({ originNamespaces: storedOriginNamespaces });
  }
  const storedUsage = await getItem(storeKeys.translationsUsage, storage, JSON.parse);
  if (storedUsage && typeof storedUsage === "object") {
    // Usage is keyed by namespace (values are maps). A pre-2.4.0 flat usage map has string
    // values: discard it rather than send a malformed body.
    const values = Object.values(storedUsage as Record<string, unknown>);
    const isNamespaced = values.length === 0 || typeof values[0] === "object";
    if (isNamespaced) {
      if (debug) console.log("i18n-keyless: _hydrate: translations usage", storedUsage);
      setState({ translationsUsageByNamespace: storedUsage as unknown as Record<string, TranslationsUsage> });
    } else if (debug) {
      console.log("i18n-keyless: _hydrate: discarding legacy flat usage");
    }
  } else if (debug) {
    console.log("i18n-keyless: _hydrate: no translations usage");
  }
  const currentLanguage = await getItem(storeKeys.currentLanguage, storage);
  const skipCurrentLanguageHydration = config.languages.skipCurrentLanguageHydration;
  if (serverSnapshotApplied) {
    if (debug) console.log("i18n-keyless: _hydrate: keeping server-seeded language");
  } else if (skipCurrentLanguageHydration) {
    if (debug) console.log("i18n-keyless: _hydrate: skip current language hydration");
    setState({ currentLanguage: config.languages.initWithDefault });
  } else if (currentLanguage) {
    if (debug) console.log("i18n-keyless: _hydrate", currentLanguage);
    setState({ currentLanguage: currentLanguage as Lang });
  } else {
    if (debug) console.log("i18n-keyless: _hydrate: no current language");
    setState({ currentLanguage: config.languages.initWithDefault });
  }
  const lastRefresh = await getItem(storeKeys.lastRefresh, storage);
  if (lastRefresh) {
    setState({ lastRefresh: lastRefresh as string });
  }
}

let initPromise: Promise<void> | null = null;

/**
 * Resolves once `init` has read the storage (device id, cached translations, current
 * language) and kicked off the fetch of the current language. Resolves immediately when
 * `init` has not been called.
 */
export function whenHydrated(): Promise<void> {
  return initPromise ?? Promise.resolve();
}

/**
 * Initializes the i18n configuration with defaults and validation, then hydrates the
 * store from storage. `provideI18nKeyless(config)` calls it for you at bootstrap; call it
 * directly only outside an Angular injector (a script, a test).
 */
export function init(newConfig: I18nConfig): Promise<void> {
  if (!newConfig.languages) {
    throw new Error("i18n-keyless: languages is required");
  }
  if (!newConfig.languages.primary) {
    throw new Error("i18n-keyless: primary is required");
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
    // Server: no DOM storage exists, an in-memory adapter caches translations for the
    // process lifetime. Browser: localStorage, the storage every Angular app has.
    newConfig.storage = isServerEnv() ? createMemoryStorage() : createDefaultBrowserStorage();
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

  initPromise = (async () => {
    // Close the boot race before the config lands: the moment a config with an API_KEY is
    // in the store, a rendered <i18n-t> can queue a request, and `init` is async. The gate
    // makes those requests wait for the device id instead of going out unidentified.
    const releaseUniqueIdGate = holdRequestsUntilUniqueIdIsKnown();
    setState({ config: newConfig, hydrated: false });
    try {
      await hydrate();
    } finally {
      releaseUniqueIdGate();
    }
    setState({ hydrated: true });
    const currentLanguage = getState().currentLanguage;
    newConfig.onInit?.(currentLanguage);
    // initialize the language to fetch all the translations
    setLanguage(currentLanguage);
    // Read-only on the server: don't POST usage stats on boot.
    if (!isServerEnv() && !newConfig.ssr) {
      sendTranslationsUsage();
    }
  })();
  return initPromise;
}

export function getSupportedLanguages(): I18nConfig["languages"]["supported"] {
  return getState().config.languages.supported;
}

/**
 * Translates a string outside of a template: a `title`, an `aria-label`, a string handed
 * to another library, a route title resolver.
 *
 * IMPORTANT: this is a plain function. It reads the store once and does NOT subscribe to
 * it, so a value computed with it does not update when the language changes. Inside a
 * component prefer `I18nKeylessService.translate()` (reactive) or the `t` pipe.
 */
export function getTranslation(key: string, options?: TranslationOptions): string {
  const base = getState();
  // Read-only on the server: don't record usage (a render may be a crawler hit). In the
  // browser, DEFER the usage write: this runs during change detection and a synchronous
  // store write there would be a write during render. Usage never needs to affect the
  // current render, so flush it on a microtask.
  if (!isServerEnv() && !base.config.ssr) {
    queueMicrotask(() => {
      setTranslationUsage(key, options?.context, options?.namespace, options?.unpersistedNamespace);
      if (resolveOriginLanguage(options, base.config)) {
        registerOriginNamespace(resolveNamespace(options, base.config), !!options?.unpersistedNamespace);
      }
    });
  }
  // Record the key for the per-page SSR snapshot (no-op off-server).
  recordUsedKey(options?.context ? `${key}__${options.context}` : key);
  // SSR: if a per-request scope is active (set by runWithI18nKeyless), translate against
  // that request's language/translations instead of the process-global store.
  const scope = getRequestScope();
  const state = scope ? { ...base, currentLanguage: scope.lang, translations: scope.translations } : base;
  // A miss queues a network call: keep it out of Angular's zone on the server so the
  // render never waits for it.
  return runOutsideZone(() => getTranslationCore(key, state, options));
}

export function setCurrentLanguage(lang: Lang): Promise<void> {
  getState().config.onSetLanguage?.(lang);
  return setLanguage(lang);
}

export async function clearI18nKeylessStorageAndStore(): Promise<void> {
  const storage = getState().config?.storage;
  if (storage) {
    await clearI18nKeylessStorage(storage);
  }
  setState({
    translations: {},
    translationsByNamespace: {},
    namespaces: [],
    unpersistedNamespaces: [],
    lastRefreshByNamespace: {},
    translationsUsageByNamespace: {},
    originNamespaces: [],
    currentLanguage: "fr",
    config: DEFAULT_CONFIG,
    hydrated: false,
  });
  serverSnapshotApplied = false;
  initPromise = null;
}

/** Test-only: resets the module state between test files. Not exported from the package index. */
export function resetStoreForTests(): void {
  setState({
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
    config: DEFAULT_CONFIG,
    hydrated: false,
  });
  serverSnapshotApplied = false;
  initPromise = null;
  runOutsideZone = (fn) => fn();
}

import {
  type Lang,
  type I18nKeylessResponse,
  type Translations,
  type TranslationOptions,
  type LastRefresh,
  queue,
  getAllTranslationsFromLanguage,
  getTranslationCore,
  getNamespacesToFetchAfterTranslationFinished,
  DEFAULT_NAMESPACE,
  TranslationsUsage,
  sendTranslationsUsageToI18nKeyless,
  resolveNamespace,
  resolveOriginLanguage,
  generateUniqueId,
  isUniqueId,
  setUniqueId,
  setSdkRuntime,
  holdRequestsUntilUniqueIdIsKnown,
} from "i18n-keyless-core";
import { type I18nConfig, type TranslationStore } from "./types.ts";
import { create } from "zustand";
import {
  storeKeys,
  setItem,
  getItem,
  clearI18nKeylessStorage,
  validateLanguage,
  createMemoryStorage,
  translationsKeyFor,
  lastRefreshKeyFor,
} from "./utils.ts";
import { getRequestScope, recordUsedKey } from "./request-scope.ts";

/**
 * True when running without a DOM (server-side rendering). On the server the lib is
 * read-only: usage analytics are neither recorded nor sent. Evaluated at call time so
 * the environment can be detected (and stubbed in tests) per call. See docs/SSR.md.
 */
function isServerEnv(): boolean {
  return typeof window === "undefined";
}

/**
 * True once a server snapshot has been applied synchronously on the client (via
 * `hydrateFromServer`). When set, the async `hydrate()` treats the snapshot as
 * authoritative for the current request and does not overwrite the seeded language /
 * translations from storage (which may hold a different, stale language). Never set in
 * SPA mode, so SPA hydration is unchanged. See docs/SSR.md.
 */
let serverSnapshotApplied = false;

/**
 * Adopts the id the server echoed back, but only when this device has none.
 *
 * Every request now carries an id we generated ourselves, so the server should only ever
 * echo that same value back. The guard matters for the one case where it does not: an
 * install upgrading from a version that never generated an id, whose first bulk GET is
 * answered with a server-minted one. After that, the local id wins — a response must never
 * be able to re-identify a device, because a new id is a new billed "user".
 */
function adoptServerUniqueId(serverUniqueId: string | null | undefined, storage: I18nConfig["storage"]): void {
  // Never on a server: it is counted by IP, and storing an id there would only resurrect
  // the per-boot identity we just removed.
  if (isServerEnv() || useI18nKeyless.getState().config?.ssr) {
    return;
  }
  if (useI18nKeyless.getState().uniqueId || !isUniqueId(serverUniqueId)) {
    return;
  }
  setUniqueId(serverUniqueId);
  useI18nKeyless.setState({ uniqueId: serverUniqueId });
  if (storage) {
    setItem(storeKeys.uniqueId, serverUniqueId, storage);
  }
}

queue.on("empty", () => {
  // When a batch of missing words finishes translating, bulk-fetch the current language —
  // but only for the namespaces that had a miss this round (getNamespacesToFetchAfterTranslationFinished), each
  // with its own delta cursor, so we never re-download the whole project.
  const store = useI18nKeyless.getState();
  if (store.config) {
    for (const { namespace, unpersisted } of getNamespacesToFetchAfterTranslationFinished()) {
      getAllTranslationsFromLanguage(
        store.currentLanguage,
        { ...store, lastRefresh: store.lastRefreshByNamespace[namespace] ?? null },
        namespace
      ).then((response) => store.setTranslations(response, namespace, unpersisted));
    }
  }
});

export const useI18nKeyless = create<TranslationStore>((set, get) => ({
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
  setTranslations: (response: I18nKeylessResponse | void, namespace: string, unpersisted = false) => {
    if (!response?.ok) {
      return;
    }
    const config = get().config;
    if (!config.API_KEY) {
      throw new Error(`i18n-keyless: config is not initialized setting translations`);
    }
    const storage = config.storage;
    if (!storage) {
      throw new Error(`i18n-keyless: storage is not initialized setting translations`);
    }
    const newTranslations = response.data.translations;

    // 1. flat, merged map used for lookups
    const nextTranslations = { ...get().translations, ...newTranslations };
    // 2. per-namespace slice — persisted under this namespace's own storage key
    const prevByNamespace = get().translationsByNamespace;
    const nextNamespaceSlice = { ...(prevByNamespace[namespace] ?? {}), ...newTranslations };
    // 3. known-namespaces index
    const prevNamespaces = get().namespaces;
    const isNewNamespace = !prevNamespaces.includes(namespace);
    const nextNamespaces = isNewNamespace ? [...prevNamespaces, namespace] : prevNamespaces;
    // 4. remember which namespaces are unpersisted (so setLanguage knows not to persist
    //    their refetches, and so the persisted index can exclude them)
    const prevUnpersisted = get().unpersistedNamespaces;
    const nextUnpersisted =
      unpersisted && !prevUnpersisted.includes(namespace) ? [...prevUnpersisted, namespace] : prevUnpersisted;

    set({
      translations: nextTranslations,
      translationsByNamespace: { ...prevByNamespace, [namespace]: nextNamespaceSlice },
      namespaces: nextNamespaces,
      unpersistedNamespaces: nextUnpersisted,
    });

    // The server echoes an id back on the bulk GETs. Adopt it only when this device has
    // none yet — an install upgrading from a version that never generated one. The header
    // we send is authoritative: letting a response replace a persisted id would hand the
    // same device a new identity, and the account a new billed "user", on any hiccup.
    adoptServerUniqueId(response.data.uniqueId, storage);

    // Unpersisted namespaces live in memory only: never touch storage, never enter the
    // persisted index, never store a delta cursor.
    if (unpersisted) {
      if (response.data.lastRefresh) {
        set({
          lastRefresh: response.data.lastRefresh,
          lastRefreshByNamespace: { ...get().lastRefreshByNamespace, [namespace]: response.data.lastRefresh },
        });
      }
      return;
    }

    setItem(translationsKeyFor(namespace), JSON.stringify(nextNamespaceSlice), storage);
    if (isNewNamespace) {
      // Persist only the persisted namespaces in the index.
      const persistedNamespaces = nextNamespaces.filter((ns) => !nextUnpersisted.includes(ns));
      setItem(storeKeys.namespaces, JSON.stringify(persistedNamespaces), storage);
    }

    if (response.data.lastRefresh) {
      set({
        lastRefresh: response.data.lastRefresh,
        lastRefreshByNamespace: { ...get().lastRefreshByNamespace, [namespace]: response.data.lastRefresh },
      });
      setItem(lastRefreshKeyFor(namespace), response.data.lastRefresh, storage);
    }
  },
  registerOriginNamespace: (namespace: string, unpersisted = false) => {
    const prev = get().originNamespaces;
    if (prev.includes(namespace)) {
      return;
    }
    const next = [...prev, namespace];
    set({ originNamespaces: next });
    // Unpersisted namespaces are session-only everywhere: don't persist their flag either.
    if (!unpersisted) {
      const storage = get().config.storage;
      if (storage) {
        const unpersistedNamespaces = get().unpersistedNamespaces;
        setItem(
          storeKeys.originNamespaces,
          JSON.stringify(next.filter((ns) => !unpersistedNamespaces.includes(ns))),
          storage
        );
      }
    }
  },
  sendTranslationsUsage: async () => {
    const store = get();
    if (!store.config) {
      throw new Error(`i18n-keyless: config is not initialized sending translations usage`);
    }
    const storage = store.config.storage;
    const translationsUsageByNamespace = store.translationsUsageByNamespace;
    if (Object.keys(translationsUsageByNamespace).length === 0) {
      return;
    }
    const response = await sendTranslationsUsageToI18nKeyless(translationsUsageByNamespace, store);
    if (response?.ok) {
      set({ translationsUsageByNamespace: {} });
      if (storage) {
        setItem(storeKeys.translationsUsage, "", storage);
      }
    }
  },
  setTranslationUsage: async (key: string, context?: string, namespace?: string, unpersistedNamespace?: boolean) => {
    const store = get();
    if (!store.config) {
      throw new Error(`i18n-keyless: config is not initialized setting translation usage translation`);
    }
    // Transient (unpersisted) namespaces don't report usage: they'd flood the prune signal
    // and are reclaimed by their own lifecycle, not by usage-based pruning.
    if (unpersistedNamespace) {
      return;
    }
    const storage = store.config.storage;
    const resolvedNamespace = namespace || store.config.defaultNamespace || DEFAULT_NAMESPACE;
    const usageKey = context ? `${key}__${context}` : key;
    const lastUpdatedAt = new Date().toISOString().split("T")[0];

    // Single usage map keyed by namespace; the default namespace lives under "default".
    const translationsUsageByNamespace = store.translationsUsageByNamespace;
    translationsUsageByNamespace[resolvedNamespace] = {
      ...(translationsUsageByNamespace[resolvedNamespace] ?? {}),
      [usageKey]: lastUpdatedAt,
    };
    set({ translationsUsageByNamespace });
    if (storage) {
      setItem(storeKeys.translationsUsage, JSON.stringify(translationsUsageByNamespace), storage);
    }
  },
  setLanguage: async (lang: I18nConfig["languages"]["supported"][number]) => {
    const store = get();
    if (!store.config) {
      throw new Error(`i18n-keyless: config is not initialized setting translations`);
    }
    const debug = store.config.debug;
    const validatedLang = validateLanguage(lang, store.config);
    if (validatedLang !== lang) {
      if (debug) console.log("i18n-keyless: language", lang, "is not supported, fallback to", validatedLang);
    } else {
      if (debug) console.log("i18n-keyless: setLanguage", lang);
    }

    set({ currentLanguage: validatedLang });
    // The language changed, so every namespace's delta cursor is stale: reset them all and
    // refetch the full set for each known namespace. The flat lookup map still holds the
    // previous language's values (truthy), so components won't re-queue on their own.
    const knownNamespaces = store.namespaces.length ? store.namespaces : [DEFAULT_NAMESPACE];
    const isUnpersisted = (namespace: string) => store.unpersistedNamespaces.includes(namespace);
    set({ lastRefresh: null, lastRefreshByNamespace: {} });
    if (store.config.storage) {
      setItem(storeKeys.currentLanguage, validatedLang!, store.config.storage);
      for (const namespace of knownNamespaces) {
        // Unpersisted namespaces have no stored cursor to clear.
        if (!isUnpersisted(namespace)) {
          setItem(lastRefreshKeyFor(namespace), "", store.config.storage);
        }
      }
    }

    // Only fetch translations if the new language is not the primary language.
    // Fetch the *validated* language, not `lang`: an unsupported code was replaced by the
    // fallback above, and fetching the raw value would download a language the store never
    // switched to.
    //
    // Note that nothing upgrades a legacy v2 code here. `cn` and `cz` are not BCP-47 tags,
    // they were i18n-keyless spellings, so `resolveLang` returns undefined for both and
    // `validateLanguage` simply falls back. An app carrying a stored `cn` has to map it
    // itself — see the v3 upgrade guide.
    if (validatedLang !== store.config.languages.primary) {
      await Promise.all(
        knownNamespaces.map((namespace) =>
          getAllTranslationsFromLanguage(validatedLang!, { ...store, lastRefresh: null }, namespace).then((response) =>
            store.setTranslations(response, namespace, isUnpersisted(namespace))
          )
        )
      );
    } else if (store.originNamespaces.length) {
      // The primary language needs fetched data too for namespaces containing origin-language
      // (UGC) keys: their primary version is an AI translation, not the key itself, and the
      // flat lookup map still holds the previous language's values for them.
      await Promise.all(
        store.originNamespaces.map((namespace) =>
          getAllTranslationsFromLanguage(validatedLang!, { ...store, lastRefresh: null }, namespace).then((response) =>
            store.setTranslations(response, namespace, isUnpersisted(namespace))
          )
        )
      );
    }
  },
}));

/**
 * Synchronously seeds the store from a server snapshot, BEFORE React's first client
 * render, so the imperative `getTranslation(key)` returns the correct language on the
 * very first render — no hydration mismatch, no blink. Call it in your client entry,
 * before `hydrateRoot`, with the `{ lang, translations }` the server serialized into the
 * HTML (the server can read it from `getRequestScope()`).
 *
 * The component path (`<I18nKeylessText>`) is covered by `<I18nKeylessProvider>`; the
 * function path needs this synchronous store seed because a plain function cannot read
 * React context. Server-only async `hydrate()` will not overwrite this seed. See docs/SSR.md.
 */
export function hydrateFromServer(snapshot?: { lang?: Lang; translations?: Translations }): void {
  if (!snapshot?.lang) {
    return;
  }
  serverSnapshotApplied = true;
  const current = useI18nKeyless.getState();
  useI18nKeyless.setState({
    currentLanguage: snapshot.lang,
    translations: { ...current.translations, ...(snapshot.translations ?? {}) },
  });
}

async function hydrate() {
  const config = useI18nKeyless.getState().config;
  if (!config.API_KEY) {
    throw new Error(`i18n-keyless: config is not initialized hydrating`);
  }
  const storage = config.storage;
  const debug = config.debug;
  if (!storage) {
    throw new Error(`i18n-keyless: storage is not initialized hydrating`);
  }
  // The device id, FIRST — before any other storage read.
  //
  // `init()` holds every outbound request until this line has run, because the API counts
  // one new "user" for every request whose `unique_id` header is empty, and `POST
  // /translate` never echoes an id back for us to reuse. Reading it last (as this used to)
  // left a window of several async storage round-trips during which the components that
  // had already mounted fired their misses unidentified — a fistful of throwaway users on
  // every single app launch.
  //
  // When storage holds nothing (first launch, or an install upgrading from a version that
  // let the server mint the id), we generate one here and persist it right away, so the
  // device is identified before its very first request instead of after its first
  // successful bulk GET.
  //
  // On a server there is no device to identify and no storage worth the name (the default
  // is in-memory, so an id would be new on every boot). We label the request `react-server`
  // instead and send no id: the API counts a server by its source IP. See unique-id.ts.
  if (isServerEnv() || config.ssr) {
    setSdkRuntime("react-server");
    if (debug) console.log("i18n-keyless: _hydrate: server runtime, no device id");
  } else {
    setSdkRuntime("react-client");
    const storedUniqueId = await getItem(storeKeys.uniqueId, storage);
    const uniqueId = isUniqueId(storedUniqueId) ? storedUniqueId : generateUniqueId();
    setUniqueId(uniqueId);
    useI18nKeyless.setState({ uniqueId });
    if (uniqueId !== storedUniqueId) {
      setItem(storeKeys.uniqueId, uniqueId, storage);
    }
    if (debug) console.log("i18n-keyless: _hydrate: uniqueId", uniqueId);
  }
  // When a server snapshot was applied, it is authoritative for the current request's
  // language: skip loading translations / currentLanguage from storage (storage holds a
  // single, possibly different/stale language and would clobber or mix the seed). Usage,
  // uniqueId and lastRefresh are language-independent and still hydrate normally.
  if (!serverSnapshotApplied) {
    // Load the namespaces index. Backward compat: if there's no index (pre-namespace
    // install) we still read the legacy `i18n-keyless-translations` key, treated as the
    // default namespace.
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
      useI18nKeyless.setState({
        translations: mergedTranslations,
        translationsByNamespace,
        namespaces: loadedNamespaces,
        lastRefreshByNamespace,
      });
    } else {
      if (debug) console.log("i18n-keyless: _hydrate: no translations");
    }
  }
  // Namespaces with origin-language (UGC) keys — language-independent, so loaded even when
  // a server snapshot was applied.
  const storedOriginNamespaces = (await getItem(storeKeys.originNamespaces, storage, JSON.parse)) as unknown as
    | string[]
    | null;
  if (Array.isArray(storedOriginNamespaces) && storedOriginNamespaces.length) {
    if (debug) console.log("i18n-keyless: _hydrate: origin namespaces", storedOriginNamespaces);
    useI18nKeyless.setState({ originNamespaces: storedOriginNamespaces });
  }
  const storedUsage = await getItem(storeKeys.translationsUsage, storage, JSON.parse);
  if (storedUsage && typeof storedUsage === "object") {
    // Usage is now keyed by namespace (values are maps). A pre-2.4.0 persisted flat usage
    // map has string date values — discard it rather than send a malformed body (usage is
    // ephemeral and re-collected immediately).
    const values = Object.values(storedUsage as Record<string, unknown>);
    const isNamespaced = values.length === 0 || typeof values[0] === "object";
    if (isNamespaced) {
      if (debug) console.log("i18n-keyless: _hydrate: translations usage", storedUsage);
      useI18nKeyless.setState({
        translationsUsageByNamespace: storedUsage as unknown as Record<string, TranslationsUsage>,
      });
    } else if (debug) {
      console.log("i18n-keyless: _hydrate: discarding legacy flat usage");
    }
  } else if (debug) {
    console.log("i18n-keyless: _hydrate: no translations usage");
  }
  const currentLanguage = await getItem(storeKeys.currentLanguage, storage);
  const skipCurrentLanguageHydration = config.languages.skipCurrentLanguageHydration;
  if (serverSnapshotApplied) {
    // keep the synchronously-seeded language; do not override it from storage
    if (debug) console.log("i18n-keyless: _hydrate: keeping server-seeded language");
  } else if (skipCurrentLanguageHydration) {
    if (debug) console.log("i18n-keyless: _hydrate: skip current language hydration");
    useI18nKeyless.setState({ currentLanguage: config?.languages.initWithDefault });
  } else if (currentLanguage) {
    if (debug) console.log("i18n-keyless: _hydrate", currentLanguage);
    useI18nKeyless.setState({ currentLanguage: currentLanguage as Lang });
  } else {
    if (debug) console.log("i18n-keyless: _hydrate: no current language");
    useI18nKeyless.setState({ currentLanguage: config?.languages.initWithDefault });
  }
  const lastRefresh = await getItem(storeKeys.lastRefresh, storage);
  if (lastRefresh) {
    useI18nKeyless.setState({ lastRefresh: lastRefresh as string });
  }
}

/**
 * Initializes the i18n configuration with defaults and validation
 * @param newConfig - The configuration object to initialize
 * @returns The validated and completed configuration
 * @throws Error if required configuration properties are missing
 */
export async function init(newConfig: I18nConfig) {
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
    if (typeof window === "undefined") {
      // Server-side (SSR): no DOM storage exists. Default to an in-memory adapter so
      // the server can init and cache translations for the process lifetime, instead
      // of throwing. See docs/SSR.md.
      newConfig.storage = createMemoryStorage();
    } else {
      console.log("storage is required", newConfig.storage);
      throw new Error(
        "i18n-keyless: storage is required. You can use react-native-mmkv, @react-native-async-storage/async-storage, or window.localStorage, or any storage that has a getItem, setItem, removeItem, or get, set, and remove method"
      );
    }
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
    // default to true
    newConfig.addMissingTranslations = true;
  }
  if (!newConfig.API_KEY) {
    throw new Error(`i18n-keyless: API_KEY is required`);
  }

  // Close the boot race before the config lands: the moment a config with an API_KEY is in
  // the store, a mounted <T> can queue a request, and `init` is async (device storage is).
  // The gate makes those requests wait for the device id instead of going out unidentified
  // — which the API bills as a brand-new user each time. Released in `finally` so a failed
  // hydration can never deadlock the queue. See i18n-keyless-core/unique-id.ts.
  const releaseUniqueIdGate = holdRequestsUntilUniqueIdIsKnown();
  useI18nKeyless.setState({ config: newConfig });
  try {
    await hydrate();
  } finally {
    releaseUniqueIdGate();
  }
  const currentLanguage = useI18nKeyless.getState().currentLanguage;
  newConfig.onInit?.(currentLanguage);
  // initialize the language to fetch all the translations
  useI18nKeyless.getState().setLanguage(currentLanguage);
  // Read-only on the server: don't POST usage stats on boot (crawler-triggered renders
  // and serverless per-request inits would otherwise pollute/spam the prune signal).
  if (!isServerEnv() && !newConfig.ssr) {
    useI18nKeyless.getState().sendTranslationsUsage();
  }
}

/**
 * Returns the current language, and subscribes the component to language changes.
 *
 * Call it in every component that calls {@link getTranslation}, even when you ignore the
 * return value. `getTranslation` is a plain function: it reads the store once and never
 * subscribes, so without this hook the component does not re-render on a language switch
 * and its text stays in the previous language.
 *
 * `<I18nKeylessText>` subscribes on its own and does not need this.
 */
export function useCurrentLanguage(): Lang | null {
  const currentLanguage = useI18nKeyless((state) => state.currentLanguage);
  return currentLanguage;
}

export function getSupportedLanguages(): I18nConfig["languages"]["supported"] {
  return useI18nKeyless.getState().config.languages.supported;
}

/**
 * Translates a string outside of a `<I18nKeylessText>` component — a prop, an `alt`, a
 * string handed to another library.
 *
 * IMPORTANT: this is a plain function, not a hook. It reads the store once via
 * `getState()` and does NOT subscribe to it. The calling component therefore does not
 * re-render when the language changes, and the text stays in the previous language.
 * Call {@link useCurrentLanguage} at the top of that component to subscribe it.
 */
export function getTranslation(key: string, options?: TranslationOptions): string {
  const base = useI18nKeyless.getState();
  // Read-only on the server: don't record usage (a render may be a crawler hit).
  // On the client, DEFER the usage write: getTranslation is called during component
  // render, and setTranslationUsage writes to the store synchronously, which makes React
  // log "Cannot update a component while rendering a different component". Usage analytics
  // never needs to affect the current render, so flush it on a microtask (after render).
  if (!isServerEnv() && !base.config.ssr) {
    queueMicrotask(() => {
      base.setTranslationUsage(key, options?.context, options?.namespace, options?.unpersistedNamespace);
      // Remember namespaces that hold UGC keys so switching (or booting) to the primary
      // language still fetches them (deferred for the same render-safety reason as usage).
      if (resolveOriginLanguage(options, base.config)) {
        base.registerOriginNamespace(resolveNamespace(options, base.config), !!options?.unpersistedNamespace);
      }
    });
  }
  // Record the key for the per-page SSR snapshot (no-op off-server). Pure Set.add — no
  // store write. Use the storage key (with context) so it matches the translations map.
  recordUsedKey(options?.context ? `${key}__${options.context}` : key);
  // SSR: if a per-request scope is active (set by runWithI18nKeyless), translate against
  // that request's language/translations instead of the process-global store — so
  // getTranslation, like <T>, renders the right language without leaking across
  // concurrent requests. No scope (SPA / outside a scoped render) → use the store as-is.
  const scope = getRequestScope();
  const store = scope ? { ...base, currentLanguage: scope.lang, translations: scope.translations } : base;
  return getTranslationCore(key, store, options);
}

export function setCurrentLanguage(lang: I18nConfig["languages"]["supported"][number]) {
  useI18nKeyless.getState().config.onSetLanguage?.(lang);
  return useI18nKeyless.getState().setLanguage(lang);
}

export async function clearI18nKeylessStorageAndStore() {
  // Read the storage BEFORE wiping the config: the config holds the adapter, so clearing it
  // first left nothing to clear the storage with, and the persisted keys survived.
  const storage = useI18nKeyless.getState().config?.storage;
  if (storage) {
    await clearI18nKeylessStorage(storage);
  }
  useI18nKeyless.setState({
    translations: {},
    translationsByNamespace: {},
    namespaces: [],
    unpersistedNamespaces: [],
    lastRefreshByNamespace: {},
    translationsUsageByNamespace: {},
    originNamespaces: [],
    currentLanguage: "fr",
    config: undefined,
  });
}

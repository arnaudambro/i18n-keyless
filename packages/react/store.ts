import { create } from "zustand";
import MyPQueue from "./my-pqueue";

import { I18nConfig, I18nKeylessRequestBody, Lang, Translations, TranslationStore } from "i18n-keyless-core";
import packageJson from "./package.json";

const queue = new MyPQueue({ concurrency: 5 });
queue.on("empty", () => {
  // when each word is translated, fetch the translations for the current language
  fetchAllTranslations(useI18nKeyless.getState().currentLanguage);
});

const storeKeys = {
  uniqueId: "i18n-keyless-user-id",
  lastRefresh: "i18n-keyless-last-refresh",
  translations: "i18n-keyless-translations",
  currentLanguage: "i18n-keyless-current-language",
};

async function getItem(key: string, storage: TranslationStore["storage"]) {
  if (!storage) {
    throw new Error("i18n-keyless: storage is not initialized");
  }
  if (storage.getItem) {
    return storage.getItem(key);
  } else if (storage.get) {
    return storage.get(key);
  } else if (storage.getString) {
    return storage.getString(key);
  }
  return null;
}

async function setItem(key: string, value: string, storage: TranslationStore["storage"]) {
  if (!storage) {
    throw new Error("i18n-keyless: storage is not initialized");
  }
  if (storage.setItem) {
    storage.setItem(key, value);
  } else if (storage.set) {
    storage.set(key, value);
  }
}

async function deleteItem(key: string, storage: TranslationStore["storage"]) {
  if (!storage) {
    throw new Error("i18n-keyless: storage is not initialized");
  }
  if (storage.delete) {
    storage.delete(key);
  } else if (storage.del) {
    storage.del(key);
  } else if (storage.removeItem) {
    storage.removeItem(key);
  } else if (storage.remove) {
    storage.remove(key);
  }
}

export const useI18nKeyless = create<TranslationStore>((set, get) => ({
  uniqueId: null,
  lastRefresh: null,
  translations: {},
  currentLanguage: "fr",
  config: null,
  translating: {},
  _hasHydrated: false,
  storage: null,
  _hydrate: async () => {
    const storage = get().config?.storage;
    if (!storage) {
      throw new Error("i18n-keyless: storage is not initialized");
    }
    const translations = await getItem(storeKeys.translations, storage);
    if (translations) {
      console.log("i18n-keyless: _hydrate", translations);
      set({ translations: JSON.parse(translations) });
    } else {
      console.log("i18n-keyless: _hydrate: no translations");
    }
    const currentLanguage = await getItem(storeKeys.currentLanguage, storage);
    if (currentLanguage) {
      console.log("i18n-keyless: _hydrate", currentLanguage);
      set({ currentLanguage: currentLanguage as Lang });
    } else {
      console.log("i18n-keyless: _hydrate: no current language");
      set({ currentLanguage: get().config?.languages.initWithDefault });
    }
    const uniqueId = await getItem(storeKeys.uniqueId, storage);
    if (uniqueId) {
      set({ uniqueId: uniqueId as string });
    }
    const lastRefresh = await getItem(storeKeys.lastRefresh, storage);
    if (lastRefresh) {
      set({ lastRefresh: lastRefresh as string });
    }
  },
  getTranslation: (text: string) => {
    const translation = get().translations[text];
    if (!translation) {
      get().translateKey(text);
    }
    return translation || text;
  },
  setTranslations: (newTranslations: Translations) => {
    const nextTranslations = { ...get().translations, ...newTranslations };
    set({ translations: nextTranslations });
    const storage = get().config?.storage;
    if (!storage) {
      throw new Error("i18n-keyless: storage is not initialized");
    }
    setItem(storeKeys.translations, JSON.stringify(nextTranslations), storage);
  },
  translateKey: (key: string) => {
    if (key.length > 280) {
      console.error("i18n-keyless: Key length exceeds 280 characters limit:", key);
      return;
    }

    const translation = get().translations[key];
    if (translation) {
      return;
    }
    const config = get().config;
    if (!config?.addMissingTranslations) {
      return;
    }
    queue.add(
      async () => {
        // console.log("i18n-keyless: translateKey", key);
        try {
          if (get().translating[key]) {
            return;
          } else {
            set({ translating: { ...get().translating, [key]: true } });
          }
          if (config?.handleTranslate) {
            await config?.handleTranslate?.(key);
          } else {
            const body: I18nKeylessRequestBody = {
              key,
              languages: config.languages.supported,
              primaryLanguage: config.languages.primary,
            };
            const apiUrl = config.API_URL || "https://api.i18n-keyless.com";
            const url = `${apiUrl}/translate`;
            // console.log("i18n-keyless: POST", url);
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.API_KEY}`,
                unique_id: get().uniqueId || "",
                Version: packageJson.version,
              },
              body: JSON.stringify(body),
            }).then((res) => res.json() as ReturnType<NonNullable<I18nConfig["handleTranslate"]>>);

            if (response.message) {
              console.warn("i18n-keyless: ", response.message);
            }
          }
          set({ translating: { ...get().translating, [key]: false } });
          return;
        } catch (error) {
          console.error("i18n-keyless: Error translating key:", error);
          set({ translating: { ...get().translating, [key]: false } });
        }
      },
      { priority: 1, id: key }
    );
  },
  setLanguage: async (lang: I18nConfig["languages"]["supported"][number]) => {
    console.log("i18n-keyless: setLanguage", lang);
    const config = get().config;

    const sanitizedLang = !config || !config.languages.supported.includes(lang) ? config?.languages.fallback : lang;

    set({ currentLanguage: sanitizedLang });
    if (config?.storage) {
      setItem(storeKeys.currentLanguage, sanitizedLang!, config.storage);
    }

    // Only fetch translations if the new language is not the primary language
    if (lang !== config?.languages.primary) {
      await fetchAllTranslations(lang);
    }
  },
}));

export async function init(config: I18nConfig) {
  // console.log("i18n-keyless: init", config);
  if (!config.languages) {
    throw new Error("i18n-keyless: languages is required");
  }
  if (!config.languages.primary) {
    throw new Error("i18n-keyless: primary is required");
  }
  if (!config.languages.initWithDefault) {
    config.languages.initWithDefault = config.languages.primary;
  }
  if (!config.languages.fallback) {
    config.languages.fallback = config.languages.primary;
  }
  if (!config.languages.supported.includes(config.languages.initWithDefault)) {
    config.languages.supported.push(config.languages.initWithDefault);
  }
  if (!config.storage) {
    throw new Error(
      "i18n-keyless: storage is required. You can use react-native-mmkv, @react-native-async-storage/async-storage, or window.localStorage, or any storage that has a getItem, setItem, removeItem, or get, set, and remove method"
    );
  }
  if (!config.getAllTranslations || !config.handleTranslate) {
    if (!config.API_KEY) {
      if (!config.API_URL) {
        throw new Error(
          "i18n-keyless: you didn't provide an API_KEY nor an API_URL nor a handleTranslate + getAllTranslations function. You need to provide one of them to make i18n-keyless work"
        );
      }
    }
  }
  if (config.addMissingTranslations !== false) {
    // default to true
    config.addMissingTranslations = true;
  }

  useI18nKeyless.setState({ config });
  await useI18nKeyless.getState()._hydrate();
  const currentLanguage = useI18nKeyless.getState().currentLanguage;
  config.onInit?.(currentLanguage);
}

export function useCurrentLanguage(): Lang | null {
  const currentLanguage = useI18nKeyless((state) => state.currentLanguage);
  return currentLanguage;
}

export function getTranslation(key: string) {
  return useI18nKeyless.getState().getTranslation(key);
}

export function setCurrentLanguage(lang: I18nConfig["languages"]["supported"][number]) {
  return useI18nKeyless.getState().setLanguage(lang);
}

export async function fetchAllTranslations(targetLanguage: Lang) {
  // console.log("i18n-keyless: fetchAllTranslations", targetLanguage);
  const store = useI18nKeyless.getState();
  const config = store.config;

  if (!config) {
    console.error("i18n-keyless: No config found");
    return;
  }
  if (config.languages.primary === targetLanguage) {
    // console.log("i18n-keyless: using primary language");
    return;
  }

  try {
    const response = config.getAllTranslations
      ? await config.getAllTranslations()
      : await fetch(
          `${config.API_URL || "https://api.i18n-keyless.com"}/translate/${targetLanguage}?last_refresh=${
            store.lastRefresh
          }`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.API_KEY}`,
              Version: packageJson.version,
              unique_id: store.uniqueId || "",
            },
          }
        ).then((res) => res.json() as ReturnType<NonNullable<I18nConfig["getAllTranslations"]>>);

    if (!response.ok) {
      throw new Error(response.error);
    }

    if (response.message) {
      console.warn("i18n-keyless: ", response.message);
    }

    if (response.data.uniqueId) {
      useI18nKeyless.setState({ uniqueId: response.data.uniqueId });
      setItem(storeKeys.uniqueId, response.data.uniqueId, config.storage);
    }

    if (response.data.lastRefresh) {
      useI18nKeyless.setState({ lastRefresh: response.data.lastRefresh });
      setItem(storeKeys.lastRefresh, response.data.lastRefresh, config.storage);
    }

    const data = response.data;
    useI18nKeyless.getState().setTranslations(data.translations);
  } catch (error) {
    console.error("i18n-keyless: Batch translation error:", error);
  }
}

export async function clearI18nKeylessStorage() {
  useI18nKeyless.setState({
    translations: {},
    currentLanguage: "fr",
    config: null,
  });
  const config = useI18nKeyless.getState().config;
  if (config?.storage) {
    for (const key of Object.keys(storeKeys)) {
      deleteItem(key, config.storage);
    }
  }
}

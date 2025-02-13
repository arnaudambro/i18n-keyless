/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from "zustand";
// https://github.com/sindresorhus/p-queue/issues/145#issuecomment-882068004
import PQueue from "p-queue/dist";

import { I18nConfig, I18nKeylessRequestBody, Lang, Translations, TranslationStore } from "@i18n-keyless/core";
import packageJson from "./package.json";

const queue = new PQueue({ concurrency: 5 });
queue.on("empty", () => {
  // when each word is translated, fetch the translations for the current language
  fetchAllTranslations(useI18nKeyless.getState().currentLanguage);
});

export const useI18nKeyless = create<TranslationStore>((set, get) => ({
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
    const translations = await getItem("i18n-keyless-translations", storage);
    if (translations) {
      console.log("i18n-keyless: _hydrate", translations);
      set({ translations: JSON.parse(translations) });
    } else {
      console.log("i18n-keyless: _hydrate: no translations");
    }
    const currentLanguage = await getItem("i18n-keyless-current-language", storage);
    if (currentLanguage) {
      console.log("i18n-keyless: _hydrate", currentLanguage);
      set({ currentLanguage: currentLanguage as Lang });
    } else {
      console.log("i18n-keyless: _hydrate: no current language");
      set({ currentLanguage: get().config?.languages.initWithDefault });
    }
  },
  getTranslation: (text: string) => {
    const translation = get().translations[text];
    if (!translation) {
      get().translateKey(text);
    }
    return translation || text;
  },
  setTranslations: (translations: Translations) => {
    set({ translations });
    const storage = get().config?.storage;
    if (!storage) {
      throw new Error("i18n-keyless: storage is not initialized");
    }
    setItem("i18n-keyless-translations", JSON.stringify(translations), storage);
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
            const result = await config?.handleTranslate?.(key);
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
  setLanguage: async (lang: Lang) => {
    console.log("i18n-keyless: setLanguage", lang);
    const config = get().config;

    const sanitizedLang = !config || !config.languages.supported.includes(lang) ? config?.languages.fallback : lang;

    set({ currentLanguage: sanitizedLang });
    if (config?.storage) {
      setItem("i18n-keyless-current-language", sanitizedLang!, config.storage);
    }

    // Only fetch translations if the new language is not the primary language
    if (lang !== config?.languages.primary) {
      await fetchAllTranslations(lang);
    }
  },
}));

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

export const init = async (config: I18nConfig) => {
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
  if (!config.component) {
    throw new Error("i18n-keyless: component is required");
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
};

export function useCurrentLanguage(): Lang | null {
  const currentLanguage = useI18nKeyless((state) => state.currentLanguage);
  return currentLanguage;
}

export const fetchAllTranslations = async (targetLanguage: Lang) => {
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
      : await fetch(`${config.API_URL || "https://api.i18n-keyless.com"}/translate/${targetLanguage}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.API_KEY}`,
            Version: packageJson.version,
          },
        }).then((res) => res.json() as ReturnType<NonNullable<I18nConfig["getAllTranslations"]>>);

    if (!response.ok) {
      throw new Error(response.error);
    }

    if (response.message) {
      console.warn("i18n-keyless: ", response.message);
    }

    const data = response.data;
    useI18nKeyless.getState().setTranslations(data.translations);
  } catch (error) {
    console.error("i18n-keyless: Batch translation error:", error);
  }
};

export async function clearI18nKeylessStorage() {
  useI18nKeyless.setState({
    translations: {},
    currentLanguage: "fr",
    config: null,
  });
  if ((globalThis as any).MMKV) {
    const mmkv = new (globalThis as any).MMKV();
    // just remove i18n-keyless from the storage
    mmkv.delete("i18n-keyless");
  }
  if ((globalThis as any).window && (globalThis as any).localStorage) {
    localStorage.removeItem("i18n-keyless");
  }
  if ((globalThis as any).AsyncStorage) {
    await (globalThis as any).AsyncStorage.removeItem("i18n-keyless");
  }
}

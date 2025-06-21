import {
  type Lang,
  type TranslationOptions,
  type I18nKeylessRequestBody,
  queue,
  I18nKeylessAllTranslationsResponse,
  api,
} from "i18n-keyless-core";
import { I18nKeylessNodeConfig, I18nKeylessNodeStore } from "types";
import packageJson from "./package.json";
import { I18nKeylessTranslationsUsageRequestBody, SendTranslationsUsageFunction } from "i18n-keyless-core/types";

const store: I18nKeylessNodeStore = {
  translations: {
    fr: {},
    en: {},
    es: {},
    nl: {},
    it: {},
    de: {},
    pl: {},
    pt: {},
    ro: {},
    sv: {},
    tr: {},
    ja: {},
    cn: {},
    ru: {},
    ko: {},
    ar: {},
  },
  lastUsedTranslations: {},
  uniqueId: "",
  lastRefresh: "",
  config: {
    API_KEY: "",
    languages: {
      primary: "fr",
      supported: ["fr"],
    },
  },
};

/**
 * Fetches all translations
 * @param store - The translation store
 * @returns Promise resolving to the translation response or void if failed
 */
export async function getAllTranslationsForAllLanguages(): Promise<I18nKeylessAllTranslationsResponse | void> {
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

  try {
    const response = config.getAllTranslationsForAllLanguages
      ? await config.getAllTranslationsForAllLanguages()
      : await api
          .fetchAllTranslationsForAllLanguages(
            `${config.API_URL || "https://api.i18n-keyless.com"}/translate/?last_refresh=${lastRefresh}`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.API_KEY}`,
                Version: packageJson.version,
                unique_id: uniqueId || "",
              },
            }
          )
          .then((res) => res as I18nKeylessAllTranslationsResponse);

    if (!response.ok) {
      throw new Error(response.error);
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
 * Send the last used translations to i18n-keyless API
 *
 * This is used to clean up the translations database
 * and to avoid paying for translations that are not used anymore
 *
 * It's called on lib initialization
 * and everytime the language is set
 * @param lastUsedTranslations - The last used translations
 * @param store - The translation store
 * @returns Promise resolving to the translation response or void if failed
 */
export async function sendTranslationsUsageToI18nKeyless(): Promise<{ ok: boolean; message: string } | void> {
  const config = store.config;
  if (!config.API_KEY) {
    console.error("i18n-keyless: No config found");
    return;
  }
  const lastUsedTranslations = store.lastUsedTranslations;
  if (Object.keys(lastUsedTranslations).length === 0) {
    return;
  }
  try {
    const response = config.sendTranslationsUsage
      ? await config.sendTranslationsUsage(lastUsedTranslations)
      : await api
          .postLastUsedTranslations(
            `${config.API_URL || "https://api.i18n-keyless.com"}/translate/last-used-translations`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.API_KEY}`,
                Version: packageJson.version,
              },
              body: JSON.stringify({
                primaryLanguage: config.languages.primary,
                lastUsedTranslations,
              } satisfies I18nKeylessTranslationsUsageRequestBody),
            }
          )
          .then((res) => res as ReturnType<NonNullable<SendTranslationsUsageFunction>>);

    if (response.message) {
      console.warn("i18n-keyless: ", response.message);
    }

    return response;
  } catch (error) {
    console.error("i18n-keyless: send last used translation error:", error);
  }
}

queue.on("empty", () => {
  // when each word is translated, fetch the translations for the current language
  getAllTranslationsForAllLanguages().then((res) => {
    if (res?.ok) {
      store.translations = res.data.translations;
    }
  });
  sendTranslationsUsageToI18nKeyless().then((res) => {
    if (res?.ok) {
      store.lastUsedTranslations = {};
    }
  });
});

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

  const response = await getAllTranslationsForAllLanguages();
  if (response?.ok) {
    store.translations = response.data.translations;
  }

  return newConfig;
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
  const uniqueId = store.uniqueId;
  const context = options?.context;
  const debug = options?.debug;

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

    store.lastUsedTranslations[translationKey] = new Date().toISOString().split("T")[0];
    // Safe navigation for potentially undefined language store
    const translation = translations[currentLanguage]?.[translationKey];

    // Return existing translation if found and not forced temporary
    if (translation && !forceTemporaryLang) {
      if (debug) {
        console.log(`i18n-keyless: Translation found in store for key: "${translationKey}"`);
      }
      return translation;
    }

    // Use custom handler if provided
    if (config.handleTranslate) {
      if (debug) {
        console.log(`i18n-keyless: Using handleTranslate for key: "${key}"`);
      }
      // Expect handleTranslate to manage its own errors/state updates
      await config.handleTranslate(key); // Pass only the key
      // Re-check store after custom handler, maybe it populated the translation
      const updatedTranslation = translations[currentLanguage]?.[translationKey];
      if (updatedTranslation) {
        if (debug) {
          console.log(`i18n-keyless: Translation found for key "${translationKey}" after handleTranslate`);
        }
        return updatedTranslation;
      }
      // If still not found after custom handler, return original key
      if (debug) {
        console.warn(`i18n-keyless: Translation for key "${translationKey}" still not found after handleTranslate.`);
      }
      return key;
    }

    // Proceed with API call if no custom handler
    if (!config.API_KEY) {
      // This should technically be caught earlier, but belt-and-suspenders
      throw new Error("i18n-keyless: API_KEY is required for API translation but missing.");
    }

    const body: I18nKeylessRequestBody = {
      key,
      context,
      forceTemporary: options?.forceTemporary,
      languages: config.languages.supported,
      primaryLanguage: config.languages.primary,
    };
    const apiUrl = config.API_URL || "https://api.i18n-keyless.com";
    const url = `${apiUrl}/translate`;

    if (debug) {
      console.log("i18n-keyless: Fetching translation from API:", { url, body });
    }

    // Type assertion for the expected API response structure
    type ApiResponse = { ok: boolean; data?: { translation: Record<Lang, string> }; error?: string; message?: string };

    const response = await api
      .fetchTranslation(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.API_KEY}`,
          unique_id: uniqueId || "",
          Version: packageJson.version,
        },
        body: JSON.stringify(body),
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

    // Return the fetched translation or the original key if not available for the current language
    const fetchedTranslation = response.data?.translation?.[currentLanguage];
    if (debug && !fetchedTranslation) {
      console.log(
        `i18n-keyless: Translation for lang "${currentLanguage}" not found in API response for key "${key}". Returning original key.`
      );
    }
    return fetchedTranslation || key;
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
 * **Recommendation:** Use the `@typescript-eslint/no-floating-promises` lint rule.
 *
 * @param key - The text to translate
 * @param currentLanguage - The language to translate to
 * @param options - Optional parameters for the translation process
 * @returns A Promise resolving to the translated string or the original key if not found/on error *after handling*.
 * @throws Re-throws any internal error if the promise rejection is not handled by the caller.
 */
export const awaitForTranslation = new Proxy(
  awaitForTranslationFn, // Target the named async function
  {
    apply(target, thisArg, args) {
      // Call the actual async function
      const promise = Reflect.apply(target, thisArg, args) as Promise<string>;

      // Attach a catch handler. This runs ONLY if the promise REJECTS.
      promise.catch((error) => {
        // Log a specific error message indicating an unhandled rejection.
        console.error(
          `i18n-keyless: FATAL: Unhandled rejection in awaitForTranslation! ` +
            `The promise for key "${String(args[0])}" was rejected and not caught. ` +
            `Ensure the call is wrapped in try/catch and awaited, or attach a .catch() handler. ` +
            `Original error:`,
          error
        );

        // Re-throw the error. In Node.js, an uncaught promise rejection
        // will typically terminate the process (depending on Node version and handlers).
        // This enforces handling of translation errors.
        throw error;
      });

      // Return the original promise to the caller
      return promise;
    },
  }
);

export function getSupportedLanguages() {
  return store.config.languages.supported;
}

import type { Lang } from "i18n-keyless-core";
import type { I18nConfig } from "./types.ts";
import { createMemoryStorage } from "./utils.ts";

/**
 * The `data-*` attributes the auto entry reads from its own `<script>` tag:
 *
 * | attribute                          | config                                     |
 * | ---------------------------------- | ------------------------------------------ |
 * | `data-api-key`                     | `API_KEY` (required)                       |
 * | `data-api-url`                     | `API_URL` (self-hosted backend)            |
 * | `data-primary`                     | `languages.primary` (required)             |
 * | `data-supported`                   | `languages.supported`, comma separated     |
 * | `data-lang`                        | `languages.initWithDefault`                |
 * | `data-fallback`                    | `languages.fallback`                       |
 * | `data-skip-language-hydration`     | `languages.skipCurrentLanguageHydration`   |
 * | `data-namespace`                   | `defaultNamespace`                         |
 * | `data-storage`                     | `local` (default), `session` or `memory`   |
 * | `data-debug`                       | `debug`                                    |
 */
export type AutoDataset = {
  apiKey?: string;
  apiUrl?: string;
  primary?: string;
  supported?: string;
  lang?: string;
  fallback?: string;
  skipLanguageHydration?: string;
  namespace?: string;
  storage?: string;
  debug?: string;
};

const isFlagOn = (value: string | undefined): boolean => value !== undefined && value !== "false";

const splitLangs = (value: string | undefined): Lang[] =>
  (value ?? "")
    .split(",")
    .map((lang) => lang.trim())
    .filter(Boolean) as Lang[];

/** Builds the `init` config from the dataset of the auto `<script>` tag. */
export function parseAutoConfig(dataset: AutoDataset): I18nConfig {
  const primary = dataset.primary?.trim() as Lang | undefined;
  if (!primary) {
    throw new Error("i18n-keyless: data-primary is required on the auto script tag");
  }
  if (!dataset.apiKey && !dataset.apiUrl) {
    throw new Error("i18n-keyless: data-api-key is required on the auto script tag");
  }
  const supported = splitLangs(dataset.supported);
  if (!supported.includes(primary)) {
    supported.unshift(primary);
  }
  const config: I18nConfig = {
    // A self-hosted backend still needs a bearer value: the API_KEY is required by `init`.
    API_KEY: dataset.apiKey?.trim() || "self-hosted",
    languages: {
      primary,
      supported,
    },
  };
  if (dataset.apiUrl) config.API_URL = dataset.apiUrl.trim();
  if (dataset.lang) config.languages.initWithDefault = dataset.lang.trim() as Lang;
  if (dataset.fallback) config.languages.fallback = dataset.fallback.trim() as Lang;
  if (isFlagOn(dataset.skipLanguageHydration)) config.languages.skipCurrentLanguageHydration = true;
  if (dataset.namespace) config.defaultNamespace = dataset.namespace.trim();
  if (isFlagOn(dataset.debug)) config.debug = true;
  if (dataset.storage === "session") {
    config.storage = window.sessionStorage;
  } else if (dataset.storage === "memory") {
    config.storage = createMemoryStorage();
  }
  return config;
}

/**
 * The `<script>` tag that loaded the auto entry. A module script has no
 * `document.currentScript`, so the tag is found by its `src` (compared to `moduleUrl`),
 * then by the `data-api-key` / `data-api-url` marker.
 */
export function findAutoScript(moduleUrl: string): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current) {
    return current;
  }
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"));
  const self = scripts.find((script) => {
    try {
      return new URL(script.getAttribute("src") ?? "", document.baseURI).href === moduleUrl;
    } catch {
      return false;
    }
  });
  return self ?? document.querySelector<HTMLScriptElement>("script[data-api-key], script[data-api-url]");
}

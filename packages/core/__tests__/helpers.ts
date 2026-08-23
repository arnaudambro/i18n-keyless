import type { FetchTranslationParams, Translations } from "../types.ts";

/** A minimal but valid store: primary fr, supporting en/es, with an API key set. */
export function makeStore(overrides: Partial<FetchTranslationParams> = {}): FetchTranslationParams {
  return {
    uniqueId: "unique-1",
    lastRefresh: null,
    currentLanguage: "en",
    translations: {} as Translations,
    ...overrides,
    config: {
      API_KEY: "test-key",
      languages: { primary: "fr", supported: ["fr", "en", "es"] },
      ...overrides.config,
    },
  } as FetchTranslationParams;
}

/** A fetch mock returning the standard i18n-keyless envelope. */
export function okResponse(translations: Translations, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: { translations, uniqueId: "unique-1", lastRefresh: "123", ...extra },
    error: "",
    message: "",
  };
}

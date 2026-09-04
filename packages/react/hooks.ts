"use client";

import { useSyncExternalStore } from "react";
import { type StoreApi, type UseBoundStore } from "zustand";
import { type Lang } from "i18n-keyless-core";
import { type TranslationStore } from "./types.ts";
import { boundStore } from "./store.ts";
import { useI18nKeylessContext } from "./context.ts";

// The React hooks over the store, in their own client module. `store.ts` is imported by
// Server Components (`init`, `getServerTranslations`), and Next's React Server Components
// transform refuses a React hook import in that graph. Nothing here is needed on a server
// that does not render components.

/**
 * The store hook. zustand's own hook cannot be used as-is under SSR: it hands React
 * `getInitialState()` as the *server snapshot*, and React reads that snapshot on the server
 * and on the client's hydration render — so every selector saw the store's defaults
 * (`primary: "fr"`, no API key, no translations) instead of what `init()` and
 * `hydrateFromServer()` put there. This hook subscribes the same way, but its server
 * snapshot is the real current state, which is what the server rendered with and what the
 * client seeded before hydrating. Same call shape and the same `getState` / `setState` /
 * `subscribe` as a zustand bound store. See __tests__/ssr-render.test.tsx.
 */
function useStoreSelector<T>(selector?: (state: TranslationStore) => T): T | TranslationStore {
  const read = () => (selector ? selector(boundStore.getState()) : boundStore.getState());
  return useSyncExternalStore(boundStore.subscribe, read, read);
}
export const useI18nKeyless = Object.assign(useStoreSelector, boundStore) as UseBoundStore<
  StoreApi<TranslationStore>
>;

/**
 * Returns the current language, and subscribes the component to language changes.
 *
 * Under a `<I18nKeylessProvider>` (SSR) it is the provider's language — the one the
 * subtree renders in, on the server and on the client alike. Without one, the store's.
 *
 * Call it in every component that calls {@link getTranslation}, even when you ignore the
 * return value. `getTranslation` is a plain function: it reads the store once and never
 * subscribes, so without this hook the component does not re-render on a language switch
 * and its text stays in the previous language.
 *
 * `<I18nKeylessText>` subscribes on its own and does not need this.
 */
export function useCurrentLanguage(): Lang | null {
  const scope = useI18nKeylessContext();
  const currentLanguage = useI18nKeyless((state) => state.currentLanguage);
  return scope?.lang ?? currentLanguage;
}

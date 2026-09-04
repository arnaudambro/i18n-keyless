import { defineComponent, provide, reactive, toRef, onMounted, watch, type PropType } from "vue";
import { type Lang, type Translations } from "i18n-keyless-core";
import { setState, store } from "./store.ts";
import { I18N_KEYLESS_SCOPE } from "./context.ts";

export { useI18nKeylessContext, type I18nKeylessContextValue } from "./context.ts";

export interface I18nKeylessProviderProps {
  /**
   * The language to render in for this subtree (typically from the URL: `/{lang}/...`
   * or `?lang={lang}`, or from `Accept-Language`).
   */
  lang: Lang;
  /**
   * The translations map for `lang`. On the server, produce it with
   * `getServerTranslations(lang)`; serialize it into the HTML and pass the same map
   * here on the client so the first client render matches the server output.
   */
  translations: Translations;
  /**
   * The language the source strings are written in (`languages.primary` of your config).
   * Optional where the provider renders in the same module graph as `init()`: it then
   * defaults to the store's primary. Pass it when that is not guaranteed (a framework that
   * server-renders the components in a second module graph). See docs/SSR.md.
   */
  primary?: Lang;
}

let warnedAboutMissingPrimary = false;

/** Dev-only, once per process: a provider without `primary` on a store that never ran `init()`. */
export function warnIfPrimaryIsMissing(primary: Lang | undefined): void {
  if (primary !== undefined || store.config.API_KEY || warnedAboutMissingPrimary) {
    return;
  }
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
    return;
  }
  warnedAboutMissingPrimary = true;
  console.warn(
    "i18n-keyless: the scope was provided without `primary` on a store where init() never ran, " +
      `so it falls back to the default primary "${store.config.languages.primary}". ` +
      "Pass primary (languages.primary) to <I18nKeylessProvider> or to the I18nKeyless plugin. See docs/SSR.md."
  );
}

/**
 * Per-request language provider for SSR.
 *
 * When present, `<I18nKeylessText>` ("`<T>`"), `t()` and `useTranslation()` read `lang`
 * and `translations` from this scope instead of the module-scope store. This is what
 * lets a single server render produce HTML in a chosen non-primary language without
 * leaking language state across concurrent requests (the store is a process-wide
 * singleton; the provided scope is per app instance, so per request).
 *
 * On the client it additionally seeds the global store once on mount, so store-based
 * consumers (e.g. `getTranslation`) stay consistent and there is no flash after hydration.
 *
 * In provider mode the language is controlled by the `lang` prop (drive it from the
 * URL). `setCurrentLanguage` is for non-provider SPA mode. See docs/SSR.md.
 *
 * Renders its default slot as-is (no wrapper element). The `I18nKeyless` plugin does the
 * same job app-wide, without a component in the tree.
 */
export const I18nKeylessProvider = defineComponent({
  name: "I18nKeylessProvider",
  props: {
    lang: { type: String as PropType<Lang>, required: true },
    translations: { type: Object as PropType<Translations>, required: true },
    primary: { type: String as PropType<Lang>, required: false },
  },
  setup(props, { slots }) {
    warnIfPrimaryIsMissing(props.primary);
    // `reactive` unwraps the prop refs: consumers read `scope.lang` and track the prop.
    provide(
      I18N_KEYLESS_SCOPE,
      reactive({ lang: toRef(props, "lang"), translations: toRef(props, "translations"), primary: toRef(props, "primary") })
    );

    // Client-only (`onMounted` does not run during SSR): seed the global store so reads
    // after hydration match the server-rendered, scope-driven output.
    const seed = () => {
      setState((state) => ({
        currentLanguage: props.lang,
        translations: { ...state.translations, ...props.translations },
      }));
    };
    onMounted(() => {
      seed();
      watch([() => props.lang, () => props.translations], seed);
    });

    return () => slots.default?.();
  },
});

import { computed, inject, Injectable, PLATFORM_ID, type Signal } from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import { isPlatformBrowser } from "@angular/common";
import type { Observable } from "rxjs";
import type { Lang, Translations, TranslationOptions } from "i18n-keyless-core";
import {
  store,
  init as initStore,
  whenHydrated,
  setCurrentLanguage as setCurrentLanguageStore,
  getSupportedLanguages as getSupportedLanguagesStore,
  getTranslation as getTranslationStore,
  clearI18nKeylessStorageAndStore,
} from "./store.ts";
import { I18N_KEYLESS_REQUEST_SCOPE } from "./scope.ts";
import { resolveTranslation, requestTranslation, normalizeSourceText } from "./resolve.ts";
import { getRequestScope } from "./request-scope.ts";
import type { I18nConfig } from "./types.ts";

/**
 * The Angular face of the store: signals to read, methods to act.
 *
 * Under `provideI18nKeylessServer` the signals reflect the request's scope (the language
 * the page renders in), otherwise the module-scoped store. Inject it anywhere; it is a
 * root singleton, the store behind it is module-scoped (one per process).
 */
@Injectable({ providedIn: "root" })
export class I18nKeylessService {
  private readonly scope = inject(I18N_KEYLESS_REQUEST_SCOPE, { optional: true });
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  /** Keys already requested through `translate()`, so a computed that re-runs does not re-record usage. */
  private readonly requested = new Set<string>();

  /** The language the app renders in: the request scope's under SSR, else the store's. */
  readonly currentLanguage: Signal<Lang> = computed(() => this.scope?.()?.lang ?? store.currentLanguage());
  /** The flat translations map for `currentLanguage`. */
  readonly translations: Signal<Translations> = computed(
    () => this.scope?.()?.translations ?? store.translations()
  );
  /** True once storage has been read. Before that the store renders the primary language. */
  readonly hydrated: Signal<boolean> = store.hydrated;
  /** The config given to `provideI18nKeyless`. */
  readonly config: Signal<I18nConfig> = store.config;

  /** rxjs bridge of `currentLanguage`, for code that still speaks observables. */
  readonly currentLanguage$: Observable<Lang> = toObservable(this.currentLanguage);
  /** rxjs bridge of `translations`. */
  readonly translations$: Observable<Translations> = toObservable(this.translations);

  /**
   * Initializes the store. `provideI18nKeyless(config)` calls it at bootstrap; call it
   * yourself only when you bootstrap without that provider.
   */
  init(config: I18nConfig): Promise<void> {
    return initStore(config);
  }

  /** Resolves once `init` has read the storage. */
  whenHydrated(): Promise<void> {
    return whenHydrated();
  }

  /**
   * Switches the language: persists it, then fetches its translations. Signals update as
   * soon as the fetch lands. In provider mode (`provideI18nKeylessServer`) the language is
   * the scope's `lang`: drive it from the URL instead.
   */
  setCurrentLanguage(lang: Lang): Promise<void> {
    return setCurrentLanguageStore(lang);
  }

  getSupportedLanguages(): Lang[] {
    return getSupportedLanguagesStore();
  }

  /**
   * The translated string for `text`, reactive.
   *
   * It reads signals, so call it from a template, a `computed` or an `effect` and the
   * caller re-evaluates when the translation lands or the language changes. It also
   * requests a missing translation (browser only, once per text and language).
   */
  translate(text: string, options?: TranslationOptions): string {
    const sourceText = normalizeSourceText(text);
    const { text: translated, lang } = resolveTranslation(sourceText, options, this.scope?.());
    if (this.isBrowser && sourceText) {
      const requestKey = `${lang} ${options?.namespace ?? ""} ${options?.context ?? ""} ${sourceText}`;
      if (!this.requested.has(requestKey)) {
        this.requested.add(requestKey);
        requestTranslation(sourceText, options);
      }
    }
    return translated;
  }

  /**
   * `translate()` as a signal: `readonly title = this.i18n.translation("Bonjour");` then
   * `{{ title() }}`.
   */
  translation(text: string, options?: TranslationOptions): Signal<string> {
    return computed(() => this.translate(text, options));
  }

  /**
   * One-shot, non-reactive translation for code outside change detection (a route title
   * resolver, a toast, a download file name). Reads the DI request scope first, then the
   * `runWithI18nKeyless` scope, then the store; records usage and requests a miss.
   */
  getTranslation(text: string, options?: TranslationOptions): string {
    const scope = this.scope?.();
    if (scope && !getRequestScope()) {
      const sourceText = normalizeSourceText(text);
      requestTranslation(sourceText, options);
      return resolveTranslation(sourceText, options, scope).text;
    }
    return getTranslationStore(normalizeSourceText(text), options);
  }

  /** Wipes the persisted cache and resets the store (the device id is kept). */
  clearStorageAndStore(): Promise<void> {
    return clearI18nKeylessStorageAndStore();
  }
}

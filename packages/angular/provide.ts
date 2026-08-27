import {
  APP_INITIALIZER,
  ENVIRONMENT_INITIALIZER,
  inject,
  Injector,
  makeEnvironmentProviders,
  NgZone,
  PLATFORM_ID,
  runInInjectionContext,
  signal,
  type EnvironmentProviders,
  type WritableSignal,
} from "@angular/core";
import { isPlatformBrowser, isPlatformServer } from "@angular/common";
import type { I18nConfig } from "./types.ts";
import { init, store, hydrateFromServer, setZoneRunner } from "./store.ts";
import { I18N_KEYLESS_REQUEST_SCOPE } from "./scope.ts";
import type { I18nRequestScope } from "./request-scope.ts";

/**
 * Configures i18n-keyless for the application. Same options as the `init` of
 * `i18n-keyless-react`; `storage` defaults to `window.localStorage` in the browser and to
 * an in-memory adapter on the server.
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [provideI18nKeyless({ API_KEY, languages: { primary: "fr", supported: ["fr", "en"] } })],
 * });
 * ```
 *
 * `init` runs when the injector is created, before the first component renders, and does
 * not block bootstrap: the app renders in the primary language and re-renders into the
 * current language as the cache (then the network) answers, exactly like the react package.
 * Await `I18nKeylessService.whenHydrated()` or read the `hydrated` signal when you need
 * the moment the cache has been read.
 */
export function provideI18nKeyless(config: I18nConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        const platformId = inject(PLATFORM_ID);
        const ngZone = inject(NgZone, { optional: true });
        if (isPlatformServer(platformId)) {
          // Angular SSR bootstraps one application per request but the store is module
          // scoped: hydrate it once per process, not once per request.
          const current = store.getState();
          if (current.hydrated && current.config.API_KEY === config.API_KEY) {
            return;
          }
          // Network calls (translate-on-miss) run outside the zone so a slow translation
          // API never delays the response: Angular serializes when the zone is stable.
          if (ngZone) {
            setZoneRunner((fn) => ngZone.runOutsideAngular(fn));
            ngZone.runOutsideAngular(() => startInit(config));
            return;
          }
        }
        startInit(config);
      },
    },
  ]);
}

function startInit(config: I18nConfig): void {
  // Synchronous validation errors (missing API_KEY, missing languages) throw out of the
  // initializer: an app without a working config must not boot silently untranslated.
  // Asynchronous failures (storage, network) are logged; the app keeps rendering the
  // primary language.
  init(config).catch((error) => console.error("i18n-keyless: init failed", error));
}

/**
 * A static scope, or a function returning one (possibly async) run in injection context,
 * so it can `inject(REQUEST)` and call `getServerTranslations(lang)`.
 */
export type I18nKeylessScopeInput = I18nRequestScope | (() => I18nRequestScope | Promise<I18nRequestScope>);

/**
 * Per-request language for SSR: the Angular counterpart of `<I18nKeylessProvider>`.
 *
 * When present, `<i18n-t>`, the `t` pipe and `I18nKeylessService` read `lang` and
 * `translations` from it instead of the module-scoped store, so one server render produces
 * HTML in a chosen non-primary language without leaking state across concurrent requests.
 *
 * Pass a static `{ lang, translations }`, or a factory. The factory runs in injection
 * context as an `APP_INITIALIZER`, so Angular waits for it before rendering:
 *
 * ```ts
 * provideI18nKeylessServer(async () => {
 *   const lang = langFromUrl(inject(REQUEST)?.url);
 *   return { lang, translations: await getServerTranslations(lang) };
 * })
 * ```
 *
 * In the browser it additionally seeds the store synchronously (`hydrateFromServer`), so the
 * first client render matches the server HTML and later store reads agree with it. Give the
 * client the same `{ lang, translations }` the server used (via `TransferState`, or a
 * `<script type="application/json">` you serialize yourself).
 */
export function provideI18nKeylessServer(scope: I18nKeylessScopeInput): EnvironmentProviders {
  const seed = (resolved: I18nRequestScope, platformId: object) => {
    if (isPlatformBrowser(platformId)) {
      hydrateFromServer(resolved);
    }
  };
  if (typeof scope !== "function") {
    return makeEnvironmentProviders([
      // A factory, not a value: Angular SSR creates one injector per request and the signal
      // must belong to that request, not to the module that built the config.
      { provide: I18N_KEYLESS_REQUEST_SCOPE, useFactory: () => signal<I18nRequestScope | null>(scope) },
      {
        provide: ENVIRONMENT_INITIALIZER,
        multi: true,
        useValue: () => seed(scope, inject(PLATFORM_ID)),
      },
    ]);
  }
  return makeEnvironmentProviders([
    { provide: I18N_KEYLESS_REQUEST_SCOPE, useFactory: () => signal<I18nRequestScope | null>(null) },
    {
      // APP_INITIALIZER rather than provideAppInitializer: the latter only exists from v19.
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        const injector = inject(Injector);
        const holder = inject(I18N_KEYLESS_REQUEST_SCOPE) as WritableSignal<I18nRequestScope | null>;
        const platformId = inject(PLATFORM_ID);
        return async () => {
          const resolved = await runInInjectionContext(injector, scope);
          holder.set(resolved);
          seed(resolved, platformId);
        };
      },
    },
  ]);
}

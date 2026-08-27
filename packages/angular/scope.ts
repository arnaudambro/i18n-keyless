import { InjectionToken, type Signal } from "@angular/core";
import type { I18nRequestScope } from "./request-scope.ts";

/**
 * The per-request `{ lang, translations }` scope set by `provideI18nKeylessServer`.
 *
 * `<i18n-t>`, the `t` pipe and `I18nKeylessService` read it first and fall back to the
 * module-scoped store when it is absent (SPA mode). It is a signal because the scope may
 * arrive asynchronously (an `APP_INITIALIZER` that fetches the translations).
 */
export const I18N_KEYLESS_REQUEST_SCOPE = new InjectionToken<Signal<I18nRequestScope | null>>(
  "I18N_KEYLESS_REQUEST_SCOPE"
);

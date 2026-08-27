import { inject, Pipe, PLATFORM_ID, type PipeTransform } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import type { TranslationOptions } from "i18n-keyless-core";
import { I18N_KEYLESS_REQUEST_SCOPE } from "./scope.ts";
import { resolveTranslation, requestTranslation, normalizeSourceText } from "./resolve.ts";

/**
 * `{{ 'Bonjour' | t }}` and `{{ '8 heures' | t: { context: 'duration', replace: {...} } }}`.
 *
 * Why the pipe is impure (`pure: false`): a pure pipe is memoized by Angular on its input
 * values, and `'Bonjour'` never changes. The translation does: it lands asynchronously and
 * the language switches. An impure pipe's `transform` runs on every check of its template,
 * where it reads the store signals; that read is tracked by the template's reactive
 * consumer, so a signal change marks the view for refresh even under `OnPush` and under
 * zoneless change detection. The lookup is one map read plus a string compare per check,
 * and the side effects (translate-on-miss, usage) are memoized per `(language, key)`, so
 * the impurity costs nothing measurable.
 */
@Pipe({ name: "t", standalone: true, pure: false })
export class I18nKeylessTranslatePipe implements PipeTransform {
  private readonly scope = inject(I18N_KEYLESS_REQUEST_SCOPE, { optional: true });
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private lastRequestKey = "";

  transform(text: string | null | undefined, options?: TranslationOptions): string {
    const sourceText = normalizeSourceText(String(text ?? ""));
    if (!sourceText) {
      return "";
    }
    const { text: translated, lang } = resolveTranslation(sourceText, options, this.scope?.());
    if (this.isBrowser) {
      const requestKey = `${lang} ${options?.namespace ?? ""} ${options?.context ?? ""} ${sourceText}`;
      if (requestKey !== this.lastRequestKey) {
        this.lastRequestKey = requestKey;
        requestTranslation(sourceText, options);
      }
    }
    return translated;
  }
}

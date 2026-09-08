import { inject, Pipe, PLATFORM_ID, type PipeTransform } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import type { TranslationOptions, TranslationStatus } from "i18n-keyless-core";
import { I18N_KEYLESS_REQUEST_SCOPE } from "./scope.ts";
import { resolveTranslation, requestTranslation, normalizeSourceText } from "./resolve.ts";

/**
 * `@if (('Bonjour' | tStatus) === 'pending') { ... }` — the status counterpart of the `t`
 * pipe (docs/PROTOCOL.md 5.5): `"ready" | "pending" | "unavailable"`.
 *
 * Impure for the same reason as `t` (`pure: false`): the status changes when a translation
 * lands, when the language switches, and when the pending-translations set changes, none of
 * which are new *input values* to the pipe. It shares `t`'s request-memo pattern: a miss is
 * queued once per `(language, key)`, not once per template check, so using `tStatus` alone
 * (without also rendering `t` for the same key) still drives the status from `unavailable`
 * to `pending` to `ready`.
 */
@Pipe({ name: "tStatus", standalone: true, pure: false })
export class I18nKeylessTranslationStatusPipe implements PipeTransform {
  private readonly scope = inject(I18N_KEYLESS_REQUEST_SCOPE, { optional: true });
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private lastRequestKey = "";

  transform(text: string | null | undefined, options?: TranslationOptions): TranslationStatus {
    const sourceText = normalizeSourceText(String(text ?? ""));
    if (!sourceText) {
      return "unavailable";
    }
    const resolved = resolveTranslation(sourceText, options, this.scope?.());
    if (this.isBrowser) {
      const requestKey = `${resolved.lang} ${options?.namespace ?? ""} ${options?.context ?? ""} ${sourceText}`;
      if (requestKey !== this.lastRequestKey) {
        this.lastRequestKey = requestKey;
        requestTranslation(sourceText, options);
        // Unlike `t`, the status CAN change as a direct result of the call above:
        // `requestTranslation` can mark this very (namespace, key) pending synchronously.
        // Resolve again so the value returned by THIS invocation already reflects it —
        // otherwise Angular's dev-mode recheck of the same expression calls `transform`
        // once more, sees a different value than this first call returned, and throws
        // NG0100 (ExpressionChangedAfterItHasBeenChecked).
        return resolveTranslation(sourceText, options, this.scope?.()).status;
      }
    }
    return resolved.status;
  }
}

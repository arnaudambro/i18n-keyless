import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
  untracked,
  type AfterContentChecked,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import type { Lang, TranslationOptions } from "i18n-keyless-core";
import { I18N_KEYLESS_REQUEST_SCOPE } from "./scope.ts";
import { store } from "./store.ts";
import { resolveTranslation, requestTranslation, normalizeSourceText } from "./resolve.ts";

/**
 * `<i18n-t>Bonjour</i18n-t>`: the `<I18nKeylessText>` of the react package.
 *
 * The projected text is the source, written in the primary language; the component
 * renders its translation and re-renders when it lands or when the language changes.
 * Inputs mirror the per-translation options: `context`, `replace`, `namespace`,
 * `unpersistedNamespace`, `debug`, `forceTemporary`, `originLanguage`.
 *
 * How the source is read: the projected nodes land in a hidden `<span>` (so the DOM keeps
 * the untouched source, which is what makes SSR hydration read the right key), and the
 * translation is a sibling text node. `ngAfterContentChecked` reads the span, so a projected
 * interpolation (`<i18n-t>{{ name }}</i18n-t>`) is followed too.
 *
 * Where a custom element cannot live (`<option>`, `<title>`, an attribute), use the `t`
 * pipe: `[placeholder]="'Votre email' | t"`.
 */
@Component({
  selector: "i18n-t",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span hidden aria-hidden="true" style="display: none"><ng-content /></span>{{ text() }}`,
})
export class I18nKeylessTextComponent implements AfterContentChecked {
  /** Disambiguates the translation: `<i18n-t context="duration">8 heures</i18n-t>`. Stored as `key__context`. */
  readonly context = input<TranslationOptions["context"]>();
  /** Interpolation. The keys include the delimiters: `[replace]="{ '{name}': user.name }"`. */
  readonly replace = input<TranslationOptions["replace"]>();
  /** A fetch/storage partition. Defaults to `defaultNamespace` from the config. */
  readonly namespace = input<TranslationOptions["namespace"]>();
  /** Memory-only namespace, for high-cardinality transient content. */
  readonly unpersistedNamespace = input<TranslationOptions["unpersistedNamespace"]>();
  /** Logs the resolution of this one string. */
  readonly debug = input<TranslationOptions["debug"]>();
  /** Overrides the AI translation from code, per language. */
  readonly forceTemporary = input<TranslationOptions["forceTemporary"]>();
  /** For user generated content: the language this text is written in. */
  readonly originLanguage = input<Lang | undefined>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scope = inject(I18N_KEYLESS_REQUEST_SCOPE, { optional: true });
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly source = signal("");

  private readonly options = computed<TranslationOptions>(() => ({
    context: this.context(),
    replace: this.replace(),
    namespace: this.namespace(),
    unpersistedNamespace: this.unpersistedNamespace(),
    debug: this.debug(),
    forceTemporary: this.forceTemporary(),
    originLanguage: this.originLanguage(),
  }));

  /** The rendered text: the translation when the store (or the request scope) has it, the source otherwise. */
  readonly text = computed(() => {
    const source = this.source();
    if (!source) {
      return "";
    }
    const options = this.options();
    const resolved = resolveTranslation(source, options, this.scope?.());
    if (options.debug) {
      console.log({ source, currentLanguage: resolved.lang, text: resolved.text, ...options });
    }
    return resolved.text;
  });

  constructor() {
    // Translate-on-miss: the `useEffect` of the react component. Re-runs when the source,
    // the options or the language change; never when a translation merely lands (the
    // lookup inside is untracked), and never on the server.
    effect(() => {
      const source = this.source();
      const options = this.options();
      // Read (and depend on) the language: a switch must re-request the new language's miss.
      this.scope?.()?.lang ?? store.currentLanguage();
      if (!source || !this.isBrowser) {
        return;
      }
      untracked(() => requestTranslation(source, options));
    });
  }

  ngAfterContentChecked(): void {
    // Runs after the parent's template updated the projected nodes and before this view
    // is checked, so the very first check already renders from the right source.
    const raw = this.host.nativeElement.firstChild?.textContent ?? "";
    const source = normalizeSourceText(raw, false);
    if (source !== this.source()) {
      this.source.set(source);
    }
  }
}

import { Component, inject } from "@angular/core";
import { I18nKeylessTextComponent, I18nKeylessService, type Lang } from "i18n-keyless-angular";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";

// Cycles through the supported languages. `setCurrentLanguage` updates the store and
// fetches the new language's translations; the `currentLanguage` signal re-renders the view.
@Component({
  selector: "app-language-switcher",
  standalone: true,
  imports: [I18nKeylessTextComponent],
  template: `
    <button class="switch" (click)="next()">
      <i18n-t>Changer de langue</i18n-t> ({{ i18n.currentLanguage() }})
    </button>
  `,
})
export class LanguageSwitcherComponent {
  readonly i18n = inject(I18nKeylessService);

  next() {
    const index = SUPPORTED_LANGUAGES.indexOf(this.i18n.currentLanguage() as SupportedLanguage);
    const nextLanguage = SUPPORTED_LANGUAGES[(index + 1) % SUPPORTED_LANGUAGES.length];
    this.i18n.setCurrentLanguage(nextLanguage as Lang);
  }
}

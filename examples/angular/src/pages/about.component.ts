import { Component, inject } from "@angular/core";
import { I18nKeylessTextComponent, I18nKeylessTranslatePipe, I18nKeylessService } from "i18n-keyless-angular";

// Page B: DIFFERENT strings than Home, demonstrating the `t` pipe (for text you build
// dynamically, attributes, etc.), the service's reactive `translation()` signal and the
// `context` option. Navigating Home <-> About keeps everything translated.
@Component({
  selector: "app-about",
  standalone: true,
  imports: [I18nKeylessTextComponent, I18nKeylessTranslatePipe],
  template: `
    <section class="card">
      <h2>
        <i18n-t>À propos de cette démo</i18n-t>
      </h2>
      <p>{{ intro() }}</p>
      <p class="muted">
        {{ "Cette page utilise des chaînes différentes de la page d'accueil : en SSR, chaque page ne sérialise que ses propres clés." | t }}
      </p>
      <!-- `context` disambiguates an identical source string that translates differently:
           "8 heures" -> "8 AM" (a time) vs "8 hours" (a duration). -->
      <p class="context-line">
        <code>8 heures</code> (heure) → <strong>{{ "8 heures" | t: { context: "heure" } }}</strong>
        &nbsp;·&nbsp;
        <code>8 heures</code> (durée) → <strong>{{ "8 heures" | t: { context: "durée" } }}</strong>
      </p>
    </section>
  `,
})
export class AboutComponent {
  private readonly i18n = inject(I18nKeylessService);
  // A signal: re-evaluates when the translation lands or the language changes.
  readonly intro = this.i18n.translation(
    "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>."
  );
}

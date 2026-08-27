import { Component, computed, inject } from "@angular/core";
import { I18nKeylessTextComponent, I18nKeylessService } from "i18n-keyless-angular";

// Page A: text written directly in the primary language (French) and rendered through the
// <i18n-t> component. Note `replace` to inject a runtime value.
@Component({
  selector: "app-home",
  standalone: true,
  imports: [I18nKeylessTextComponent],
  template: `
    <section class="card">
      <p class="lang-line">
        <i18n-t [replace]="langReplace()">{{ langLine }}</i18n-t>
      </p>
      <p>
        <i18n-t>
          Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le
          souhaitez.
        </i18n-t>
      </p>
      <p class="muted">
        <i18n-t>
          Attention, vous traduisez en 15 langues, cela prend plus de temps que 2 ou 5, qui sont des
          cas d'usage plus courants.
        </i18n-t>
      </p>
      <p class="muted">
        <i18n-t>
          Attention aussi : les traductions n'ont lieu qu'une seule fois, comme une recherche Google :
          elles sont ensuite gardées en cache pour un chargement instantané.
        </i18n-t>
      </p>
    </section>
  `,
})
export class HomeComponent {
  private readonly i18n = inject(I18nKeylessService);
  // Kept out of the template: a `{{` inside a template string would be read as an
  // interpolation. The `replace` keys include the delimiters.
  readonly langLine = "Langue : {{current_lang}}";
  readonly langReplace = computed(() => ({ "{{current_lang}}": this.i18n.currentLanguage() }));
}

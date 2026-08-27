import { Component, signal } from "@angular/core";
import { I18nKeylessTextComponent } from "i18n-keyless-angular";
import { LanguageSwitcherComponent } from "./components/language-switcher.component";
import { HomeComponent } from "./pages/home.component";
import { AboutComponent } from "./pages/about.component";

type Page = "home" | "about";

// A tiny two-view "router" (no router dependency) so the demo stays focused on
// i18n-keyless. Switching views is client-side navigation: translations persist across it.
@Component({
  selector: "app-root",
  standalone: true,
  imports: [I18nKeylessTextComponent, LanguageSwitcherComponent, HomeComponent, AboutComponent],
  template: `
    <main class="app">
      <header>
        <h1>i18n-keyless · Angular</h1>
        <nav>
          <button [class.active]="page() === 'home'" (click)="page.set('home')">
            <i18n-t>Accueil</i18n-t>
          </button>
          <button [class.active]="page() === 'about'" (click)="page.set('about')">
            <i18n-t>À propos</i18n-t>
          </button>
          <app-language-switcher />
        </nav>
      </header>
      @if (page() === "home") {
        <app-home />
      } @else {
        <app-about />
      }
    </main>
  `,
})
export class AppComponent {
  readonly page = signal<Page>("home");
}

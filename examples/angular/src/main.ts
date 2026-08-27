import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app.component";
import { provideAppI18n } from "./i18n";

bootstrapApplication(AppComponent, {
  providers: [provideAppI18n()],
}).catch((error) => console.error(error));

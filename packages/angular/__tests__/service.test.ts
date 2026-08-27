import { Component, computed, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { firstValueFrom } from "rxjs";
import { I18nKeylessService } from "../service.ts";
import { provideI18nKeyless } from "../provide.ts";
import { store, setCurrentLanguage } from "../store.ts";
import { baseConfig, mockFetch, resetAll, makeStorage } from "./helpers.ts";

@Component({
  standalone: true,
  template: `<h1>{{ greeting() }}</h1><p>{{ title() }}</p>`,
})
class HostComponent {
  private readonly i18n = inject(I18nKeylessService);
  readonly greeting = computed(() => this.i18n.translate("Bonjour"));
  readonly title = this.i18n.translation("8 heures", { context: "durée" });
}

beforeEach(() => {
  resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("provideI18nKeyless", () => {
  it("initializes the store when the injector is created, without blocking", async () => {
    mockFetch();
    const storage = makeStorage({ "i18n-keyless-current-language": "en" });
    TestBed.configureTestingModule({ providers: [provideI18nKeyless(baseConfig({ storage }))] });
    const service = TestBed.inject(I18nKeylessService);
    expect(service.hydrated()).toBe(false);
    await service.whenHydrated();
    expect(service.hydrated()).toBe(true);
    expect(service.currentLanguage()).toBe("en");
    await vi.waitFor(() => expect(service.translations().Bonjour).toBe("Hello"));
  });
});

describe("I18nKeylessService", () => {
  it("translate() is reactive inside a computed, translation() is a signal", async () => {
    mockFetch();
    TestBed.configureTestingModule({ providers: [provideI18nKeyless(baseConfig())] });
    const service = TestBed.inject(I18nKeylessService);
    await service.whenHydrated();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("h1").textContent).toBe("Bonjour");
    expect(fixture.nativeElement.querySelector("p").textContent).toBe("8 heures");

    await service.setCurrentLanguage("en");
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("h1").textContent).toBe("Hello");
    expect(fixture.nativeElement.querySelector("p").textContent).toBe("8 hours");
  });

  it("bridges the signals to observables", async () => {
    mockFetch();
    TestBed.configureTestingModule({ providers: [provideI18nKeyless(baseConfig())] });
    const service = TestBed.inject(I18nKeylessService);
    await service.whenHydrated();
    expect(await firstValueFrom(service.currentLanguage$)).toBe("fr");
    await setCurrentLanguage("es");
    TestBed.tick();
    expect(await firstValueFrom(service.currentLanguage$)).toBe("es");
    expect((await firstValueFrom(service.translations$)).Bonjour).toBe("Hola");
  });

  it("exposes the supported languages and a one-shot getTranslation", async () => {
    mockFetch();
    TestBed.configureTestingModule({ providers: [provideI18nKeyless(baseConfig())] });
    const service = TestBed.inject(I18nKeylessService);
    await service.whenHydrated();
    expect(service.getSupportedLanguages()).toEqual(["fr", "en", "es"]);
    await service.setCurrentLanguage("en");
    expect(service.getTranslation("Bonjour")).toBe("Hello");
    expect(store.currentLanguage()).toBe("en");
  });
});

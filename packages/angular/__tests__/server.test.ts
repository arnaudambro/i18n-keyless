import { ApplicationInitStatus, Component, inject, PLATFORM_ID } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { I18nKeylessTextComponent } from "../text.component.ts";
import { I18nKeylessTranslatePipe } from "../translate.pipe.ts";
import { I18nKeylessService } from "../service.ts";
import { provideI18nKeyless, provideI18nKeylessServer } from "../provide.ts";
import { init, store, getTranslation } from "../store.ts";
import { getServerTranslations, clearServerTranslationsCache } from "../server.ts";
import { runWithI18nKeyless, getRequestScope, getUsedTranslationsSnapshot } from "../request-scope.ts";
import { baseConfig, mockFetch, resetAll, renderedText, flush, EN } from "./helpers.ts";

@Component({
  standalone: true,
  imports: [I18nKeylessTextComponent, I18nKeylessTranslatePipe],
  template: `<h1><i18n-t>Bonjour</i18n-t></h1><p>{{ "Changer de langue" | t }}</p>`,
})
class HostComponent {
  readonly i18n = inject(I18nKeylessService);
}

beforeEach(() => {
  resetAll();
  clearServerTranslationsCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("provideI18nKeylessServer", () => {
  it("takes precedence over the store for the component, the pipe and the service", async () => {
    mockFetch();
    await init(baseConfig());
    TestBed.configureTestingModule({
      providers: [provideI18nKeylessServer({ lang: "en", translations: EN })],
    });
    const fixture = TestBed.createComponent(HostComponent);
    // Pin the store to the primary language AFTER the providers seeded it: what renders in
    // English now can only come from the request scope.
    store.setState({ currentLanguage: "fr", translations: {} });
    fixture.detectChanges();

    expect(renderedText(fixture, "i18n-t")).toBe("Hello");
    expect(fixture.nativeElement.querySelector("p").textContent).toBe("Switch language");
    expect(fixture.componentInstance.i18n.currentLanguage()).toBe("en");
    expect(fixture.componentInstance.i18n.translations()).toBe(EN);
    expect(fixture.componentInstance.i18n.getTranslation("Bonjour")).toBe("Hello");
    expect(store.currentLanguage()).toBe("fr");
  });

  it("seeds the store in the browser so imperative reads agree with the scope", async () => {
    mockFetch();
    await init(baseConfig());
    TestBed.configureTestingModule({
      providers: [provideI18nKeylessServer({ lang: "en", translations: EN })],
    });
    TestBed.inject(I18nKeylessService);
    expect(store.currentLanguage()).toBe("en");
    expect(store.translations().Bonjour).toBe("Hello");
    expect(getTranslation("Bonjour")).toBe("Hello");
  });

  it("does not seed the store on the server platform", async () => {
    mockFetch();
    await init(baseConfig());
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: "server" }, provideI18nKeylessServer({ lang: "en", translations: EN })],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, "i18n-t")).toBe("Hello");
    expect(store.currentLanguage()).toBe("fr");
    expect(store.translations()).toEqual({});
  });

  it("accepts an async factory run in injection context (APP_INITIALIZER)", async () => {
    mockFetch();
    await init(baseConfig());
    TestBed.configureTestingModule({
      providers: [
        provideI18nKeylessServer(async () => {
          // `inject` works here: the factory runs in the injector's context
          expect(inject(PLATFORM_ID)).toBe("browser");
          return { lang: "en", translations: await getServerTranslations("en") };
        }),
      ],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, "i18n-t")).toBe("Hello");
    expect(fixture.componentInstance.i18n.currentLanguage()).toBe("en");
  });

  it("does not queue translate-on-miss on the server platform", async () => {
    const api = mockFetch();
    await init(baseConfig());
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: "server" }, provideI18nKeylessServer({ lang: "en", translations: {} })],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, "i18n-t")).toBe("Bonjour");
    await flush();
    expect(api.to("/translate")).toHaveLength(0);
  });
});

describe("provideI18nKeyless on the server platform", () => {
  it("runs init once per process and never POSTs usage", async () => {
    const api = mockFetch();
    const storage = {
      ...baseConfig().storage!,
      getItem: (key: string) =>
        key === "i18n-keyless-translations-usage" ? JSON.stringify({ default: { Bonjour: "2025-01-01" } }) : null,
    };
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: "server" }, provideI18nKeyless(baseConfig({ storage, ssr: true }))],
    });
    const service = TestBed.inject(I18nKeylessService);
    await service.whenHydrated();
    await flush();
    expect(api.to("/translate/last-used-translations")).toHaveLength(0);

    // a second bootstrap (next request) reuses the hydrated store
    const initSpy = vi.spyOn(console, "log");
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: "server" }, provideI18nKeyless(baseConfig({ storage, ssr: true }))],
    });
    TestBed.inject(I18nKeylessService);
    await flush();
    expect(store.hydrated()).toBe(true);
    expect(initSpy).not.toHaveBeenCalledWith(expect.stringContaining("_hydrate"), expect.anything());
  });
});

describe("getServerTranslations", () => {
  it("fetches a language once per process and returns {} for the primary language", async () => {
    const api = mockFetch();
    await init(baseConfig());
    expect(await getServerTranslations("fr")).toEqual({});
    expect(await getServerTranslations("en")).toEqual(EN);
    expect(await getServerTranslations("en")).toEqual(EN);
    expect(api.to("/translate/en")).toHaveLength(1);
    clearServerTranslationsCache("en");
    await getServerTranslations("en");
    expect(api.to("/translate/en")).toHaveLength(2);
  });
});

describe("runWithI18nKeyless", () => {
  it("scopes the imperative getTranslation to the request's language", async () => {
    mockFetch();
    await init(baseConfig());
    const html = await runWithI18nKeyless({ lang: "en", translations: EN }, () => {
      expect(getRequestScope()).toEqual({ lang: "en", translations: EN });
      const text = getTranslation("Bonjour");
      expect(getUsedTranslationsSnapshot()).toEqual({ lang: "en", translations: { Bonjour: "Hello" } });
      return `<h1>${text}</h1>`;
    });
    expect(html).toBe("<h1>Hello</h1>");
    expect(getTranslation("Bonjour")).toBe("Bonjour");
    expect(getRequestScope()).toBeUndefined();
  });
});

import { Component, computed, inject, PLATFORM_ID } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { I18nKeylessService } from "../service.ts";
import { provideI18nKeylessServer } from "../provide.ts";
import { init, store, setCurrentLanguage } from "../store.ts";
import { runWithI18nKeyless } from "../request-scope.ts";
import { baseConfig, mockFetch, resetAll, makeStorage, flush, EN } from "./helpers.ts";

@Component({
  standalone: true,
  template: `<h1>{{ greeting() }}</h1>`,
})
class HostComponent {
  private readonly i18n = inject(I18nKeylessService);
  readonly greeting = computed(() => this.i18n.translate("Au revoir", { namespace: "shop", context: "ctx" }));
}

beforeEach(() => {
  resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("I18nKeylessService edge paths", () => {
  it("init() and clearStorageAndStore() drive the store", async () => {
    mockFetch();
    const storage = makeStorage();
    const service = TestBed.inject(I18nKeylessService);
    await service.init(baseConfig({ storage }));
    expect(service.hydrated()).toBe(true);
    expect(service.config().API_KEY).toBe("test-key");
    await service.setCurrentLanguage("en");
    expect(storage.data.get("i18n-keyless-current-language")).toBe("en");

    await service.clearStorageAndStore();
    expect(service.hydrated()).toBe(false);
    expect(service.currentLanguage()).toBe("fr");
    expect(storage.data.has("i18n-keyless-current-language")).toBe(false);
  });

  it("translate() returns '' for empty text and requests a miss once per computed", async () => {
    const api = mockFetch({ en: {} });
    await init(baseConfig());
    await setCurrentLanguage("en");
    const service = TestBed.inject(I18nKeylessService);
    expect(service.translate("")).toBe("");
    expect(service.translate("   ")).toBe("");
    // trimmed, with a dev warning
    expect(service.translate(" Bonjour ")).toBe("Bonjour");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("leading/trailing whitespace"));

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("h1").textContent).toBe("Au revoir");
    await vi.waitFor(() => expect(api.to("/translate").length).toBeGreaterThan(0));
    await flush();
    const misses = api.to("/translate").map((call) => call.body as { key: string; namespace?: string });
    expect(misses.filter((body) => body.key === "Au revoir")).toHaveLength(1);
    expect(misses.find((body) => body.key === "Au revoir")).toMatchObject({ namespace: "shop", context: "ctx" });
  });

  it("translate() never requests on the server platform", async () => {
    const api = mockFetch({ en: {} });
    await init(baseConfig());
    await setCurrentLanguage("en");
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: "server" }] });
    const service = TestBed.inject(I18nKeylessService);
    expect(service.translate("Au revoir")).toBe("Au revoir");
    await flush();
    expect(api.to("/translate")).toHaveLength(0);
  });

  it("getTranslation() prefers the runWithI18nKeyless scope over the DI scope", async () => {
    mockFetch();
    await init(baseConfig());
    TestBed.configureTestingModule({
      providers: [provideI18nKeylessServer({ lang: "en", translations: EN })],
    });
    const service = TestBed.inject(I18nKeylessService);
    expect(service.getTranslation("Bonjour")).toBe("Hello");
    const scoped = await runWithI18nKeyless({ lang: "es", translations: { Bonjour: "Hola" } }, () =>
      service.getTranslation("Bonjour")
    );
    expect(scoped).toBe("Hola");
    expect(store.currentLanguage()).toBe("en");
  });
});

import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { I18nKeylessTextComponent } from "../text.component.ts";
import { I18nKeylessTranslatePipe } from "../translate.pipe.ts";
import { provideI18nKeylessServer } from "../provide.ts";
import { init, store, setCurrentLanguage, getTranslation } from "../store.ts";
import { resolveTranslation } from "../resolve.ts";
import { baseConfig, mockFetch, resetAll, renderedText } from "./helpers.ts";

/**
 * Every other suite uses the primary "fr", the same value the store holds before
 * `provideI18nKeyless` ran. A code path that falls back to that default passes those suites
 * for the wrong reason. Here the app's primary is "en" and the target language is "fr": a
 * fallback to the default gives an answer these tests can see.
 */
@Component({
  standalone: true,
  imports: [I18nKeylessTextComponent, I18nKeylessTranslatePipe],
  template: `<h1><i18n-t>Hello</i18n-t></h1><p>{{ "Hello" | t }}</p>`,
})
class Host {}

const FR = { Hello: "Bonjour" };
const enPrimary = () => baseConfig({ languages: { primary: "en", supported: ["en", "fr"] } });
const paragraph = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.querySelector("p")?.textContent;

beforeEach(() => {
  resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a primary language other than the store default", () => {
  it("renders the source text in the primary language and the dictionary in the store's default one", async () => {
    mockFetch({ fr: FR });
    await init(enPrimary());
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(renderedText(fixture, "h1 i18n-t")).toBe("Hello");
    expect(paragraph(fixture)).toBe("Hello");

    await setCurrentLanguage("fr");
    fixture.detectChanges();
    expect(renderedText(fixture, "h1 i18n-t")).toBe("Bonjour");
    expect(paragraph(fixture)).toBe("Bonjour");
    expect(getTranslation("Hello")).toBe("Bonjour");
  });

  // The store never ran init(): default config, no key, primary "fr". The request scope
  // carries the primary, so the component, the pipe and the resolver read it from there.
  it("the request scope carries the primary: French for an English-primary app on a cold store", () => {
    TestBed.configureTestingModule({
      providers: [provideI18nKeylessServer({ lang: "fr", primary: "en", translations: FR })],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(store.config().API_KEY).toBe("");
    expect(renderedText(fixture, "h1 i18n-t")).toBe("Bonjour");
    expect(paragraph(fixture)).toBe("Bonjour");
  });

  it("renders the source text when the request language is the scope's primary", () => {
    TestBed.configureTestingModule({
      providers: [provideI18nKeylessServer({ lang: "en", primary: "en", translations: { Hello: "SHOULD NOT SHOW" } })],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(renderedText(fixture, "h1 i18n-t")).toBe("Hello");
    expect(paragraph(fixture)).toBe("Hello");
  });

  it("resolveTranslation reads the scope's primary before the store's", () => {
    expect(resolveTranslation("Hello", undefined, { lang: "fr", primary: "en", translations: FR }).text).toBe("Bonjour");
    // Without a primary in the scope, the store's default ("fr") makes "fr" the source language.
    expect(resolveTranslation("Hello", undefined, { lang: "fr", translations: FR }).text).toBe("Hello");
  });
});

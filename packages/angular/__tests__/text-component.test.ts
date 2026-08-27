import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { I18nKeylessTextComponent } from "../text.component.ts";
import { init, store, setCurrentLanguage } from "../store.ts";
import { baseConfig, mockFetch, resetAll, renderedText, sourceText, flush, EN } from "./helpers.ts";

@Component({
  standalone: true,
  imports: [I18nKeylessTextComponent],
  template: `
    <h1><i18n-t>Bonjour</i18n-t></h1>
    <p class="time"><i18n-t context="heure">8 heures</i18n-t></p>
    <p class="duration"><i18n-t context="durée">8 heures</i18n-t></p>
    <p class="replace"><i18n-t [replace]="{ '{name}': name() }">{{ "Bonjour {name}" }}</i18n-t></p>
    <p class="dynamic"><i18n-t>{{ dynamic() }}</i18n-t></p>
    <p class="multiline">
      <i18n-t>
        Changer de langue
      </i18n-t>
    </p>
  `,
})
class HostComponent {
  readonly name = signal("Ada");
  readonly dynamic = signal("Bonjour");
}

beforeEach(() => {
  resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("<i18n-t>", () => {
  it("renders the source text in the primary language", async () => {
    mockFetch();
    await init(baseConfig());
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, "h1 i18n-t")).toBe("Bonjour");
    expect(sourceText(fixture, "h1 i18n-t")).toBe("Bonjour");
  });

  it("renders the source, then the translation once the store updates", async () => {
    const api = mockFetch();
    await init(baseConfig());
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, "h1 i18n-t")).toBe("Bonjour");

    await setCurrentLanguage("en");
    fixture.detectChanges();
    expect(renderedText(fixture, "h1 i18n-t")).toBe("Hello");
    // the source stays in the DOM, hidden, so hydration can read the key again
    expect(sourceText(fixture, "h1 i18n-t")).toBe("Bonjour");
    const span = fixture.nativeElement.querySelector("h1 i18n-t span") as HTMLElement;
    expect(span.style.display).toBe("none");
    expect(span.getAttribute("aria-hidden")).toBe("true");

    // no miss was queued for a key the dictionary has
    await flush();
    expect(api.to("/translate").map((call) => (call.body as { key: string }).key)).not.toContain("Bonjour");
  });

  it("re-renders when a translation lands in the store", async () => {
    mockFetch({ en: {} });
    await init(baseConfig());
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, "h1 i18n-t")).toBe("Bonjour");

    store.setState({ translations: { ...store.translations(), Bonjour: "Hello" } });
    fixture.detectChanges();
    expect(renderedText(fixture, "h1 i18n-t")).toBe("Hello");
  });

  it("stores a context as key__context", async () => {
    mockFetch();
    await init(baseConfig());
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, ".time i18n-t")).toBe("8 AM");
    expect(renderedText(fixture, ".duration i18n-t")).toBe("8 hours");
  });

  it("interpolates with replace, on the source and on the translation", async () => {
    mockFetch();
    await init(baseConfig());
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, ".replace i18n-t")).toBe("Bonjour Ada");

    await setCurrentLanguage("en");
    fixture.detectChanges();
    expect(renderedText(fixture, ".replace i18n-t")).toBe("Hello Ada");

    fixture.componentInstance.name.set("Grace");
    fixture.detectChanges();
    expect(renderedText(fixture, ".replace i18n-t")).toBe("Hello Grace");
  });

  it("follows a projected interpolation", async () => {
    mockFetch();
    await init(baseConfig());
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, ".dynamic i18n-t")).toBe("Hello");

    fixture.componentInstance.dynamic.set("Changer de langue");
    fixture.detectChanges();
    expect(renderedText(fixture, ".dynamic i18n-t")).toBe("Switch language");
  });

  it("trims the template whitespace around the source (same key as the react package)", async () => {
    mockFetch();
    await init(baseConfig());
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, ".multiline i18n-t")).toBe(EN["Changer de langue"]);
  });

  it("queues a miss for an unknown key, once, and re-queues on a language switch", async () => {
    const api = mockFetch({ en: {}, es: {} });
    await init(baseConfig());
    await setCurrentLanguage("en");

    @Component({
      standalone: true,
      imports: [I18nKeylessTextComponent],
      template: `<i18n-t>Au revoir</i18n-t>`,
    })
    class MissHost {}

    const fixture = TestBed.createComponent(MissHost);
    fixture.detectChanges();
    fixture.detectChanges();
    await vi.waitFor(() => expect(api.to("/translate")).toHaveLength(1));
    expect(api.to("/translate")[0].body).toMatchObject({ key: "Au revoir" });

    await setCurrentLanguage("es");
    fixture.detectChanges();
    await vi.waitFor(() => expect(api.to("/translate")).toHaveLength(2));
  });
});

@Component({
  standalone: true,
  imports: [I18nKeylessTextComponent],
  template: `
    <p class="empty"><i18n-t></i18n-t></p>
    <p class="debug"><i18n-t [debug]="true">Bonjour</i18n-t></p>
    <p class="ugc"><i18n-t originLanguage="es">Hola</i18n-t></p>
    <p class="tmp"><i18n-t namespace="tmp" [unpersistedNamespace]="true">Temporaire</i18n-t></p>
    <p class="forced"><i18n-t [forceTemporary]="{ en: 'Forced' }">Changer de langue</i18n-t></p>
  `,
})
class EdgeHostComponent {}

describe("<i18n-t> edge paths", () => {
  it("renders '' for an empty element and logs the resolution with debug", async () => {
    mockFetch();
    await init(baseConfig());
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(EdgeHostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, ".empty i18n-t")).toBe("");
    expect(renderedText(fixture, ".debug i18n-t")).toBe("Hello");
    expect(console.log).toHaveBeenCalledWith(
      expect.objectContaining({ source: "Bonjour", currentLanguage: "en", text: "Hello", debug: true })
    );
  });

  it("passes originLanguage, namespace, unpersistedNamespace and forceTemporary to the request", async () => {
    const api = mockFetch({ en: {} });
    await init(baseConfig());
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(EdgeHostComponent);
    fixture.detectChanges();
    expect(renderedText(fixture, ".ugc i18n-t")).toBe("Hola");
    expect(renderedText(fixture, ".tmp i18n-t")).toBe("Temporaire");
    expect(renderedText(fixture, ".forced i18n-t")).toBe("Changer de langue");

    await vi.waitFor(() => expect(api.to("/translate").length).toBeGreaterThanOrEqual(4));
    const bodies = api.to("/translate").map((call) => call.body as Record<string, unknown>);
    expect(bodies.find((body) => body.key === "Hola")).toMatchObject({ originLanguage: "es" });
    expect(bodies.find((body) => body.key === "Temporaire")).toMatchObject({ namespace: "tmp" });
    expect(bodies.find((body) => body.key === "Changer de langue")).toMatchObject({ forceTemporary: { en: "Forced" } });
    await flush();
    expect(store.getState().unpersistedNamespaces).toContain("tmp");
  });
});

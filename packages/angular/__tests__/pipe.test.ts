import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { I18nKeylessTranslatePipe } from "../translate.pipe.ts";
import { init, store, setCurrentLanguage } from "../store.ts";
import { baseConfig, mockFetch, resetAll, flush } from "./helpers.ts";

@Component({
  standalone: true,
  imports: [I18nKeylessTranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ "Bonjour" | t }}</h1>
    <p class="time">{{ "8 heures" | t: { context: "heure" } }}</p>
    <p class="duration">{{ "8 heures" | t: { context: "durée" } }}</p>
    <p class="replace">{{ "Bonjour {name}" | t: { replace: { "{name}": name() } } }}</p>
    <input [placeholder]="'Changer de langue' | t" />
  `,
})
class HostComponent {
  readonly name = signal("Ada");
}

const text = (fixture: { nativeElement: HTMLElement }, selector: string) =>
  fixture.nativeElement.querySelector(selector)?.textContent ?? "";

beforeEach(() => {
  resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the t pipe", () => {
  it("renders the source in the primary language and re-evaluates on setCurrentLanguage", async () => {
    mockFetch();
    await init(baseConfig());
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(text(fixture, "h1")).toBe("Bonjour");
    expect(fixture.nativeElement.querySelector("input").placeholder).toBe("Changer de langue");

    await setCurrentLanguage("en");
    fixture.detectChanges();
    expect(text(fixture, "h1")).toBe("Hello");
    expect(fixture.nativeElement.querySelector("input").placeholder).toBe("Switch language");

    await setCurrentLanguage("es");
    fixture.detectChanges();
    expect(text(fixture, "h1")).toBe("Hola");
  });

  it("re-evaluates when a translation lands, even under OnPush", async () => {
    mockFetch({ en: {} });
    await init(baseConfig());
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(text(fixture, "h1")).toBe("Bonjour");

    store.setState({ translations: { ...store.translations(), Bonjour: "Hello" } });
    fixture.detectChanges();
    expect(text(fixture, "h1")).toBe("Hello");
  });

  it("handles context and replace options", async () => {
    mockFetch();
    await init(baseConfig());
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(text(fixture, ".time")).toBe("8 AM");
    expect(text(fixture, ".duration")).toBe("8 hours");
    expect(text(fixture, ".replace")).toBe("Hello Ada");

    fixture.componentInstance.name.set("Grace");
    fixture.detectChanges();
    expect(text(fixture, ".replace")).toBe("Hello Grace");
  });

  it("queues a miss once per key and language, not once per check", async () => {
    const api = mockFetch({ en: {} });
    await init(baseConfig());
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    fixture.detectChanges();
    await flush();
    const keys = api.to("/translate").map((call) => (call.body as { key: string }).key);
    expect(keys.filter((key) => key === "Bonjour")).toHaveLength(1);
  });
});

@Component({
  standalone: true,
  imports: [I18nKeylessTranslatePipe],
  template: `
    <p class="null">{{ nullable() | t }}</p>
    <p class="empty">{{ "" | t }}</p>
    <p class="namespaced">{{ "Au revoir" | t: { namespace: "shop" } }}</p>
  `,
})
class EdgeHostComponent {
  readonly nullable = signal<string | null>(null);
}

describe("the t pipe edge paths", () => {
  it("renders '' for null or empty text and passes the namespace to a miss", async () => {
    const api = mockFetch({ en: {} });
    await init(baseConfig());
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(EdgeHostComponent);
    fixture.detectChanges();
    expect(text(fixture, ".null")).toBe("");
    expect(text(fixture, ".empty")).toBe("");
    expect(text(fixture, ".namespaced")).toBe("Au revoir");
    await vi.waitFor(() => expect(api.to("/translate")).toHaveLength(1));
    expect(api.to("/translate")[0].body).toMatchObject({ key: "Au revoir", namespace: "shop" });

    store.setState({ translations: { ...store.translations(), Bonjour: "Hello" } });
    fixture.componentInstance.nullable.set("Bonjour");
    fixture.detectChanges();
    expect(text(fixture, ".null")).toBe("Hello");
  });
});

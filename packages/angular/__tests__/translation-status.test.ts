import { Component, computed, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { markTranslationPending, settlePendingTranslationsAfter, isTranslationPending } from "i18n-keyless-core";
import { I18nKeylessTextComponent } from "../text.component.ts";
import { I18nKeylessTranslatePipe } from "../translate.pipe.ts";
import { I18nKeylessTranslationStatusPipe } from "../translation-status.pipe.ts";
import { I18nKeylessService } from "../service.ts";
import { provideI18nKeyless, provideI18nKeylessServer } from "../provide.ts";
import { init, store, setCurrentLanguage, getTranslation, getTranslationStatus } from "../store.ts";
import { resolveTranslation } from "../resolve.ts";
import { runWithI18nKeyless } from "../request-scope.ts";
import { baseConfig, mockFetch, resetAll, flush, renderedText, statusOf, withoutWindow } from "./helpers.ts";

const text = (fixture: { nativeElement: HTMLElement }, selector: string) =>
  fixture.nativeElement.querySelector(selector)?.textContent ?? "";

/**
 * A `handleTranslate` / `getAllTranslations` pair that gives full, deterministic control
 * over when a translate-on-miss "lands" — unlike the raw `fetch` mock, nothing here resolves
 * until the test says so, so a status transition test never races the real event loop.
 */
function deferredTranslationConfig() {
  let dictionary: Record<string, string> = {};
  let resolveMiss: (() => void) | null = null;
  const handleTranslate = vi.fn(
    () =>
      new Promise<{ ok: boolean; message: string; data: { translation: Record<string, string> } }>((resolve) => {
        resolveMiss = () => resolve({ ok: true, message: "", data: { translation: {} } });
      })
  );
  const getAllTranslations = vi.fn(async () => ({
    ok: true,
    data: { translations: dictionary, uniqueId: null, lastRefresh: "2025-01-01" },
    error: "",
    message: "",
  }));
  return {
    handleTranslate,
    getAllTranslations,
    /** Makes the NEXT bulk fetch (the one after the current drain) return this dictionary. */
    setDictionary(next: Record<string, string>) {
      dictionary = next;
    },
    /** Resolves the in-flight `handleTranslate` call, letting the queue drain. */
    settleMiss() {
      const resolve = resolveMiss;
      resolveMiss = null;
      resolve?.();
    },
  };
}

beforeEach(() => {
  resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("getTranslationStatus (plain function)", () => {
  it("is unavailable before init (no API key), once the viewer's language differs from the primary", () => {
    // A cold store defaults BOTH currentLanguage and the primary to "fr", so a lookup for
    // "Bonjour" as-is would hit rule 1 (the key's own language) regardless of API_KEY.
    // Force a mismatch to exercise rule 3 (never initialized) instead.
    store.setState({ currentLanguage: "en" });
    expect(getTranslationStatus("Bonjour")).toBe("unavailable");
  });

  it("is ready in the primary language, no lookup needed", async () => {
    mockFetch();
    await init(baseConfig());
    expect(getTranslationStatus("Bonjour")).toBe("ready");
  });

  it("is ready once the cell is in the store", async () => {
    mockFetch();
    await init(baseConfig());
    await setCurrentLanguage("en");
    expect(getTranslationStatus("Bonjour")).toBe("ready");
  });

  it("is unavailable for a miss, then pending once getTranslation actually queues it, and never queues by itself", async () => {
    const api = mockFetch({ en: {} });
    await init(baseConfig());
    await setCurrentLanguage("en");
    expect(getTranslationStatus("Au revoir")).toBe("unavailable");
    await flush();
    expect(api.to("/translate")).toHaveLength(0);

    getTranslation("Au revoir");
    expect(getTranslationStatus("Au revoir")).toBe("pending");
    await vi.waitFor(() => expect(api.to("/translate")).toHaveLength(1));
  });

  it("resolves against the runWithI18nKeyless (ALS) scope, on a cold store", async () => {
    await runWithI18nKeyless({ lang: "es", translations: { Bonjour: "Hola" } }, () => {
      expect(getTranslationStatus("Bonjour")).toBe("ready");
    });
  });
});

describe("resolveTranslation — status, and reactivity via store.pendingVersion", () => {
  it("returns status alongside text and lang", async () => {
    mockFetch();
    await init(baseConfig());
    expect(resolveTranslation("Bonjour", undefined, undefined).status).toBe("ready");
  });

  it("is pending right after a mark, unavailable right after the matching settle", async () => {
    mockFetch();
    await init(baseConfig());
    await setCurrentLanguage("en");
    store.setState({ translations: {} });
    expect(resolveTranslation("Bonjour", undefined, undefined).status).toBe("unavailable");

    markTranslationPending("default", "Bonjour");
    expect(resolveTranslation("Bonjour", undefined, undefined).status).toBe("pending");

    settlePendingTranslationsAfter("default")();
    expect(resolveTranslation("Bonjour", undefined, undefined).status).toBe("unavailable");
  });

  it("a computed depending on resolveTranslation only re-evaluates once the pending-set notification lands", async () => {
    mockFetch();
    await init(baseConfig());
    await setCurrentLanguage("en");
    store.setState({ translations: {} });

    const status = computed(() => resolveTranslation("Bonjour", undefined, undefined).status);
    expect(status()).toBe("unavailable");

    markTranslationPending("default", "Bonjour");
    // The underlying pending set already reports true, but the computed's only dependency
    // that could reflect it (store.pendingVersion) has not been bumped yet: notification is
    // batched into a microtask, so a synchronous re-read is still stale.
    expect(status()).toBe("unavailable");

    await Promise.resolve();
    await Promise.resolve();
    expect(status()).toBe("pending");
  });

  it("is never pending on a server runtime (isServerRuntime), even when marked pending directly", async () => {
    mockFetch();
    await withoutWindow(() => init(baseConfig()));
    // A mismatch between the viewer's language and the primary, or rule 1 (the key's own
    // language) would short-circuit to "ready" regardless of the server-runtime rule.
    store.setState({ currentLanguage: "en" });
    markTranslationPending("default", "Inconnu");
    expect(resolveTranslation("Inconnu", undefined, undefined).status).toBe("unavailable");
  });
});

@Component({
  standalone: true,
  imports: [I18nKeylessTextComponent],
  template: `<i18n-t>Bonjour</i18n-t>`,
})
class StatusHost {}

describe("<i18n-t> status", () => {
  it("is ready in the primary language, with no request, and mirrors onto data-i18n-status", async () => {
    const api = mockFetch();
    await init(baseConfig());
    const fixture = TestBed.createComponent(StatusHost);
    fixture.detectChanges();
    expect(statusOf(fixture)).toBe("ready");
    await flush();
    expect(api.to("/translate")).toHaveLength(0);
  });

  it("flips pending -> ready when the bulk fetch that follows the drain brings the cell", async () => {
    const deferred = deferredTranslationConfig();
    await init(baseConfig({ handleTranslate: deferred.handleTranslate, getAllTranslations: deferred.getAllTranslations }));
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(StatusHost);
    fixture.detectChanges();
    fixture.detectChanges();
    await vi.waitFor(() => expect(deferred.handleTranslate).toHaveBeenCalledTimes(1));
    fixture.detectChanges();
    expect(statusOf(fixture)).toBe("pending");

    // The dictionary the NEXT bulk fetch answers with now covers the key: settling the miss
    // drains the queue, which fires the "empty" handler's own bulk fetch and merges the cell.
    deferred.setDictionary({ Bonjour: "Hello" });
    deferred.settleMiss();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(statusOf(fixture)).toBe("ready");
    });
    expect(renderedText(fixture)).toBe("Hello");
  });

  it("is unavailable once the bulk fetch settles without bringing the cell", async () => {
    const deferred = deferredTranslationConfig();
    await init(baseConfig({ handleTranslate: deferred.handleTranslate, getAllTranslations: deferred.getAllTranslations }));
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(StatusHost);
    fixture.detectChanges();
    fixture.detectChanges();
    await vi.waitFor(() => expect(deferred.handleTranslate).toHaveBeenCalledTimes(1));
    fixture.detectChanges();
    expect(statusOf(fixture)).toBe("pending");

    deferred.settleMiss(); // the dictionary stays empty: the cell never lands
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(statusOf(fixture)).toBe("unavailable");
    });
    expect(isTranslationPending("default", "Bonjour")).toBe(false);
    // The source still renders (never throws, never blanks) while unavailable.
    expect(renderedText(fixture)).toBe("Bonjour");
  });

  it("is unavailable before the projected content has been read", () => {
    const fixture = TestBed.createComponent(StatusHost);
    // No detectChanges yet: ngAfterContentChecked has not run, `source` is still "".
    expect(fixture.componentInstance).toBeTruthy();
  });
});

@Component({
  standalone: true,
  imports: [I18nKeylessTranslationStatusPipe, I18nKeylessTranslatePipe],
  template: `<p class="status">{{ "Bonjour" | tStatus }}</p><p class="text">{{ "Bonjour" | t }}</p>`,
})
class StatusPipeHost {}

describe("the tStatus pipe", () => {
  it("is ready in the primary language, with no request", async () => {
    const api = mockFetch();
    await init(baseConfig());
    const fixture = TestBed.createComponent(StatusPipeHost);
    fixture.detectChanges();
    expect(text(fixture, ".status")).toBe("ready");
    await flush();
    expect(api.to("/translate")).toHaveLength(0);
  });

  it("returns 'unavailable' for null/empty text, like t returns ''", async () => {
    @Component({
      standalone: true,
      imports: [I18nKeylessTranslationStatusPipe],
      template: `<p class="empty">{{ "" | tStatus }}</p>`,
    })
    class EmptyHost {}
    mockFetch();
    await init(baseConfig());
    const fixture = TestBed.createComponent(EmptyHost);
    fixture.detectChanges();
    expect(text(fixture, ".empty")).toBe("unavailable");
  });

  it("flips unavailable -> pending -> ready, requesting the miss once even across many checks", async () => {
    const deferred = deferredTranslationConfig();
    await init(baseConfig({ handleTranslate: deferred.handleTranslate, getAllTranslations: deferred.getAllTranslations }));
    await setCurrentLanguage("en");
    const fixture = TestBed.createComponent(StatusPipeHost);
    fixture.detectChanges();
    // Unlike the component (whose request-on-miss lives in a separate effect), the impure
    // pipe requests inline: the very first check that triggers a miss already returns
    // "pending", not a lagging "unavailable" — `markTranslationPending` runs synchronously.
    expect(text(fixture, ".status")).toBe("pending");
    await vi.waitFor(() => expect(deferred.handleTranslate).toHaveBeenCalledTimes(1));

    deferred.setDictionary({ Bonjour: "Hello" });
    deferred.settleMiss();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(text(fixture, ".status")).toBe("ready");
    });
    expect(text(fixture, ".text")).toBe("Hello");

    fixture.detectChanges();
    fixture.detectChanges();
    await flush();
    // requested once, not once per check, even though two separate pipe instances (t and
    // tStatus) each keep their own request memo.
    expect(deferred.handleTranslate).toHaveBeenCalledTimes(1);
  });
});

@Component({
  standalone: true,
  template: `<p class="status">{{ status() }}</p>`,
})
class ServiceStatusHost {
  private readonly i18n = inject(I18nKeylessService);
  readonly status = this.i18n.translationStatus("Bonjour");
}

describe("I18nKeylessService.translationStatus / getTranslationStatus", () => {
  it("translationStatus() is a reactive signal sharing translate()'s resolution", async () => {
    mockFetch();
    TestBed.configureTestingModule({ providers: [provideI18nKeyless(baseConfig())] });
    const service = TestBed.inject(I18nKeylessService);
    await service.whenHydrated();
    const fixture = TestBed.createComponent(ServiceStatusHost);
    fixture.detectChanges();
    expect(text(fixture, ".status")).toBe("ready");

    await service.setCurrentLanguage("en");
    fixture.detectChanges();
    expect(text(fixture, ".status")).toBe("ready");
  });

  it("getTranslationStatus() is a one-shot, non-reactive read, no side effect", async () => {
    mockFetch({ en: {} });
    TestBed.configureTestingModule({ providers: [provideI18nKeyless(baseConfig())] });
    const service = TestBed.inject(I18nKeylessService);
    await service.whenHydrated();
    await service.setCurrentLanguage("en");
    expect(service.getTranslationStatus("Bonjour")).toBe("unavailable");
    expect(isTranslationPending("default", "Bonjour")).toBe(false);
  });

  it("getTranslationStatus() reads the DI request-scope's primary before the store's", () => {
    TestBed.configureTestingModule({
      providers: [provideI18nKeylessServer({ lang: "fr", primary: "en", translations: { Hello: "Bonjour" } })],
    });
    const service = TestBed.inject(I18nKeylessService);
    expect(service.getTranslationStatus("Hello")).toBe("ready");
  });
});

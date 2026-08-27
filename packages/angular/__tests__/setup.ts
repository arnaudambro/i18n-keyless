// Angular test environment for vitest + jsdom.
//
// Order matters: zone.js must patch the globals before @angular/core creates its NgZone,
// and @angular/compiler must be loaded before the first component is compiled (JIT).
import "zone.js";
import "zone.js/testing";
import "@angular/compiler";
import { getTestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { AsyncLocalStorage } from "node:async_hooks";
import { vi, afterEach } from "vitest";

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting(), {
  teardown: { destroyAfterEach: true },
});

// request-scope.ts lazily loads AsyncLocalStorage through `new Function("return import(...)")`,
// a form vitest's sandboxed module runner cannot execute. Seed the globalThis slot it reads
// (ALS_KEY in request-scope.ts) so the SSR scoping tests exercise the real behaviour.
(globalThis as Record<string, unknown>)["__i18n_keyless_als__"] = new AsyncLocalStorage();

afterEach(() => {
  vi.restoreAllMocks();
});

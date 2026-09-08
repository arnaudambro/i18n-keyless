import "@testing-library/jest-dom";
import { vi, beforeEach } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { resetPendingTranslations } from "i18n-keyless-core";

vi.mock("zustand");

// request-scope.ts lazily loads AsyncLocalStorage via `new Function("return import(...)")` —
// a form that's opaque to bundlers (Metro/webpack/Vite) and to tsc's import-extension
// rewriter, but which vitest's sandboxed module runner cannot execute. Seed the singleton it
// looks up (a plain globalThis string key, ALS_KEY in request-scope.ts) so the SSR scoping
// tests exercise the real behavior. The lazy load itself works in production (Node/Metro).
(globalThis as Record<string, unknown>)["__i18n_keyless_als__"] = new AsyncLocalStorage();

// The pending set (docs/PROTOCOL.md 5.5) is a module-level singleton in core, like the
// unique-id state: a real `translateKey` call in one test (render-count.test.tsx,
// ssr-render.test.tsx, store.test.ts, ...) would otherwise leave a key pending for the next.
beforeEach(() => {
  resetPendingTranslations();
});

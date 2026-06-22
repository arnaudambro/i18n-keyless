import "@testing-library/jest-dom";
import { vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";

vi.mock("zustand");

// request-scope.ts lazily loads AsyncLocalStorage via `new Function("return import(...)")` —
// a form that's opaque to bundlers (Metro/webpack/Vite) and to tsc's import-extension
// rewriter, but which vitest's sandboxed module runner cannot execute. Seed the singleton it
// looks up (a plain globalThis string key, ALS_KEY in request-scope.ts) so the SSR scoping
// tests exercise the real behavior. The lazy load itself works in production (Node/Metro).
(globalThis as Record<string, unknown>)["__i18n_keyless_als__"] = new AsyncLocalStorage();

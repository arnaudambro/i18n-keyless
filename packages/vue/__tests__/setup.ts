import { AsyncLocalStorage } from "node:async_hooks";

// request-scope.ts lazily loads AsyncLocalStorage via `new Function("return import(...)")`,
// a form that's opaque to bundlers and to tsc's import-extension rewriter, but which
// vitest's sandboxed module runner cannot execute. Seed the singleton it looks up (a plain
// globalThis string key, ALS_KEY in request-scope.ts) so the SSR scoping tests exercise the
// real behavior. The lazy load itself works in production (Node).
(globalThis as Record<string, unknown>)["__i18n_keyless_als__"] = new AsyncLocalStorage();

// No test may reach the network. Each test stubs `fetch` with a double, but a request the
// store fires after `vi.unstubAllGlobals()` (a bulk fetch queued by an earlier miss) would
// fall through to the real one and knock on localhost:8787. Make the "real" one a 400:
// answered at once, never retried (only 429 and 5xx are), one console.error at most.
globalThis.fetch = (async () => ({
  status: 400,
  statusText: "network disabled in tests",
  headers: { get: () => null },
  json: async () => ({ ok: false, error: "network disabled in tests" }),
})) as unknown as typeof fetch;

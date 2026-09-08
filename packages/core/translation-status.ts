/**
 * Per-(key, language) status, so a developer can show a spinner, a blur, or the source
 * text while a translation is on its way — the SDK exposes the status, it never decides
 * what to render (docs/PROTOCOL.md 5.5).
 *
 * `ready` and `unavailable` are derived from the store on every call: nothing is stored
 * for them. The ONLY new data this feature introduces is `pendingTranslations` below — the
 * set of (namespace, key) translate-on-miss requests that have been queued and not yet
 * settled by the following bulk fetch.
 */
import type { FetchTranslationParams, Lang, TranslationOptions } from "./types.ts";
import { queueIdFor, resolveNamespace, resolveOriginLanguage, storageKeyFor } from "./service.ts";
import { hasRequestedFormat, resolveMessageFormat } from "./message-format.ts";
import { getSdkRuntime, isServerRuntime } from "./unique-id.ts";

export type TranslationStatus = "ready" | "pending" | "unavailable";

/**
 * The (namespace, key) translate-on-miss requests currently in flight, keyed the same way
 * the queue itself dedupes (`queueIdFor`), mapped to their namespace so a namespace's
 * settle step can find exactly its own ids without re-parsing the queue id string. Not
 * exported: every reader goes through `isTranslationPending` / `settlePendingTranslationsAfter`
 * so the derivation stays the only place that reads it.
 */
const pendingTranslations = new Map<string, string>();

const listeners = new Set<() => void>();
let notifyScheduled = false;

/** `queueMicrotask` when the runtime has it, `Promise.resolve().then` otherwise. */
const scheduleMicrotask: (callback: () => void) => void =
  typeof queueMicrotask === "function" ? queueMicrotask : (callback) => Promise.resolve().then(callback);

/**
 * Batches every `mark` / settle within the same tick into one notification. A `mark` can
 * happen during a framework render (a component asking for a key that has no cell yet); a
 * synchronous notification would re-enter that render.
 */
function scheduleNotify(): void {
  if (notifyScheduled) {
    return;
  }
  notifyScheduled = true;
  scheduleMicrotask(() => {
    notifyScheduled = false;
    for (const listener of listeners) {
      listener();
    }
  });
}

/**
 * Marks a (namespace, key) translate-on-miss as queued. Called by `translateKey` right
 * before `queue.add`, i.e. only when a task is actually queued — the queue's own dedup and
 * skip rules (section 6 of the protocol) are untouched, this is parallel bookkeeping, not a
 * dedup mechanism of its own.
 */
export function markTranslationPending(namespace: string, key: string): void {
  pendingTranslations.set(queueIdFor(namespace, key), namespace);
  scheduleNotify();
}

/** Whether a (namespace, key) translate-on-miss is currently pending. */
export function isTranslationPending(namespace: string, key: string): boolean {
  return pendingTranslations.has(queueIdFor(namespace, key));
}

/**
 * Snapshots the ids pending for `namespace` right now, and returns a function that deletes
 * exactly those ids (and notifies). Call the snapshot at the moment the bulk fetch for that
 * namespace is triggered (the queue's `empty` handler, before the fetch) and call the
 * returned function after the fetch settles — on success AND on failure, so a spinner never
 * stays forever when the network is down. Ids marked pending after the snapshot (queued
 * while that fetch was in flight) are NOT settled by it: they wait for the next drain. A key
 * still missing a usable cell after settling derives to `unavailable`; the next render
 * re-queues it, exactly like the existing miss loop.
 */
export function settlePendingTranslationsAfter(namespace: string): () => void {
  const ids: string[] = [];
  for (const [id, ns] of pendingTranslations) {
    if (ns === namespace) {
      ids.push(id);
    }
  }
  return () => {
    let changed = false;
    for (const id of ids) {
      if (pendingTranslations.delete(id)) {
        changed = true;
      }
    }
    if (changed) {
      scheduleNotify();
    }
  };
}

/**
 * Subscribes to pending-set changes. The listener fires in a microtask, once per batch of
 * synchronous `mark` / settle calls (see `scheduleNotify`), never synchronously.
 */
export function subscribeToPendingTranslations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Test-only, like `resetUniqueIdState`: clears the pending set. The listeners are kept on
 * purpose — a package's store subscribes once at module load (the way it registers
 * `queue.on("empty")`), and a reset between two tests must not silently unsubscribe it. A
 * test that subscribes its own listener unsubscribes it itself.
 */
export function resetPendingTranslations(): void {
  pendingTranslations.clear();
  notifyScheduled = false;
}

/**
 * Pure resolver, framework-agnostic: mirrors the `resolveText` helpers each package has, so
 * a package's reactive status hook derives from the exact same inputs as its text.
 *
 * - `translation` — `translations[storageKey]` in whichever map the caller renders from
 *   (the store, or an SSR provider / request scope).
 * - `primary` — the language the key is already written in: the project's primary language,
 *   or `originLanguage` for UGC (i.e. what `getTranslationCore` calls `sourceLanguage`).
 * - `pending` — `isTranslationPending(namespace, key)`.
 * - `initialized` — `!!config.API_KEY`.
 *
 * Rules, in order:
 * 1. the viewer reads the key's own language and the call asks for no `count` / `select` →
 *    `ready` (rendering it needs no lookup at all, see PROTOCOL.md 5),
 * 2. a usable cell exists (present, and carrying what `count` / `select` asked for) →
 *    `ready` — a `forceTemporary` key with a cell is `ready` too,
 * 3. the store never initialized (no `API_KEY`) → `unavailable`,
 * 4. a server runtime (`isServerRuntime(getSdkRuntime())`) → `unavailable` (no queue runs
 *    the miss there, so nothing is ever `pending`),
 * 5. a translate-on-miss for this (namespace, key) is queued and not yet settled →
 *    `pending`,
 * 6. otherwise → `unavailable`.
 */
export function resolveTranslationStatus(input: {
  translation: string | undefined;
  currentLanguage: Lang | null;
  primary: Lang;
  options?: TranslationOptions;
  pending: boolean;
  initialized: boolean;
}): TranslationStatus {
  if (input.currentLanguage === input.primary && !resolveMessageFormat(input.options)) {
    return "ready";
  }
  if (input.translation && hasRequestedFormat(input.translation, input.options)) {
    return "ready";
  }
  if (!input.initialized) {
    return "unavailable";
  }
  if (isServerRuntime(getSdkRuntime())) {
    return "unavailable";
  }
  if (input.pending) {
    return "pending";
  }
  return "unavailable";
}

/**
 * The store-based form of `resolveTranslationStatus`: same inputs `getTranslationCore` uses
 * for the same key, and no side effect — it never queues a translate-on-miss request, even
 * when the status it derives is `unavailable`. Reading the status must never itself change
 * the store.
 */
export function getTranslationStatusCore(
  key: string,
  store: FetchTranslationParams,
  options?: TranslationOptions
): TranslationStatus {
  const config = store.config;
  const namespace = resolveNamespace(options, config);
  const primary = resolveOriginLanguage(options, config) ?? config.languages.primary;
  const translation = store.translations[storageKeyFor(key, options?.context)];
  return resolveTranslationStatus({
    translation,
    currentLanguage: store.currentLanguage,
    primary,
    options,
    pending: isTranslationPending(namespace, key),
    initialized: !!config?.API_KEY,
  });
}

/**
 * The `unique_id` header is what the API counts as "a user".
 *
 * The API's usage middleware mints a fresh 16-char nanoid for every request whose
 * `unique_id` header is empty, and only `GET /translate` and `GET /translate/:lang` echo
 * that id back in the body. Every other counted route — `POST /translate`, `POST
 * /translate/last-used-translations` — mints an id the SDK can never learn. An empty
 * header therefore does not mean "one anonymous user": it means "one brand-new user, for
 * this one request, forever". That is how a project with under 500 real users was billed
 * for 5,517 MAU, with 41,077 of its 41,371 ids having made exactly one request.
 *
 * On an end-user device there is no server-side signal to count by — NAT and roaming make
 * the source IP useless — so the id is generated here, before the first request leaves, and
 * persisted in device storage. On a server there IS such a signal, so the SDK sends no id
 * at all and the API counts by source IP. The `sdk` header below says which case a request
 * is, so the API knows which of the two to use.
 */

/**
 * What the calling SDK is at RUNTIME, sent as the `sdk` header on every request.
 *
 * Not which package: `i18n-keyless-react` runs on a server too (SSR), and an SSR render is
 * a server, not a device. Counting it as a device would bill one "user" per render.
 *
 * - `react-client`   — a browser or a React Native app. One install, one persisted id.
 * - `react-server`   — the react SDK rendering on a server (SSR). Counted like `node`.
 * - `vue-client` / `vue-server`, `angular-client` / `angular-server` — same split for the
 *   vue and angular packages.
 * - `browser`        — the framework-free browser package. Always a device.
 * - `node`           — the node SDK. No id: the API counts the source IP.
 *
 * Rule the API applies: `node`, `laravel`, `rails` and every label ending in `-server` are
 * servers (counted by connection); everything else, an absent header included, is a device.
 * The ports in other languages send `laravel`, `rails` and `flutter`.
 *
 * The API treats a request with NO `sdk` header as `react-client`, which is what every
 * SDK released before 3.2.0 is, in practice.
 */
export type SdkRuntime =
  | "react-client"
  | "react-server"
  | "vue-client"
  | "vue-server"
  | "angular-client"
  | "angular-server"
  | "browser"
  | "node";

export type SdkPackage = "react" | "vue" | "angular" | "browser" | "node";

/** A server runtime: no `unique_id`, counted by its connection, no usage analytics. */
export function isServerRuntime(runtime: SdkRuntime | string): boolean {
  return runtime === "node" || runtime === "laravel" || runtime === "rails" || runtime.endsWith("-server");
}

/**
 * The runtime this process reports as. Each package sets it once at init; core defaults to
 * the device case so a request can never go out unlabelled.
 */
let sdkRuntime: SdkRuntime = "react-client";

export function setSdkRuntime(runtime: SdkRuntime): void {
  sdkRuntime = runtime;
}

export function getSdkRuntime(): SdkRuntime {
  return sdkRuntime;
}

/**
 * The runtime a package reports as, from what it can observe at init. Pure: the react
 * store's `hydrate()` and the node `init()` apply exactly this rule, and the conformance
 * vectors replay it (see conformance/vectors/usage-reporting.json).
 *
 * - the node package is always `node`, the browser package is always `browser`,
 * - the react, vue and angular packages are `<package>-server` without a `window` or with
 *   `ssr: true`, and `<package>-client` otherwise.
 */
export function resolveSdkRuntime(input: { package: SdkPackage; hasWindow?: boolean; ssr?: boolean }): SdkRuntime {
  if (input.package === "node" || input.package === "browser") {
    return input.package;
  }
  const side = !input.hasWindow || input.ssr ? "server" : "client";
  return `${input.package}-${side}` as SdkRuntime;
}

/**
 * Whether usage analytics (`POST /translate/last-used-translations`, and the per-render
 * usage recording that feeds it) are active for a runtime. A server render may be a
 * crawler hit and a serverless init would POST per request, so `react-server` is read-only.
 * The node package reports usage (debounced), see packages/node/service.ts.
 */
export function isUsageReportingEnabled(runtime: SdkRuntime = sdkRuntime): boolean {
  // Every `*-server` render is read-only; the node package is the one server that reports.
  return runtime === "node" || !isServerRuntime(runtime);
}

/**
 * The identity headers for one request: what kind of client this is, and — for a device
 * only — which device.
 *
 * A server sends no `unique_id`. It has nothing meaningful to put there: any value it
 * invented would either change on every restart (inflating the count) or be pinned across
 * a fleet (collapsing it). The API counts its source IP instead, which the client cannot
 * shape.
 */
export function identityHeaders(storeUniqueId?: string | null): Record<string, string> {
  if (isServerRuntime(sdkRuntime)) {
    return { sdk: sdkRuntime };
  }
  return { sdk: sdkRuntime, unique_id: resolveUniqueIdForRequest(storeUniqueId) };
}

/** The API's own alphabet and length — see `customAlphabet(alphabet, 16)` server-side. */
export const UNIQUE_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
export const UNIQUE_ID_LENGTH = 16;
const ALPHABET = UNIQUE_ID_ALPHABET;
const ID_LENGTH = UNIQUE_ID_LENGTH;

/**
 * Random bytes from the best source the runtime offers. React Native's Hermes has no
 * global `crypto` unless the app polyfills it, so `Math.random` has to remain a valid
 * fallback: 16 chars of a 64-char alphabet is ~96 bits, plenty to keep devices apart even
 * from a weak PRNG.
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (typeof webCrypto?.getRandomValues === "function") {
    try {
      webCrypto.getRandomValues(bytes);
      return bytes;
    } catch {
      // fall through to Math.random
    }
  }
  for (let index = 0; index < length; index++) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * Generates an id with the same shape as the one the API would have minted, so nothing
 * downstream (dashboards, exports, the `Usage` table) can tell them apart.
 *
 * The alphabet holds 63 characters, which does not divide 256, so a plain `byte % 63`
 * would favour the first character of the alphabet. Bytes at or above the largest
 * multiple of 63 are drawn again instead — the same rejection sampling nanoid itself does.
 */
const LARGEST_USABLE_BYTE = 256 - (256 % ALPHABET.length); // 252

export function generateUniqueId(): string {
  let id = "";
  while (id.length < ID_LENGTH) {
    for (const byte of randomBytes(ID_LENGTH)) {
      if (byte >= LARGEST_USABLE_BYTE) {
        continue;
      }
      id += ALPHABET[byte % ALPHABET.length];
      if (id.length === ID_LENGTH) {
        break;
      }
    }
  }
  return id;
}

/**
 * True for a value usable as the header. Storage adapters hand back whatever was written
 * (and JSON, and `null`), and a value with a newline in it makes `fetch` throw on the
 * header — which would take the whole translation down, not just the analytics.
 */
export function isUniqueId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && !/[^\x21-\x7e]/.test(value);
}

/**
 * The id this process/session settled on. Requests read it rather than the store snapshot
 * they were handed: a snapshot taken before hydration finished still says `null`, and
 * sending that would mint (and bill) a new user.
 */
let processUniqueId: string | null = null;

/** Records the id that the package resolved from its own persistent storage. */
export function setUniqueId(uniqueId: string | null | undefined): void {
  processUniqueId = isUniqueId(uniqueId) ? uniqueId : null;
}

export function getUniqueId(): string | null {
  return processUniqueId;
}

/**
 * The gate that closes the boot race.
 *
 * `init()` is async (device storage is async), but components mount and ask for
 * translations straight away. Without a gate those first requests go out during hydration
 * with an empty header, and each one becomes a new billed user on every app launch.
 * `init()` holds the gate while it resolves the id and releases it right after.
 */
let readyGate: Promise<void> | null = null;
let openReadyGate: (() => void) | null = null;

/** Holds every outbound request. Returns the release function; call it in a `finally`. */
export function holdRequestsUntilUniqueIdIsKnown(): () => void {
  if (!readyGate) {
    readyGate = new Promise<void>((resolve) => {
      openReadyGate = resolve;
    });
  }
  return releaseUniqueIdGate;
}

export function releaseUniqueIdGate(): void {
  const open = openReadyGate;
  openReadyGate = null;
  readyGate = null;
  open?.();
}

/** The promise to await before sending a request, or `null` when nothing is holding. */
export function whenUniqueIdIsKnown(): Promise<void> | null {
  return readyGate;
}

/**
 * The id to put in the header. Never returns an empty string: if the caller reaches this
 * point with nothing resolved, we mint the id ourselves and keep it for the rest of the
 * process, rather than let the server mint a throwaway one per request.
 */
export function resolveUniqueIdForRequest(storeUniqueId?: string | null): string {
  if (processUniqueId) {
    return processUniqueId;
  }
  if (isUniqueId(storeUniqueId)) {
    processUniqueId = storeUniqueId;
    return processUniqueId;
  }
  processUniqueId = generateUniqueId();
  return processUniqueId;
}

/** Test-only: not exported from the package index. */
export function resetUniqueIdState(): void {
  processUniqueId = null;
  sdkRuntime = "react-client";
  releaseUniqueIdGate();
}

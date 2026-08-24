/**
 * One shared fetch for every API call, with the resilience the bare `fetch` lacked:
 *
 * - a timeout (an app must never hang on a slow translation API),
 * - retries with backoff on network errors, 429 and 5xx (transient by nature),
 * - no retry on 4xx (a wrong key stays wrong — retrying only burns quota).
 *
 * Errors never throw out of here: the caller always receives `{ ok: false, error }` and
 * falls back to its stored translations — the app must never show empty text because the
 * API answered slowly.
 */
const TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [500, 1500];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url: string, options: RequestInit): Promise<any> {
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      // 304: the caller's copy is current — no body to parse, nothing to merge.
      if (res.status === 304) return { ok: true, notModified: true };
      if (res.status === 200) {
        const json = await res.json();
        // Surface the payload's ETag so the caller can replay it as If-None-Match.
        const etag = res.headers?.get?.("etag");
        if (etag && json && typeof json === "object") json.etag = etag;
        return json;
      }
      lastError = res.statusText || `HTTP ${res.status}`;
      // 4xx (except 429) is not transient: answer now, do not hammer the API.
      if (res.status < 500 && res.status !== 429) return { ok: false, error: lastError };
    } catch (err) {
      lastError = err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.message) : String(err);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
  }
  return { ok: false, error: lastError };
}

export const api = {
  fetchTranslation: fetchWithRetry,
  fetchTranslationsForOneLanguage: fetchWithRetry,
  fetchAllTranslationsForAllLanguages: fetchWithRetry,
  postLastUsedTranslations: fetchWithRetry,
};

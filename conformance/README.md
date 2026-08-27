# i18n-keyless conformance vectors

Language-neutral test vectors that every i18n-keyless SDK (TypeScript, PHP, Dart, Python,
Vue, Angular, browser, ...) replays. The rules they encode are specified in
[`docs/PROTOCOL.md`](../docs/PROTOCOL.md); the vectors are the executable half of that
document. When the reference implementation and a vector disagree, the vector is wrong or
the protocol changed: fix the vector and the spec together, then every port.

## Layout

```
conformance/
  README.md            this file
  vectors/*.json       one file per rule, each self-describing
```

The TypeScript reference replays them in
`packages/core/__tests__/conformance.test.ts` (`cd packages/core && npx vitest run`).

## File format

Every file is a JSON object with:

- `description`: what the rule is, in one paragraph;
- `source`: the reference function(s) in this repository;
- `cases[]`: the vectors. A case has a `name` (or is named by its input), an `input` and an
  `expected` value. Some files add `scenarios[]` for end-to-end replays and a few top-level
  constants (`concurrency`, `timeoutMs`, ...) that a port asserts against its own constants.

Conventions:

- `null` in an `input` means the value is absent (undefined, not passed).
- `expected: null` means the function returns nothing (undefined / None / null).
- Placeholders in expected headers: `$SDK_VERSION` is the port's own semantic version
  string (`>= 3.0.0`); `$DEVICE_ID` is any string matching `^[0-9A-Z_a-z]{16}$`.
- Expected request bodies are compared after JSON parsing: key order does not matter, and
  a field that would be undefined is absent.
- Expected header sets are exact: a port MUST send these headers and no other.

## Vector index

| File | Rule (PROTOCOL.md section) | Replayed by |
| --- | --- | --- |
| `storage-key.json` | storage key `key__context` (5.1) | core |
| `replace.json` | the `replace` option (5.2) | core |
| `translation-lookup.json` | synchronous resolution, translate-on-miss decision (5) | core |
| `namespace.json` | namespace and origin-language resolution (1, 4.1) | core |
| `resolve-lang.json` | `resolveLang` (14.3) | core |
| `languages.json` | the 48 codes, v2 to v3 renames (14.1, 14.2) | core |
| `app-store-locales.json` | `toAppStoreLocale` (14.4) | core |
| `backoff.json` | timeout, attempts, delays, end-to-end retry scenarios (3.4) | core |
| `retry-decision.json` | what each HTTP status does to one attempt (3.4) | core |
| `usage-reporting.json` | runtime, usage suppression, identity header (9, 10.1) | core |
| `unique-id.json` | device id shape and validity (10.2) | core |
| `queue.json` | queue id, dedupe, concurrency (6) | core |
| `translate-request.json` | `POST /translate` fixtures (4.1) | core |
| `dictionary-request.json` | `GET /translate/:lang` URL and headers, ETag replay (4.2, 7.2) | core |
| `dictionary-response.json` | 200 / 304 / error handling of a dictionary answer (3.4, 7.2) | core |
| `usage-request.json` | `POST /translate/last-used-translations` fixtures (4.4) | core |
| `storage-keys.json` | persistent storage keys, serialisation, hydration order (11) | wrapper packages (`packages/react/__tests__/utils.test.ts`) |

## Replaying in a port

1. Load every file in `vectors/` from this repository (vendor a copy, or read it at test
   time from a git submodule).
2. For each `cases[]` entry call the port's function named in `source` with `input` and
   compare with `expected`, following the conventions above.
3. For request fixtures (`translate-request`, `dictionary-request`, `usage-request`) stub
   the HTTP layer, run the real client operation, and compare URL, method, the exact header
   set and the parsed body.
4. For `backoff` and `dictionary-response` script the transport (status, headers, body,
   network error, timeout) and drive the clock: attempts, sleeps and the final result must
   match. Use fake time; the real schedule takes 2 s per failing call.
5. For `queue` run the port's translate-on-miss entry point for each call in a scenario
   and count the requests that leave. For the 31-key scenario block the transport and
   measure the peak number of in-flight requests.
6. `storage-keys.json` is for ports that persist: assert the key names and the clear rule.

A port is conformant when every vector passes and `docs/PORT_CHECKLIST.md` is complete.

## Adding a vector

1. Derive the expected value from the reference code, not from memory: run it.
2. Add the case to the right file; keep files small and single-purpose. Create a new file
   for a new rule and add it to the index above and to `conformance.test.ts`.
3. Update the matching section of `docs/PROTOCOL.md` in the same change.
4. Run `cd packages/core && npx vitest run` (the whole core suite, not only the
   conformance file).

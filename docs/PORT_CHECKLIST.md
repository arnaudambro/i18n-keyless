# Port checklist

What a new i18n-keyless SDK (PHP/Laravel, Ruby/Rails, Dart/Flutter, Python, Vue, Angular, browser, ...)
must ship before it is called conformant. Tick every box; link the evidence in the PR.

## 1. Protocol (`docs/PROTOCOL.md`)

- [ ] Configuration: the three modes in priority order, `API_KEY` always required,
      `API_URL` without a trailing slash, the language defaults (section 2).
- [ ] Transport: the exact header set (`Content-Type`, `Authorization: Bearer`, `Version`,
      `sdk`, `unique_id` on devices only, `If-None-Match` when known), 10 s timeout, 3
      attempts, 500 ms then 1500 ms backoff, retry only on network error / timeout / 429 /
      5xx, never throw, never clear the stored copy (section 3).
- [ ] The four endpoints with the exact bodies, the `default` namespace omitted on the
      wire, `originLanguage` omitted when equal to the primary (section 4).
- [ ] Resolution: `key__context`, the primary / origin short-circuit, empty translation is a
      miss, `replace` semantics including the empty-replacement rule, trimming only in the
      component path (section 5).
- [ ] Queue: concurrency 30, id `namespace:key`, in-flight dedupe, `empty` event triggers
      the bulk fetch of the recorded namespaces only (section 6).
- [ ] Bulk fetch: cursor written as `null` on a first fetch, in-memory ETag map keyed by
      (API key, language, namespace), 304 keeps the stored copy, merge rules (section 7).
- [ ] Language switch and boot: validation against `supported` with `fallback`, cursor
      reset, full fetch per known namespace, `originNamespaces` fetched in the primary
      language (section 8).
- [ ] Usage analytics: recorded per render on devices, sent once per init, suppressed on a
      server, `YYYY-MM-DD` UTC dates keyed by namespace (section 9).
- [ ] Identity: 16-character id from the 63-character alphabet, persisted first at boot,
      boot gate, never an empty `unique_id`, no id from a server, `sdk` header value
      (section 10).
- [ ] Storage: the exact key names and serialisations, hydration order, the device id
      survives a cache clear (section 11). Ports with no persistent storage (server SDKs)
      skip this box and document it.
- [ ] Languages: the 48 codes, `cn` / `cz` never sent, `resolveLang`, `toAppStoreLocale`
      (section 14).
- [ ] Known limitations reproduced as listed (section 15), or a documented, agreed
      divergence.

## 2. Conformance vectors (`conformance/`)

- [ ] Every file in `conformance/vectors/` is replayed by the port's test suite and green.
- [ ] `storage-keys.json` replayed when the port persists.
- [ ] The vectors are read from this repository (vendored copy with the commit hash, or a
      submodule), not retyped.

## 3. Agent and documentation files

- [ ] `SKILL.md` for the port, same structure as `skills/i18n-keyless/SKILL.md`: install,
      initialise, the two ways to render a string, the per-translation options, the server
      traps, the gotchas.
- [ ] `llms.txt` for the port, or a section added to the root `llms.txt`, that an agent can
      paste into a context window.
- [ ] README with a **5-line quick start**: install, init with `API_KEY` and `languages`,
      render one string, switch language, run.
- [ ] README documents the storage adapter (when any), the server / SSR behaviour and the
      `Version` value the port sends.

## 4. Example app

- [ ] A runnable two-page example under `examples/<port>` showing init, the component /
      template path, the imperative function, `context`, `replace` and a language switcher.
- [ ] The example runs against the real service with an API key and offline against
      `examples/_mock-server`.
- [ ] The example has a passing test.

## 5. Usage analytics wired

- [ ] A device port records usage per render and sends it once per init, from the client
      only, with the `unique_id` header.
- [ ] A server port sends usage on the 10 s debounce with `sdk: node` (or the value agreed
      with the API, see PROTOCOL.md section 16 item 2) and no `unique_id`.
- [ ] Verified against the dashboard: one active user per device, not one per request.

## 6. Release

- [ ] Version string `>= 3.0.0` sent as `Version`; the port's version tracks the protocol
      revision it implements.
- [ ] CHANGELOG entry that names the protocol revision (`PROTOCOL.md` reference version).
- [ ] The `TODO: verify against the API` items that the port depends on are resolved, and
      the answers are written back into `docs/PROTOCOL.md`.

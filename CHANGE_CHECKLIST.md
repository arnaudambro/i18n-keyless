# Change checklist

One wire protocol (`docs/PROTOCOL.md`), six npm packages (`packages/`), seven ports
(`ports/`), and a handful of files that repeat the same facts in prose: the skills, the
READMEs, the changelogs, the examples. A change rarely stops at one file. Below, for each
kind of change, the places to touch and the test that fails when one is forgotten.

## A behaviour change in core

- [ ] `conformance/vectors/*.json`: add or change the case. Every port replays the same files.
- [ ] `docs/PROTOCOL.md`: the section that states the rule.
- [ ] Every port under `ports/`: the implementation and its conformance suite.
- [ ] The vue, angular and browser packages: each has its own `store.ts`, not a wrapper of react.
- Gate: `packages/core/__tests__/conformance.test.ts` (core replays the vectors),
  `vectors-coverage.test.ts` (every suite names every vector, or says why not), and each
  port's own conformance suite with its own toolchain (`CLAUDE.md`).

## A new option or public symbol

- [ ] `I18nConfig` in `packages/react/types.ts`, `vue/types.ts`, `angular/types.ts`,
      `browser/types.ts`: four hand-kept copies.
- [ ] `index.ts` of react, vue, angular, browser: the export.
- [ ] `skills/i18n-keyless/SKILL.md` (react, node) and the `SKILL.md` of every other package and port.
- [ ] `README.md` at the root and the package or port README.
- [ ] `examples/`: the app of each framework the option applies to.
- [ ] `CHANGELOG.md` under `## [Unreleased]`.
- Gate: `packages/core/__tests__/surface-parity.test.ts` (config fields and exports equal
  across the four packages, exceptions listed with a reason); the documentation suite in the
  `i18n-keyless-saas` repository (imported symbols exist, code fences compile).

## A new endpoint, header, or wire change

- [ ] `docs/PROTOCOL.md` sections 3 and 4, and `conformance/vectors/*-request.json`.
- [ ] `packages/core` (`service.ts`, `api.ts`, `unique-id.ts`) and every port's HTTP client.
- [ ] A new `sdk` label: `packages/core/unique-id.ts`, `conformance/vectors/usage-reporting.json`,
      `docs/PROTOCOL.md` sections 3.2 and 10.1, and `api-express/src/middlewares/user-count.ts`
      in the `i18n-keyless-saas` repository.
- [ ] `examples/_mock-server/server.mjs`: the offline server the examples run against.
- [ ] The `i18n-keyless-saas` repository: the `api-express` controller, its wire-contract
      tests, and the docs site.
- Gate: `packages/core/__tests__/docs-contract.test.ts` (PROTOCOL.md and `SdkRuntime`
  against `usage-reporting.json`), `conformance.test.ts`.

## A new port

- [ ] `docs/PORT_CHECKLIST.md`, every box.
- [ ] `ports/<name>/SKILL.md`, and a row in the "Other frameworks" table of `skills/i18n-keyless/SKILL.md`.
- [ ] `examples/<name>` with a passing test; `CLAUDE.md` (package table, test command).
- [ ] `scripts/set-version.mjs`, `scripts/publish.mjs`, `PUBLISH.md`: the version constant and the publish step.
- [ ] `packages/core/__tests__/vectors-coverage.test.ts`: add the suite file to `SUITES`.
- [ ] `packages/core/__tests__/release-preflight.test.ts`: the version site and the changelog.
- Gate: `docs-contract.test.ts` (the skills table), `release-preflight.test.ts`.

## A release

- [ ] `node scripts/set-version.mjs x.y.z`: the root, the six packages, the core pin, the ports.
- [ ] `CHANGELOG.md`: `## [Unreleased]` becomes `## [x.y.z] — date`, once; and
      `ports/{flutter,python,go,swift,kotlin}/CHANGELOG.md` get `## x.y.z`.
- [ ] `PUBLISH.md`, then `node scripts/publish.mjs --dry-run`.
- [ ] After the publish: bump `i18n-keyless-*` in the docs of the `i18n-keyless-saas`
      repository and run its documentation suite.
- Gate: `packages/core/__tests__/release-preflight.test.ts` on every test run, and the
  preflight of `scripts/publish.mjs`.

## Never edit here

- `llms.txt` at the root is a mirror, written by `npm run docs:sync` in the `i18n-keyless-saas`
  repository. Change the source there.

Run: `npm run test` at the root fans out to every npm package; the ports run with their own
toolchains (see `CLAUDE.md`).

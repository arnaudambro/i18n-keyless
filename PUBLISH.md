# Publishing

One version for everything: the six npm packages, the Flutter port and the Laravel port.
Today it is `3.4.0`. Every release bumps all of them, even a package with no change:
the wire `Version` header and the `i18n-keyless-core` pin must agree.

## What publishes where

| Package | Registry | Command | Runs its own tests before publishing |
| --- | --- | --- | --- |
| `i18n-keyless-core` | npm | `npm publish` (root) | yes, `prepublishOnly` |
| `i18n-keyless-react` | npm | same | yes |
| `i18n-keyless-node` | npm | same | yes |
| `i18n-keyless-vue` | npm | same | yes |
| `i18n-keyless-angular` | npm | same (builds with `ngc`) | yes |
| `i18n-keyless-browser` | npm | same | yes |
| `i18n_keyless` (Flutter) | pub.dev | `flutter pub publish` in `ports/flutter` | no: run `flutter test` first |
| `i18n-keyless/laravel` | Packagist | git tag on a mirror repo | no: run `vendor/bin/phpunit` first |

`.npmrc` sets `workspaces=true`, so a bare `npm publish` at the root publishes every
workspace, in alphabetical order: angular, browser, core, node, react, vue. Each package's
`prepublishOnly` cleans `dist`, builds, runs its vitest suite and packs. A red suite stops
that package (and the ones after it).

## One-time setup

- npm: `npm whoami` must answer (else `npm login`). The three new names are free.
- pub.dev: `flutter pub publish` opens a browser the first time to sign in with a Google
  account. The publisher is that account until you create a verified publisher on pub.dev.
- Packagist: Packagist reads `composer.json` at the ROOT of a git repository, so the
  Laravel port needs a mirror repository. Create an empty GitHub repo
  `arnaudambro/i18n-keyless-laravel`, then in this repo:

  ```bash
  git remote add laravel git@github.com:arnaudambro/i18n-keyless-laravel.git
  ```

  After the first push (step 5 below), submit `https://github.com/arnaudambro/i18n-keyless-laravel`
  on https://packagist.org/packages/submit once, and enable the GitHub hook it proposes.
  Later tags are picked up on their own.
- Toolchains: Node, PHP 8.5 + Composer, Flutter (all installed on this machine, 2026-08-26).

## Release steps

### 1. Version and changelog

```bash
node scripts/set-version.mjs 3.4.0            # 10 files: package.json x7, pubspec, version.dart, ApiClient.php
node scripts/set-version.mjs 3.4.0 --dry-run  # to see the list first
```

Then:

- `CHANGELOG.md`: rename `## [Unreleased]` to `## [3.4.0] - YYYY-MM-DD`.
- `ports/flutter/CHANGELOG.md`: add a `## 3.4.0` entry (pub.dev shows it on the package page).

### 2. Build core first

The publish order is alphabetical, so `angular` and `browser` build against
`packages/core/dist` BEFORE core's own `prepublishOnly` rebuilds it. A stale `dist` ships
the old `Version` constant. Rebuild it by hand first:

```bash
(cd packages/core && rm -rf dist && npx tsc --project tsconfig.json)
```

### 3. Test everything

```bash
for p in core react node vue angular browser; do (cd packages/$p && npx vitest run) || break; done
(cd ports/laravel && vendor/bin/phpunit)
(cd ports/flutter && flutter analyze && flutter test)
```

### 4. npm (six packages)

```bash
npm publish
```

If a package fails half-way, the packages before it are already on npm. Fix, then publish
the rest one by one:

```bash
npm publish -w packages/react     # one workspace
```

`npm publish --dry-run --ignore-scripts` lists the order without building anything.

### 5. Flutter (pub.dev)

```bash
cd ports/flutter
flutter pub publish --dry-run     # must report 0 warnings
flutter pub publish               # asks for a confirmation, then uploads
```

pub.dev has no unpublish. A bad version can only be retracted from the package admin page
within 7 days, then replaced by a new version.

### 6. Laravel (Packagist, via the mirror)

Packagist versions are git tags on the mirror repo. Push the subtree, then the tag:

```bash
# from the repo root, after the release commit exists on main
git subtree push --prefix=ports/laravel laravel main
SPLIT=$(git subtree split --prefix=ports/laravel main)
test -n "$SPLIT" && git push laravel "$SPLIT":refs/tags/v3.4.0
```

`git subtree split` prints a commit hash; it creates no branch. Packagist picks the tag up
through the GitHub hook (or press "Update" on the package page).

Two traps in the last line, both of which have already happened once:

- Keep `refs/tags/...` OUTSIDE the quotes. In zsh, `"$SPLIT:refs/tags/v3.4.0"` applies the
  history modifier `:r` to the variable, so the refspec becomes `<hash>efs/tags/v3.4.0`
  and the push fails with `src refspec ... does not match any`.
- Keep the `test -n "$SPLIT"` guard, and run the three lines in the SAME shell. With an
  empty `SPLIT`, the refspec reads `:refs/tags/v3.4.0`, which **deletes** the tag on the
  mirror. Recover with `git push laravel <hash>:refs/tags/v3.4.0`.

### 7. Commit and tag the monorepo

```bash
git add -A
git commit -m "chore: release 3.4.0"
git tag v3.4.0
git push && git push --tags
```

The push to `main` triggers `.github/workflows/context7-refresh.yml`, which re-indexes the
docs for agents.

### 8. Check

```bash
npm view i18n-keyless-vue version
npm view i18n-keyless-angular version
npm view i18n-keyless-browser version
open https://pub.dev/packages/i18n_keyless
open https://packagist.org/packages/i18n-keyless/laravel
```

## Rollback

- npm: `npm unpublish <name>@<version>` within 72 hours, then publish a fixed version.
  After 72 hours, `npm deprecate <name>@<version> "reason"` and publish a fix.
- pub.dev: retract the version on its page, publish a fix.
- Packagist: delete the tag on the mirror (`git push laravel :refs/tags/v3.4.0`) and press
  "Update" on the package page.

# Publishing

One version for everything: the six npm packages and the seven ports (Flutter, Laravel,
Rails, Python, Go, Swift, Kotlin).
Today it is `3.6.1`. Every release bumps all of them, even a package with no change:
the wire `Version` header and the `i18n-keyless-core` pin must agree.

## The script

```bash
node scripts/set-version.mjs 3.6.1     # 1. the version, in 17 files
# 2. CHANGELOG.md: rename "## [Unreleased]"; ports/{flutter,python,go,swift,kotlin}/CHANGELOG.md: add "## 3.6.1"
node scripts/publish.mjs --dry-run     # 3. preflight, build, every test suite, publish dry runs
node scripts/publish.mjs               # 4. the release, one confirmation per step
```

`scripts/publish.mjs` runs the steps below in order and asks before each upload. It skips
what is already done (a package at this version on npm or pub.dev, an existing tag), so
after a failure you fix the cause and run it again. Flags: `--yes` (no questions),
`--skip-tests`, `--skip-npm`, `--skip-flutter`, `--skip-laravel`, `--skip-rails`, `--skip-python`,
`--skip-go`, `--skip-swift`, `--skip-kotlin`, `--skip-git`.

The rest of this file is the same procedure by hand, and the reasons behind each step.

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
| `i18n-keyless-rails` | RubyGems | `gem build` + `gem push` in `ports/rails` | no: run `bundle exec rake test` first |
| `i18n-keyless` (Python) | PyPI | `uv build` + `uv publish` in `ports/python` | no: run `uv run pytest` first |
| `github.com/arnaudambro/i18n-keyless/ports/go/v3` | the Go proxy | git tag `ports/go/vX.Y.Z` on this repo, pushed | no: run `go test ./...` first |
| `I18nKeyless` (Swift) | SwiftPM | git tag on the `i18n-keyless-swift` mirror repo | no: run `swift test` first |
| `io.github.arnaudambro:i18n-keyless-kotlin` | Maven Central | `./gradlew publish` in `ports/kotlin` | no: run `./gradlew test` first |

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
- RubyGems: `gem signin` once (the gemspec sets `rubygems_mfa_required`, so the account
  needs MFA). The name `i18n-keyless-rails` is free.
- PyPI: create an API token on https://pypi.org/manage/account/token/ and export it as
  `UV_PUBLISH_TOKEN` (or answer `uv publish`'s prompt). The name `i18n-keyless` is free.
- Go: nothing to create. The proxy (`proxy.golang.org`) fetches the module the first time
  someone runs `go get`, from the tag `ports/go/vX.Y.Z` on this repository. The `/v3` suffix
  in the module path is what Go requires for a major >= 2.
- SwiftPM: like Packagist, SwiftPM needs `Package.swift` at the ROOT of a git repository, so
  the Swift port has a mirror. Create an empty GitHub repo `arnaudambro/i18n-keyless-swift`,
  then in this repo:

  ```bash
  git remote add swift git@github.com:arnaudambro/i18n-keyless-swift.git
  ```

  Users add `https://github.com/arnaudambro/i18n-keyless-swift` in Xcode or `Package.swift`.
- Maven Central: register the namespace `io.github.arnaudambro` on
  https://central.sonatype.com (verified through the GitHub account), create a user token,
  and a GPG key for signing. Put them in `~/.gradle/gradle.properties`:

  ```properties
  mavenCentralUsername=<token user>
  mavenCentralPassword=<token password>
  signingInMemoryKey=<the armored private key, newlines as \n: gpg --export-secret-keys --armor <id>>
  signingInMemoryKeyId=<last 8 hex of the key>
  signingInMemoryKeyPassword=<passphrase>
  ```

  `ports/kotlin/build.gradle.kts` uses the `com.vanniktech.maven.publish` plugin, which
  reads exactly these names; without `signingInMemoryKey` it skips signing, so a local
  `publishToMavenLocal` works on any machine.
- Toolchains: Node, PHP 8.5 + Composer, Flutter, Ruby 3.4 + Bundler (installed 2026-09-02),
  Go, Kotlin, Gradle (Homebrew, 2026-09-03), Python 3.13 + uv, Xcode's Swift.

## Release steps

### 1. Version and changelog

```bash
node scripts/set-version.mjs 3.4.0            # 17 files: package.json x7, pubspec, version.dart, ApiClient.php, version.rb, version.py, version.go, Version.swift, Version.kt, build.gradle.kts
node scripts/set-version.mjs 3.4.0 --dry-run  # to see the list first
```

Then:

- `CHANGELOG.md`: rename `## [Unreleased]` to `## [3.4.0] - YYYY-MM-DD`.
- `ports/flutter/CHANGELOG.md`: add a `## 3.4.0` entry (pub.dev shows it on the package page).
- `ports/python`, `ports/go`, `ports/swift`, `ports/kotlin`: the same `## 3.4.0` entry in each
  `CHANGELOG.md` (the preflight checks all five).

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
(cd ports/rails && bundle exec rake test)
(cd ports/flutter && flutter analyze && flutter test)
(cd ports/python && uv run pytest)
(cd ports/go && go vet ./... && go test ./...)
(cd ports/swift && swift test)
(cd ports/kotlin && ./gradlew test)
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

### 7. Rails (RubyGems)

The gem builds from `ports/rails` (no mirror: RubyGems takes a `.gem` file):

```bash
cd ports/rails
gem build i18n-keyless-rails.gemspec     # i18n-keyless-rails-3.5.0.gem
gem push i18n-keyless-rails-3.5.0.gem    # asks for the MFA code
rm i18n-keyless-rails-3.5.0.gem
```

`lib/i18n_keyless/version.rb` is the version RubyGems reads (written by `set-version.mjs`).

### 7b. Python (PyPI)

```bash
cd ports/python
rm -rf dist && uv build          # dist/i18n_keyless-3.6.1-py3-none-any.whl + the sdist
uv publish                       # UV_PUBLISH_TOKEN, or the prompt
```

PyPI never reuses a version number: a deleted release cannot be re-uploaded.

### 7c. Kotlin (Maven Central)

```bash
cd ports/kotlin
./gradlew build publishToMavenLocal   # proves the artifact, the POM and the sources jar
./gradlew publishToMavenCentral       # signs and uploads the bundle to the Central Portal
```

Then validate and release the deployment on https://central.sonatype.com/publishing (the
portal holds it until you press "Publish"). A released version is permanent.

### 8. Commit and tag the monorepo

```bash
git add -A
git commit -m "chore: release 3.4.0"
git tag v3.4.0
git tag ports/go/v3.4.0            # the Go module's version (the module lives in a subdirectory)
git push && git push --tags
```

The push to `main` triggers `.github/workflows/context7-refresh.yml`, which re-indexes the
docs for agents.

### 8b. Swift (SwiftPM, via the mirror)

Same mechanics as Laravel, on the `swift` remote, with the same two zsh traps:

```bash
git subtree push --prefix=ports/swift swift main
SPLIT=$(git subtree split --prefix=ports/swift main)
test -n "$SPLIT" && git push swift "$SPLIT":refs/tags/v3.4.0
```

SwiftPM accepts `v3.4.0` and `3.4.0` as a version tag; the script uses `v3.4.0`.

### 9. Check

```bash
npm view i18n-keyless-vue version
npm view i18n-keyless-angular version
npm view i18n-keyless-browser version
open https://pub.dev/packages/i18n_keyless
open https://packagist.org/packages/i18n-keyless/laravel
gem search -r i18n-keyless-rails --exact
open https://pypi.org/project/i18n-keyless/
open https://pkg.go.dev/github.com/arnaudambro/i18n-keyless/ports/go/v3
open https://github.com/arnaudambro/i18n-keyless-swift/tags
open https://central.sonatype.com/artifact/io.github.arnaudambro/i18n-keyless-kotlin
```

## Rollback

- npm: `npm unpublish <name>@<version>` within 72 hours, then publish a fixed version.
  After 72 hours, `npm deprecate <name>@<version> "reason"` and publish a fix.
- pub.dev: retract the version on its page, publish a fix.
- Packagist: delete the tag on the mirror (`git push laravel :refs/tags/v3.4.0`) and press
  "Update" on the package page.
- RubyGems: `gem yank i18n-keyless-rails -v 3.4.0` (the version number stays taken), then
  publish a fix.
- PyPI: delete the release on the project page (the number stays taken), publish a fix.
- Go: a tag, once fetched by the proxy, is cached forever: publish `ports/go/v3.4.1`. Use
  `retract` in `go.mod` to mark the bad version.
- SwiftPM: delete the tag on the mirror (`git push swift :refs/tags/v3.4.0`), publish a fix.
- Maven Central: a released version cannot be removed; publish a fix.

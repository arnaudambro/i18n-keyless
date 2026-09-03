#!/usr/bin/env node
/**
 * Release everything at the version already written in `package.json` (see
 * `scripts/set-version.mjs`): the six npm packages, the Flutter port on pub.dev, the
 * Laravel port on Packagist (a tag on the mirror repository), the Rails port on RubyGems,
 * then the monorepo commit, tag and push. It is the executable form of `PUBLISH.md`; read that file for the why.
 *
 *   node scripts/publish.mjs                 # the whole release, one confirmation per step
 *   node scripts/publish.mjs --dry-run       # preflight, build, tests, publish dry runs; no commit
 *   node scripts/publish.mjs --yes           # no confirmations
 *   node scripts/publish.mjs --skip-tests    # trust the last run
 *   node scripts/publish.mjs --skip-flutter --skip-laravel --skip-rails --skip-git
 *
 * Every step is safe to run again: a package already at this version on its registry is
 * skipped, a tag that exists is not recreated, so a release that failed half-way is
 * resumed by running the script once more.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const flag = (name) => args.has(`--${name}`);
const dryRun = flag("dry-run");
const yes = flag("yes");

const NPM_PACKAGES = ["core", "react", "node", "vue", "angular", "browser"]; // core FIRST
const known = ["dry-run", "yes", "skip-tests", "skip-npm", "skip-flutter", "skip-laravel", "skip-rails", "skip-git"];
for (const a of args) {
  if (!known.includes(a.replace(/^--/, ""))) {
    console.error(`unknown flag ${a}\nusage: node scripts/publish.mjs [${known.map((k) => `--${k}`).join("] [")}]`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------------------
// helpers

function read(relPath) {
  return readFileSync(resolve(root, relPath), "utf8");
}

/** Run a command, streaming its output; throws on a non-zero exit. */
function run(cmd, cmdArgs, { cwd = root, env } = {}) {
  console.log(`\n$ ${[cmd, ...cmdArgs].join(" ")}${cwd === root ? "" : `   (in ${cwd.replace(root + "/", "")})`}`);
  const result = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(" ")} exited with ${result.status ?? result.signal}`);
  }
}

/** Run a command and return its stdout; returns null on a non-zero exit. */
function capture(cmd, cmdArgs, { cwd = root } = {}) {
  try {
    return execFileSync(cmd, cmdArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function step(title) {
  console.log(`\n${"=".repeat(80)}\n${title}\n${"=".repeat(80)}`);
}

/**
 * One readline interface per question, closed right after the answer: a long-lived one
 * keeps stdin open, so the child processes that inherit stdio (`flutter pub publish`,
 * `git`) cannot read their own prompts, and the script never exits on its own.
 */
async function confirm(question) {
  if (yes || dryRun) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function fail(message) {
  console.error(`\npublish: ${message}`);
  process.exit(1);
}

async function publishedOnRubyGems(version) {
  try {
    const res = await fetch("https://rubygems.org/api/v1/versions/i18n-keyless-rails.json");
    if (!res.ok) return false;
    const json = await res.json();
    return (Array.isArray(json) ? json : []).some((v) => v.number === version);
  } catch {
    return false;
  }
}

async function publishedOnPubDev(version) {
  try {
    const res = await fetch("https://pub.dev/api/packages/i18n_keyless");
    if (!res.ok) return false;
    const json = await res.json();
    return (json.versions ?? []).some((v) => v.version === version);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------
// 0. preflight

const version = JSON.parse(read("package.json")).version;
const tag = `v${version}`;
step(`Release ${version}${dryRun ? " (dry run)" : ""}`);

const problems = [];

// The one shared version, everywhere `set-version.mjs` writes it.
for (const name of NPM_PACKAGES) {
  const pkg = JSON.parse(read(`packages/${name}/package.json`));
  if (pkg.version !== version) problems.push(`packages/${name}/package.json is at ${pkg.version}`);
  const pin = pkg.dependencies?.["i18n-keyless-core"];
  if (name !== "core" && pin !== version) problems.push(`packages/${name} pins i18n-keyless-core ${pin}`);
}
if (!new RegExp(`^version:\\s*${version.replace(/\./g, "\\.")}\\s*$`, "m").test(read("ports/flutter/pubspec.yaml"))) {
  problems.push("ports/flutter/pubspec.yaml has another version");
}
if (!read("ports/flutter/lib/src/core/version.dart").includes(`'${version}'`)) {
  problems.push("ports/flutter/lib/src/core/version.dart has another version");
}
if (!read("ports/laravel/src/ApiClient.php").includes(`VERSION = '${version}'`)) {
  problems.push("ports/laravel/src/ApiClient.php has another VERSION");
}
if (!read("ports/rails/lib/i18n_keyless/version.rb").includes(`VERSION = "${version}"`)) {
  problems.push("ports/rails/lib/i18n_keyless/version.rb has another VERSION");
}
if (problems.length) {
  problems.push(`run: node scripts/set-version.mjs ${version}`);
}

// Changelogs: the release notes must exist before anything is uploaded.
if (!read("CHANGELOG.md").includes(`## [${version}]`)) {
  problems.push(`CHANGELOG.md has no "## [${version}]" section (rename "## [Unreleased]")`);
}
if (!new RegExp(`^## ${version.replace(/\./g, "\\.")}\\s*$`, "m").test(read("ports/flutter/CHANGELOG.md"))) {
  problems.push(`ports/flutter/CHANGELOG.md has no "## ${version}" entry (pub.dev shows it)`);
}

// Git: on main, tag free, remotes present.
const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") problems.push(`on branch ${branch}, releases go from main`);
const tagExists = capture("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]) !== null;
if (tagExists && !flag("skip-git")) {
  console.log(`note: tag ${tag} already exists locally; the git step will not recreate it`);
}
if (!flag("skip-laravel") && capture("git", ["remote", "get-url", "laravel"]) === null) {
  problems.push("no `laravel` git remote (see PUBLISH.md, one-time setup)");
}

// Registries: logged in, and which packages are still to publish.
// `workspaces=true` in .npmrc makes `npm whoami` fail with ENOWORKSPACES at the root.
const npmUser = capture("npm", ["whoami", "--workspaces=false"]);
if (!flag("skip-npm") && !npmUser) problems.push("npm whoami failed: run `npm login`");

const toPublish = [];
for (const name of NPM_PACKAGES) {
  const published = capture("npm", ["view", `i18n-keyless-${name}@${version}`, "version", "--workspaces=false"]);
  if (published === version) console.log(`already on npm: i18n-keyless-${name}@${version}`);
  else toPublish.push(name);
}
const flutterDone = flag("skip-flutter") ? false : await publishedOnPubDev(version);
if (flutterDone) console.log(`already on pub.dev: i18n_keyless ${version}`);
const railsDone = flag("skip-rails") ? false : await publishedOnRubyGems(version);
if (railsDone) console.log(`already on rubygems.org: i18n-keyless-rails ${version}`);

if (problems.length) {
  fail(`preflight failed:\n  - ${problems.join("\n  - ")}`);
}
console.log(`\npreflight ok: ${version}, npm user ${npmUser ?? "(skipped)"}, tag ${tag}`);

// ---------------------------------------------------------------------------------------
// 1. build core (angular and browser build against packages/core/dist)

step("Build core");
run("rm", ["-rf", "dist"], { cwd: resolve(root, "packages/core") });
run("npx", ["tsc", "--project", "tsconfig.json"], { cwd: resolve(root, "packages/core") });

// ---------------------------------------------------------------------------------------
// 2. tests

if (flag("skip-tests")) {
  console.log("\ntests skipped (--skip-tests)");
} else {
  step("Tests");
  for (const name of NPM_PACKAGES) {
    run("npx", ["vitest", "run"], { cwd: resolve(root, `packages/${name}`) });
  }
  if (!flag("skip-laravel")) {
    const laravel = resolve(root, "ports/laravel");
    if (!existsSync(resolve(laravel, "vendor"))) run("composer", ["install"], { cwd: laravel });
    run("vendor/bin/phpunit", [], { cwd: laravel });
  }
  if (!flag("skip-rails")) {
    const rails = resolve(root, "ports/rails");
    run("bundle", ["install", "--quiet"], { cwd: rails });
    run("bundle", ["exec", "rake", "test"], { cwd: rails });
  }
  if (!flag("skip-flutter")) {
    const flutter = resolve(root, "ports/flutter");
    run("flutter", ["analyze"], { cwd: flutter });
    run("flutter", ["test"], { cwd: flutter });
  }
}

// ---------------------------------------------------------------------------------------
// 3. npm, core first so every later package builds against the fresh dist

if (flag("skip-npm")) {
  console.log("\nnpm skipped (--skip-npm)");
} else if (toPublish.length === 0) {
  console.log(`\nnpm: every package is already at ${version}`);
} else {
  step(`npm: ${toPublish.map((n) => `i18n-keyless-${n}`).join(", ")}`);
  if (!(await confirm(`Publish ${toPublish.length} package(s) to npm?`))) fail("stopped before npm");
  for (const name of toPublish) {
    const publishArgs = ["publish", "-w", `packages/${name}`];
    if (dryRun) publishArgs.push("--dry-run");
    run("npm", publishArgs);
  }
}

// ---------------------------------------------------------------------------------------
// 4. Flutter (pub.dev has no unpublish: a bad version can only be retracted for 7 days)

if (flag("skip-flutter")) {
  console.log("\nflutter skipped (--skip-flutter)");
} else if (flutterDone) {
  console.log(`\npub.dev: i18n_keyless is already at ${version}`);
} else {
  step("pub.dev: i18n_keyless");
  const flutter = resolve(root, "ports/flutter");
  run("flutter", ["pub", "publish", "--dry-run"], { cwd: flutter });
  if (!dryRun) {
    if (!(await confirm("Publish i18n_keyless to pub.dev? (no unpublish)"))) fail("stopped before pub.dev");
    run("flutter", ["pub", "publish", "--force"], { cwd: flutter });
  }
}

// ---------------------------------------------------------------------------------------
// 4b. Rails: RubyGems takes a .gem file built from ports/rails (no mirror). A yanked
//     version number stays taken, so the build is checked before anything is pushed.

if (flag("skip-rails")) {
  console.log("\nrails skipped (--skip-rails)");
} else if (railsDone) {
  console.log(`\nrubygems.org: i18n-keyless-rails is already at ${version}`);
} else {
  step("RubyGems: i18n-keyless-rails");
  const rails = resolve(root, "ports/rails");
  const gemFile = `i18n-keyless-rails-${version}.gem`;
  run("gem", ["build", "i18n-keyless-rails.gemspec"], { cwd: rails });
  if (!dryRun) {
    if (!(await confirm("Publish i18n-keyless-rails to rubygems.org?"))) fail("stopped before rubygems.org");
    run("gem", ["push", gemFile], { cwd: rails });
  }
  run("rm", ["-f", gemFile], { cwd: rails });
}

// ---------------------------------------------------------------------------------------
// 5. git: release commit and tag on the monorepo. The Laravel step needs that commit,
//    because the subtree split reads `main`.

if (flag("skip-git") || dryRun) {
  console.log(`\ngit ${dryRun ? "commit/tag skipped (dry run)" : "skipped (--skip-git)"}`);
} else {
  step("git: release commit and tag");
  const dirty = capture("git", ["status", "--porcelain"]);
  if (dirty) {
    run("git", ["status", "--short"]);
    if (!(await confirm(`Commit everything above as "chore: release ${version}"?`))) fail("stopped before the commit");
    run("git", ["add", "-A"]);
    run("git", ["commit", "-m", `chore: release ${version}`]);
  } else {
    console.log("working tree clean: nothing to commit");
  }
  if (tagExists) console.log(`tag ${tag} exists`);
  else run("git", ["tag", tag]);
}

// ---------------------------------------------------------------------------------------
// 6. Laravel: Packagist reads tags on the mirror repository. No shell here, so the two
//    traps in PUBLISH.md (zsh `:r` modifier, empty SPLIT deleting the tag) cannot happen.

if (flag("skip-laravel") || dryRun) {
  console.log(`\nlaravel ${dryRun ? "mirror skipped (dry run)" : "skipped (--skip-laravel)"}`);
} else {
  step("Packagist: i18n-keyless/laravel");
  const mirrorTag = capture("git", ["ls-remote", "--tags", "laravel", `refs/tags/${tag}`]);
  if (mirrorTag) {
    console.log(`mirror already has ${tag}`);
  } else {
    if (!(await confirm(`Push ports/laravel to the mirror and tag it ${tag}?`))) fail("stopped before the mirror");
    run("git", ["subtree", "push", "--prefix=ports/laravel", "laravel", "main"]);
    const split = capture("git", ["subtree", "split", "--prefix=ports/laravel", "main"]);
    if (!split || !/^[0-9a-f]{40}$/.test(split)) fail(`git subtree split returned "${split}", not a commit`);
    run("git", ["push", "laravel", `${split}:refs/tags/${tag}`]);
  }
}

// ---------------------------------------------------------------------------------------
// 7. push the monorepo (triggers the Context7 refresh workflow)

if (!flag("skip-git") && !dryRun) {
  step("git push");
  if (await confirm("Push main and the tags to origin?")) {
    run("git", ["push"]);
    run("git", ["push", "--tags"]);
  } else {
    console.log("not pushed: run `git push && git push --tags` yourself");
  }
}

// ---------------------------------------------------------------------------------------
// 8. check

step("Check");
for (const name of NPM_PACKAGES) {
  const v = capture("npm", ["view", `i18n-keyless-${name}`, "version", "--workspaces=false"]);
  const mark = v === version ? "" : dryRun ? "  (dry run)" : `  <-- NOT ${version}`;
  console.log(`${`i18n-keyless-${name}`.padEnd(24)} ${v ?? "?"}${mark}`);
}
console.log(`i18n_keyless (pub.dev)   ${(await publishedOnPubDev(version)) ? version : dryRun ? "(dry run)" : `<-- NOT ${version}`}`);
console.log(`i18n-keyless-rails (gem) ${(await publishedOnRubyGems(version)) ? version : dryRun ? "(dry run)" : `<-- NOT ${version}`}`);
console.log("\nhttps://pub.dev/packages/i18n_keyless\nhttps://packagist.org/packages/i18n-keyless/laravel\nhttps://rubygems.org/gems/i18n-keyless-rails");
console.log("\nThen in i18n-keyless-saas/docs: bump i18n-keyless-* to the new version, npm install, npm test.");

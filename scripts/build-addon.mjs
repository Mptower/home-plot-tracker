/**
 * Stages the compiled application into the Home Assistant add-on's Docker build
 * context, and guards the two things about that context that are easy to break.
 *
 * Supervisor builds an add-on with the add-on directory as the build context,
 * so `addon/Dockerfile` cannot reach up into `server/` or `client/`. Everything
 * the image needs has to be inside `addon/` first. This script puts it there,
 * and the result is committed, because Supervisor clones this repository and
 * builds it as-is — there is no CI step between the clone and the build.
 *
 * What lands in `addon/rootfs/app/`:
 *
 *   server/            server/dist/src, minus source maps
 *   client/            client/dist, verbatim
 *   shared/            shared/dist, JavaScript only, plus a generated manifest
 *   package.json       a production manifest: Express and a `file:` link to shared/
 *   package-lock.json  generated from it, so the image can use `npm ci`
 *
 * `shared/` is staged because the server imports it at runtime — the plant
 * catalogue and the tenderness map are both real values now, not just types.
 * `npm ci` in `/app` turns the `file:shared` dependency into a symlink at
 * `/app/node_modules/@hpt/shared`, which is how `node server/index.js` resolves
 * the bare specifier. Nothing else in the image changes shape.
 *
 * ## Why the staged shared tree is flat
 *
 * `.gitignore` carries bare `node_modules` and `dist` entries. Those patterns
 * are unanchored, so they match at *any* depth: `addon/rootfs/app/shared/dist/`
 * would sit happily on disk, satisfy `--check` (which compares one build
 * against another, both local), and then be missing from the clone Supervisor
 * builds on the Home Assistant machine — `ERR_MODULE_NOT_FOUND` at boot, with
 * her garden gone from the sidebar and nothing in the working tree to show for
 * it. The existing `server/` and `client/` directories escape this only because
 * they are renamed on the way in.
 *
 * So the shared build is flattened to `shared/*.js` and `assertNoIgnoredNames`
 * fails the build if any staged path ever picks up one of those names again.
 *
 * Run it through the root script, which builds the workspaces first:
 *
 *   npm run build:addon
 *
 * `--check` verifies the committed tree matches the current build and touches
 * nothing. That is what CI runs. It compares against whatever is in `dist/`
 * right now, so it only means something after `npm run build` — on a stale
 * `dist/` it will happily pass while the committed tree is wrong.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const addonDir = path.join(repoRoot, 'addon');
const stageDir = path.join(addonDir, 'rootfs', 'app');
const runScript = path.join(addonDir, 'rootfs', 'run.sh');

const SERVER_BUILD = path.join(repoRoot, 'server', 'dist', 'src');
const CLIENT_BUILD = path.join(repoRoot, 'client', 'dist');
const SHARED_BUILD = path.join(repoRoot, 'shared', 'dist');

const check = process.argv.includes('--check');
const relativeStage = path.relative(repoRoot, stageDir).split(path.sep).join('/');

function fail(message) {
  console.error(`build-addon: ${message}`);
  process.exit(1);
}

/**
 * A CRLF run.sh makes the container exit with a bare "no such file or
 * directory" that names neither the script nor the shell, because the kernel is
 * looking for an interpreter called "/bin/sh\r". Catch it here instead.
 */
function assertUnixLineEndings() {
  if (fs.readFileSync(runScript).includes(0x0d)) {
    fail(
      `${path.relative(repoRoot, runScript)} has CRLF line endings, which break its shebang inside Alpine — ` +
        'convert it to LF (.gitattributes should keep it that way)',
    );
  }
}

function requireBuild(dir, what) {
  if (!fs.existsSync(dir)) {
    fail(`no ${what} build at ${path.relative(repoRoot, dir)} — run \`npm run build\` first`);
  }
}

/** The single runtime dependency, pinned to whatever the workspace resolved. */
function expressVersion() {
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const version = lock.packages?.['node_modules/express']?.version;

  if (!version) fail('could not read the resolved express version from package-lock.json');

  return version;
}

/**
 * Recursive copy, skipping source maps — nothing debugs the add-on image — and
 * optionally the `.d.ts` files beside a declaration build, which are compiler
 * input and have no business in a runtime image.
 */
function copyTree(from, to, { skipSourceMaps = false, skipDeclarations = false } = {}) {
  fs.mkdirSync(to, { recursive: true });

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);

    if (entry.isDirectory()) {
      copyTree(source, target, { skipSourceMaps, skipDeclarations });
      continue;
    }

    if (skipSourceMaps && entry.name.endsWith('.map')) continue;
    if (skipDeclarations && entry.name.endsWith('.d.ts')) continue;

    copyFile(source, target);
  }
}

/**
 * The generated tree is committed, so it has to come out the same bytes on every
 * machine. Two things leak the checkout's line endings into it: TypeScript
 * copies the newlines inside a template literal through verbatim, which puts
 * CRLF in the migration SQL, and Vite copies `index.html` and `public/` through
 * as they are. `.gitattributes` checks every text file out as LF so this never
 * arises, but normalising here too means the tree does not silently depend on
 * that, or on anyone's `core.autocrlf`, or on being built from a git checkout at
 * all. Only known text extensions are rewritten, so the PNGs stay untouched.
 */
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt', '.webmanifest']);

function copyFile(source, target) {
  const contents = fs.readFileSync(source);
  const isText = TEXT_EXTENSIONS.has(path.extname(source).toLowerCase());

  if (!isText || !contents.includes(0x0d)) {
    fs.writeFileSync(target, contents);
    return;
  }

  fs.writeFileSync(target, Buffer.from(contents.toString('utf8').replaceAll('\r\n', '\n'), 'utf8'));
}

/**
 * Normalising CRLF is not quite a guarantee on its own, so verify the result.
 *
 * Vite rewrites the script tags in `index.html` and injects the replacements
 * with LF regardless of the surrounding file, which on a CRLF checkout leaves a
 * lone carriage return mid-line — `</div>\r` followed by its own `\r\n`. Turning
 * that into a bare newline as well would produce a blank line an LF checkout
 * never had, so the copy above deliberately only touches CRLF pairs, and this
 * catches anything left over rather than shipping a tree that cannot match CI.
 */
function assertNoStrayCarriageReturns(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      assertNoStrayCarriageReturns(target);
      continue;
    }

    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    if (fs.readFileSync(target).includes(0x0d)) {
      fail(
        `${entry.name} still contains a carriage return after staging, so this tree would not match one ` +
          'built on Linux — check out the repository with LF line endings (.gitattributes sets eol=lf), ' +
          `then re-run; ${relativeStage} has been left incomplete`,
      );
    }
  }
}

/**
 * Names that `.gitignore` would swallow anywhere in the tree.
 *
 * The entries there are bare `node_modules` and `dist`, with no leading slash,
 * which git matches at every depth. A staged file underneath one of those names
 * is untracked, so it exists here and not in the clone Supervisor builds — the
 * one failure mode in this script that no local check can see, because every
 * local check reads the working tree where the file is present.
 */
const GIT_IGNORED_NAMES = new Set(['node_modules', 'dist']);

function assertNoIgnoredNames(dir) {
  const walk = (current, trail) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = [...trail, entry.name];

      if (GIT_IGNORED_NAMES.has(entry.name)) {
        fail(
          `${relativeStage}/${relative.join('/')} sits under a name .gitignore matches at any depth, so it ` +
            'would be staged here and absent from the clone Home Assistant builds — rename it on the way in ' +
            '(that is why the server, client and shared builds are flattened out of their `dist` directories)',
        );
      }

      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
    }
  };

  walk(dir, []);
}

/** A stable fingerprint of a directory: sorted relative paths plus contents. */
function fingerprint(dir) {
  const hash = createHash('sha256');

  const walk = (current) => {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1));

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      hash.update(path.relative(dir, full).split(path.sep).join('/'));
      hash.update(fs.readFileSync(full));
    }
  };

  if (fs.existsSync(dir)) walk(dir);

  return hash.digest('hex');
}

/**
 * The `file:` specifier for the staged shared package.
 *
 * Written the way npm normalises it, so the generated manifest and the lockfile
 * npm produces from it agree byte for byte and `npm ci` has nothing to complain
 * about.
 */
const SHARED_SPEC = 'file:shared';

function manifest(version) {
  return `${JSON.stringify(
    {
      name: 'home-plot-tracker-addon',
      private: true,
      version: '0.0.0',
      description:
        'Production runtime for the Home Plot Tracker Home Assistant add-on. Generated by scripts/build-addon.mjs — do not edit.',
      license: 'MIT',
      type: 'module',
      engines: { node: '>=22.6.0' },
      dependencies: { '@hpt/shared': SHARED_SPEC, express: version },
    },
    null,
    2,
  )}\n`;
}

/**
 * The manifest for the staged shared package.
 *
 * Generated rather than copied from `shared/package.json`, for three reasons.
 * It must point at the flattened layout (`./index.js`, not `./dist/index.js`).
 * It must carry no `scripts`, so nothing npm does while linking it can execute
 * anything. And it must carry no `devDependencies`, so `npm ci` in the image
 * never looks at a package that is not there.
 */
function sharedManifest() {
  return `${JSON.stringify(
    {
      name: '@hpt/shared',
      private: true,
      version: '0.0.0',
      description:
        'Runtime values shared by the Home Plot Tracker client and server. Generated by scripts/build-addon.mjs — do not edit.',
      license: 'MIT',
      type: 'module',
      main: './index.js',
      exports: { '.': { default: './index.js' } },
    },
    null,
    2,
  )}\n`;
}

/**
 * Builds the staged tree at `target`, so `--check` can compare against a
 * scratch directory without disturbing the working copy.
 */
function stageInto(target, version, reusableLock) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  copyTree(SERVER_BUILD, path.join(target, 'server'), { skipSourceMaps: true });
  copyTree(CLIENT_BUILD, path.join(target, 'client'));
  copyTree(SHARED_BUILD, path.join(target, 'shared'), {
    skipSourceMaps: true,
    skipDeclarations: true,
  });
  fs.writeFileSync(path.join(target, 'shared', 'package.json'), sharedManifest());
  assertNoStrayCarriageReturns(target);
  assertNoIgnoredNames(target);
  fs.writeFileSync(path.join(target, 'package.json'), manifest(version));

  // Reuse the committed lockfile whenever it still describes exactly this
  // manifest, so an ordinary build needs no network and churns nothing. It is
  // regenerated only when a dependency actually moved.
  if (reusableLock !== null) {
    fs.writeFileSync(path.join(target, 'package-lock.json'), reusableLock);
    return;
  }

  if (check) {
    fail(
      `${relativeStage}/package-lock.json does not match the generated manifest (express@${version} plus ` +
        `@hpt/shared at ${SHARED_SPEC}) — run \`npm run build:addon\` and commit the result`,
    );
  }

  execFileSync('npm', ['install', '--package-lock-only', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: target,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

assertUnixLineEndings();
requireBuild(SERVER_BUILD, 'server');
requireBuild(CLIENT_BUILD, 'client');
requireBuild(SHARED_BUILD, 'shared');

if (!fs.existsSync(path.join(CLIENT_BUILD, 'index.html'))) {
  fail(`no index.html in ${path.relative(repoRoot, CLIENT_BUILD)} — the client build is incomplete`);
}

if (!fs.existsSync(path.join(SHARED_BUILD, 'index.js'))) {
  fail(`no index.js in ${path.relative(repoRoot, SHARED_BUILD)} — the shared build is incomplete`);
}

/**
 * Whether the committed lockfile still describes the manifest this build would
 * generate.
 *
 * Checking only the Express version was enough while Express was the only
 * dependency. It is not any more: a manifest that gained `@hpt/shared` while
 * the lockfile kept its old shape would sail through here, and then fail on her
 * machine — Supervisor clones this repository and runs the Docker build there,
 * so `npm ci` refusing a lockfile that is out of sync with its manifest is an
 * add-on that will not install, not a CI failure somebody catches first.
 */
function lockMatchesManifest(lock, version) {
  const root = lock.packages?.[''];
  const link = lock.packages?.['node_modules/@hpt/shared'];

  return (
    root?.dependencies?.express === version &&
    root?.dependencies?.['@hpt/shared'] === SHARED_SPEC &&
    lock.packages?.['node_modules/express']?.version === version &&
    link?.link === true &&
    link?.resolved === 'shared' &&
    lock.packages?.shared?.name === '@hpt/shared'
  );
}

const version = expressVersion();
const lockPath = path.join(stageDir, 'package-lock.json');
const existingLock = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null;
const reusableLock =
  existingLock !== null && lockMatchesManifest(JSON.parse(existingLock), version)
    ? existingLock
    : null;

if (check) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hpt-addon-'));

  try {
    stageInto(scratch, version, reusableLock);

    if (fingerprint(scratch) !== fingerprint(stageDir)) {
      fail(`${relativeStage} is out of date — run \`npm run build:addon\` and commit the result`);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  console.log(`build-addon: ${relativeStage} matches the current build`);
} else {
  stageInto(stageDir, version, reusableLock);
  console.log(`build-addon: staged the built server, client and shared into ${relativeStage}`);
}

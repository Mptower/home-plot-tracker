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
 *   package.json       a production-only manifest: Express and nothing else
 *   package-lock.json  generated from it, so the image can use `npm ci`
 *
 * `shared/` is not copied. It is imported only as types, which
 * `verbatimModuleSyntax` erases, so it has no runtime presence at all.
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

/** Recursive copy, skipping source maps — nothing debugs the add-on image. */
function copyTree(from, to, { skipSourceMaps = false } = {}) {
  fs.mkdirSync(to, { recursive: true });

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);

    if (entry.isDirectory()) {
      copyTree(source, target, { skipSourceMaps });
      continue;
    }

    if (skipSourceMaps && entry.name.endsWith('.map')) continue;

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
      dependencies: { express: version },
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
  assertNoStrayCarriageReturns(target);
  fs.writeFileSync(path.join(target, 'package.json'), manifest(version));

  // Reuse the committed lockfile whenever it still resolves to the same
  // Express, so an ordinary build needs no network and churns nothing. It is
  // regenerated only when the dependency actually moved.
  if (reusableLock !== null) {
    fs.writeFileSync(path.join(target, 'package-lock.json'), reusableLock);
    return;
  }

  if (check) fail(`${relativeStage}/package-lock.json does not resolve express@${version}`);

  execFileSync('npm', ['install', '--package-lock-only', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: target,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

assertUnixLineEndings();
requireBuild(SERVER_BUILD, 'server');
requireBuild(CLIENT_BUILD, 'client');

if (!fs.existsSync(path.join(CLIENT_BUILD, 'index.html'))) {
  fail(`no index.html in ${path.relative(repoRoot, CLIENT_BUILD)} — the client build is incomplete`);
}

const version = expressVersion();
const lockPath = path.join(stageDir, 'package-lock.json');
const existingLock = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null;
const reusableLock =
  existingLock !== null &&
  JSON.parse(existingLock).packages?.['node_modules/express']?.version === version
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
  console.log(`build-addon: staged the built server and client into ${relativeStage}`);
}

/**
 * The server may import `@hpt/shared` at runtime exactly as long as the add-on
 * image actually ships it. This is what holds the second half of that sentence
 * up.
 *
 * ## What this used to be
 *
 * It used to assert the opposite: that no server source imported the package as
 * a runtime value at all. That was right at the time. `scripts/build-addon.mjs`
 * staged `server/dist/src` and `client/dist` into `addon/rootfs/app/` alongside
 * a manifest whose only dependency was Express, so there was no
 * `node_modules/@hpt/shared` in the image and a runtime import would have failed
 * for the first time on her Home Assistant box, at boot, as
 * `ERR_MODULE_NOT_FOUND` — with the garden simply gone from the sidebar.
 *
 * The frost engine needs the plant catalogue, so the packaging was fixed rather
 * than worked around: the shared build is staged into the image and linked in as
 * a `file:` dependency. That makes the runtime import honest, and it moves the
 * failure mode rather than removing it. Every way the staging can silently stop
 * happening is a way her add-on stops booting, and none of them show up in
 * `npm run dev`, in `tsc`, or in any other test in this suite.
 *
 * ## Why each assertion below is here
 *
 * The invisible failure is not the import. It is the staging:
 *
 *   * `.gitignore` carries bare `node_modules` and `dist` entries, unanchored,
 *     so git matches them at any depth. A staged file under such a name exists
 *     on disk, satisfies `npm run check:addon` (which compares one local build
 *     against another), and is absent from the clone Supervisor builds.
 *   * `npm ci` refuses a lockfile that disagrees with its manifest, and
 *     Supervisor runs that `npm ci` on her machine. A manifest that gained the
 *     dependency while the committed lockfile did not is an add-on that will not
 *     install.
 *   * The staged shared package is flattened out of `dist/`, so its manifest has
 *     to point at the flattened layout, and everything its entrypoint reaches
 *     has to have come along.
 *
 * These read the **committed** `addon/rootfs/app/` tree, which is the thing that
 * actually ships. Like `check:addon`, they are only meaningful after
 * `npm run build:addon` — on a stale tree they describe the last build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const serverRoot = path.resolve(here, '..', 'src');
const stageDir = path.join(repoRoot, 'addon', 'rootfs', 'app');
const stagedShared = path.join(stageDir, 'shared');

const PACKAGE = '@hpt/shared';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) return sourceFiles(full);

    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/**
 * Matches a type-only import or re-export of the package, anchored to the start
 * of a line and forbidden from crossing a quote or a semicolon so it cannot run
 * together with the statement above it. Written to span newlines, because the
 * longer import lists in this codebase wrap across several.
 */
const TYPE_ONLY_IMPORT = /^[ \t]*(?:import|export)[ \t]+type\b[^;'"]*?\bfrom[ \t]*['"]@hpt\/shared['"]/gm;

/** Every mention of the package, whatever shape it takes. */
const ANY_MENTION = /['"]@hpt\/shared['"]/g;

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

/**
 * Mentions of `@hpt/shared` in a file that are *not* erased type-only imports.
 *
 * Deliberately counted rather than parsed: every mention has to be accounted
 * for by a recognised type-only import, so a shape nobody anticipated — a bare
 * `import '@hpt/shared'`, a dynamic `import()`, a `require` — is counted as a
 * runtime dependency instead of quietly slipping through a pattern that was
 * written before it existed.
 */
function runtimeMentions(source: string): number {
  return countMatches(source, ANY_MENTION) - countMatches(source, TYPE_ONLY_IMPORT);
}

/** Server sources that need the package to exist on disk at runtime. */
function serverRuntimeImporters(): string[] {
  const files = sourceFiles(serverRoot);

  // A guard that silently stopped finding anything to guard would be worse than
  // no guard, so prove the walk is actually reading the tree.
  assert.ok(files.length > 10, `expected to scan the server sources, found ${files.length} files`);

  return files
    .filter((file) => runtimeMentions(fs.readFileSync(file, 'utf8')) > 0)
    .map((file) => path.relative(serverRoot, file).split(path.sep).join('/'));
}

test('the server does import the package at runtime, so the rest of this file matters', () => {
  // Not a style assertion. If this ever goes to zero the staging below is dead
  // weight and should be removed deliberately rather than left rotting — and if
  // it goes to zero by accident, the frost engine has lost the plant catalogue
  // and stopped warning about anything it has no seed packet for.
  assert.notDeepEqual(serverRuntimeImporters(), []);
});

test('the staged add-on manifest declares the package it now needs', () => {
  const manifest = readJson(path.join(stageDir, 'package.json'));
  const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;

  assert.equal(
    dependencies[PACKAGE],
    'file:shared',
    `${PACKAGE} is imported at runtime by ${serverRuntimeImporters().join(', ')} but the image would not install it`,
  );
});

test('the staged lockfile agrees with the staged manifest', () => {
  // Supervisor clones this repository and runs `docker build` on her machine, so
  // `npm ci` rejecting an out-of-sync lockfile is an add-on that never installs,
  // not a CI failure somebody notices first.
  const manifest = readJson(path.join(stageDir, 'package.json'));
  const lock = readJson(path.join(stageDir, 'package-lock.json'));
  const packages = lock.packages as Record<string, Record<string, unknown>>;

  assert.deepEqual(packages['']?.dependencies, manifest.dependencies);
  assert.equal(packages[`node_modules/${PACKAGE}`]?.link, true);
  assert.equal(packages[`node_modules/${PACKAGE}`]?.resolved, 'shared');
  assert.equal(packages.shared?.name, PACKAGE);
});

test('the staged package resolves to a file that is actually there', () => {
  const manifest = readJson(path.join(stagedShared, 'package.json'));

  assert.equal(manifest.name, PACKAGE);
  assert.equal(manifest.type, 'module');
  // Nothing npm does while linking this may run anything.
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.devDependencies, undefined);

  // The build is flattened out of `dist/`, so a manifest copied from the real
  // package would point at a directory that does not exist here.
  assert.equal(manifest.main, './index.js');
  assert.ok(fs.existsSync(path.join(stagedShared, 'index.js')), 'no index.js beside the manifest');
});

test('everything the staged entrypoint reaches for was staged with it', () => {
  // The staging copies JavaScript only. A module the entrypoint re-exports but
  // the filter dropped would resolve in every test in this repository — they run
  // against the workspace — and fail once, on her machine, at boot.
  const seen = new Set<string>();
  const queue = [path.join(stagedShared, 'index.js')];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    assert.ok(
      fs.existsSync(file),
      `${path.relative(stageDir, file).split(path.sep).join('/')} is imported by the staged shared build but was not staged`,
    );

    const source = fs.readFileSync(file, 'utf8');

    for (const [, specifier] of source.matchAll(/\bfrom\s*['"](\.[^'"]*)['"]/g)) {
      queue.push(path.resolve(path.dirname(file), specifier as string));
    }
  }

  // Four modules today; the assertion is that the walk ran, not the count.
  assert.ok(seen.size > 1, `expected the entrypoint to re-export something, walked ${seen.size}`);
});

test('nothing staged sits under a name .gitignore swallows', () => {
  // The one failure this repository cannot see locally. `.gitignore` has bare
  // `node_modules` and `dist` entries, which git matches at every depth, so a
  // staged file under one of those names is present here and missing from the
  // clone Home Assistant builds. `scripts/build-addon.mjs` flattens the three
  // builds out of their `dist` directories for exactly this reason.
  const offenders: string[] = [];

  const walk = (dir: string, trail: string[]): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = [...trail, entry.name];

      if (entry.name === 'node_modules' || entry.name === 'dist') offenders.push(relative.join('/'));
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
    }
  };

  walk(stageDir, []);

  assert.deepEqual(offenders, []);
});

test('every staged file is one git will actually commit', () => {
  // Belt and braces over the name check above: asks git directly, so a future
  // .gitignore rule nobody anticipated is caught by the rule itself rather than
  // by a list of names somebody remembered to update.
  const staged: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) walk(full);
      else staged.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  };

  walk(stageDir);
  assert.ok(staged.length > 10, `expected to scan the staged tree, found ${staged.length} files`);

  let ignored: string;

  try {
    // Exit status 1 means "nothing matched", which is the answer we want, and
    // execFileSync throws on it.
    ignored = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: repoRoot,
      input: staged.join('\n'),
      encoding: 'utf8',
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; code?: string };

    // No git, or no repository: skip rather than fail. This runs from a tarball
    // sometimes, and a check that cannot run is not a check that failed.
    if (failure.status !== 1 && failure.status !== 0) return;

    ignored = failure.stdout ?? '';
  }

  assert.deepEqual(
    ignored.split('\n').filter((line) => line.trim() !== ''),
    [],
    'these files are staged for the add-on image but git will not commit them, so they would be missing from the clone Home Assistant builds',
  );
});

test('the guard recognises the shapes it has to tell apart', () => {
  // Proves a count of zero means "nothing to find" rather than "nothing looked
  // for".
  const wrapped = "import type {\n  GardenBed,\n  SeedPacket,\n} from '@hpt/shared';";

  assert.equal(runtimeMentions("import type { SeedPacket } from '@hpt/shared';"), 0);
  assert.equal(runtimeMentions(wrapped), 0);
  assert.equal(runtimeMentions("export type { Tenderness } from '@hpt/shared';"), 0);

  // A preceding import must not be absorbed into the one being checked.
  assert.equal(runtimeMentions("import fs from 'node:fs';\nimport type { X } from '@hpt/shared';"), 0);

  assert.equal(runtimeMentions("import { PLANT_CATALOGUE } from '@hpt/shared';"), 1);
  // `import { type X }` still loads the module at runtime.
  assert.equal(runtimeMentions("import { type SeedPacket } from '@hpt/shared';"), 1);
  assert.equal(runtimeMentions("import '@hpt/shared';"), 1);
  assert.equal(runtimeMentions("const m = await import('@hpt/shared');"), 1);
  assert.equal(runtimeMentions("export { SEED_CATEGORIES } from '@hpt/shared';"), 1);
});

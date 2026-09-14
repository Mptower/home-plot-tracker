/**
 * The add-on image does not contain `@hpt/shared`, and this is what keeps it
 * that way.
 *
 * `scripts/build-addon.mjs` stages `server/dist/src` and `client/dist` into
 * `addon/rootfs/app/` alongside a manifest whose only dependency is Express.
 * There is no `shared/` in there and no `node_modules/@hpt/shared`. Every
 * server import from that package is therefore an `import type`, erased by
 * `verbatimModuleSyntax` before anything runs.
 *
 * A runtime import would be invisible everywhere it could be caught: the
 * workspace symlink resolves it in development, `--experimental-strip-types`
 * resolves it in these tests, and `tsc` is perfectly happy. It would fail for
 * the first time on her Home Assistant box, at boot, as `ERR_MODULE_NOT_FOUND`
 * against a package name that appears in no manifest — with the garden simply
 * gone.
 *
 * The temptation is real and new: `shared/src/plants.ts` is a runtime value
 * that the client imports and that looks like it would be useful here. It is
 * not available. This test is the thing that says so at the moment somebody
 * tries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) return sourceFiles(full);

    return entry.name.endsWith('.ts') ? [full] : [];
  });
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
 * `import '@hpt/shared'`, a dynamic `import()`, a `require` — is reported
 * instead of quietly slipping through a pattern that was written before it
 * existed.
 */
function runtimeMentions(source: string): number {
  return countMatches(source, ANY_MENTION) - countMatches(source, TYPE_ONLY_IMPORT);
}

test('no server source imports @hpt/shared as a runtime value', () => {
  const files = sourceFiles(serverRoot);

  // A guard that silently stopped finding anything to guard would be worse than
  // no guard, so prove the walk is actually reading the tree.
  assert.ok(files.length > 10, `expected to scan the server sources, found ${files.length} files`);

  const offenders = files
    .filter((file) => runtimeMentions(fs.readFileSync(file, 'utf8')) > 0)
    .map((file) => path.relative(serverRoot, file).split(path.sep).join('/'));

  assert.deepEqual(
    offenders,
    [],
    'these files would crash the add-on on boot; use `import type`, or move the value into server/src/',
  );
});

test('the guard recognises the shapes it has to tell apart', () => {
  // Proves the empty result above means "nothing to find" rather than "nothing
  // looked for".
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

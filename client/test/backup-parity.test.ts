/**
 * The two copies of the backup format markers must agree.
 *
 * `server/src/backup/format.ts` decides what a saved file says and which files
 * the server will accept. `client/src/lib/backup.ts` decides what the browser
 * recognises when she picks a file, and therefore what the preview says before
 * she presses the button. Both headers explain why there are two: `server/src`
 * may only take *types* from `@hpt/shared`, because the add-on image ships
 * `server/dist/src` and `client/dist` and no `shared/` at all, so a shared
 * runtime constant would crash the add-on on boot.
 *
 * A duplicate is only acceptable while something fails when it drifts. This is
 * that something, and the failure it prevents is not abstract: if the browser's
 * `BACKUP_FORMAT` drifted, every real backup she picked would be refused in the
 * preview as "not a Home Plot Tracker backup" and she would never reach the
 * server that would have accepted it. If the version drifted the other way, the
 * preview would promise a restore the server then refuses.
 *
 * This lives in `client/test` rather than `server/test` on purpose. The server's
 * tsconfig sets `rootDir: "."` and emits to `dist`, so a server test reaching
 * into `client/` would put a client file inside the server's compiled output.
 * The client typechecks with `noEmit`, so it can read across the fence safely.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from '../src/lib/backup.ts';
import {
  BACKUP_FORMAT as SERVER_BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION as SERVER_BACKUP_FORMAT_VERSION,
} from '../../server/src/backup/format.ts';

test('the browser and the server call the format by the same name', () => {
  assert.equal(BACKUP_FORMAT, SERVER_BACKUP_FORMAT);
});

test('the browser and the server understand the same format version', () => {
  assert.equal(BACKUP_FORMAT_VERSION, SERVER_BACKUP_FORMAT_VERSION);
});

test('the format name is specific enough to identify a file as ours', () => {
  // A generic marker like "garden" would match somebody else's export and turn
  // a wrong-file mistake into a confusing field-by-field refusal.
  assert.match(BACKUP_FORMAT, /^home-plot-tracker\./);
});

test('the format version is a whole number a human can read in the file', () => {
  assert.equal(Number.isInteger(BACKUP_FORMAT_VERSION), true);
  assert.equal(BACKUP_FORMAT_VERSION >= 1, true);
});

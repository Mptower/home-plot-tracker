/**
 * What happens to a second device that had a tab open when a restore landed.
 *
 * This is the subtle failure mode of the whole backup feature, and it is not
 * really about backups at all — it is about the fact that this app has two
 * devices, per-collection ETags and a three-way merge, and a restore rewrites
 * every collection wholesale. That is precisely the situation the merge
 * machinery was built to be suspicious of.
 *
 * The sequence being reasoned about:
 *
 * 1. Her laptop loads the harvests and holds version 4.
 * 2. She restores an old copy from her phone. The server replaces all three
 *    collections and bumps every version to 5 — unconditionally, even for a
 *    collection whose contents did not change. (`server/src/backup/restore.ts`
 *    explains why that "even for" matters: without it, a restore that only
 *    changed the harvests would leave the laptop's seed ETag still valid, and
 *    the laptop could then write its pre-restore seeds back over the top with
 *    no 409 and nothing on screen.)
 * 3. The laptop saves. `If-Match: "4"` no longer matches, so it gets a 409
 *    carrying the restored rows instead of silently overwriting them.
 * 4. `useGardenData.flush` merges: `base` is what the laptop loaded, `mine` is
 *    that plus whatever she typed, `theirs` is the restored garden.
 *
 * Step 4 is what this file pins, calling `mergeCollections` exactly as `flush`
 * does — `describe` supplied, no `resolutions`, `prefer` left at its `ask`
 * default. The property that has to hold is: **a stale tab can contribute her
 * genuine unsaved edits, and cannot reinstate the garden it was holding.**
 *
 * Steps 2 and 3 are pinned against a real server and a real database in
 * `server/test/backup-restore.test.ts`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCollections } from '../src/lib/merge.ts';
import type { HarvestLog } from '@hpt/shared';

const describe = (harvest: HarvestLog): string => `${harvest.variety} on ${harvest.date}`;

function harvest(id: string, overrides: Partial<HarvestLog> = {}): HarvestLog {
  return {
    id,
    date: '2026-08-12',
    variety: 'Cherokee Purple',
    weightLbs: 3.4,
    count: 5,
    ...overrides,
  };
}

/** What the laptop had loaded before the restore: a full season. */
const LAPTOP_HAD = [harvest('h1'), harvest('h2'), harvest('h3')];

/** What the restore put there: an older, smaller garden. */
const RESTORED = [harvest('h1')];

test('a stale tab with no edits cannot push the pre-restore garden back', () => {
  // The dangerous case, and the most likely one: a tab left open on the kitchen
  // laptop, untouched. If this merge kept `mine`, the restore would be undone by
  // a device nobody had touched, with no error and nothing on screen to show it
  // had happened.
  const outcome = mergeCollections(LAPTOP_HAD, LAPTOP_HAD, RESTORED, { describe });

  assert.equal(outcome.ok, true);
  assert.deepEqual(
    outcome.ok ? outcome.merged.map((row) => row.id) : null,
    ['h1'],
    'the rows the restore removed stay removed',
  );
});

test('a harvest she typed on the stale tab survives the restore', () => {
  // She weighed beans on the laptop while the restore was happening on the
  // phone. That row exists nowhere else, so dropping it would be a real loss —
  // and the restored file has no opinion about a row it has never seen.
  const mine = [...LAPTOP_HAD, harvest('h4', { variety: 'Blue Lake Beans' })];

  const outcome = mergeCollections(LAPTOP_HAD, mine, RESTORED, { describe });

  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.ok ? outcome.merged.map((row) => row.id) : null, ['h1', 'h4']);
});

test('a row she edited that the restore deleted is a conflict, not a silent loss', () => {
  // The one case where neither answer is obviously right: she corrected a
  // weight on a row the restored file does not contain. Guessing either way
  // would be wrong, so the conflict chooser asks her.
  const mine = [harvest('h1'), harvest('h2', { weightLbs: 9.9 }), harvest('h3')];

  const outcome = mergeCollections(LAPTOP_HAD, mine, RESTORED, { describe });

  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.ok ? null : outcome.conflicts, [
    { id: 'h2', reason: 'edited-here-deleted-there', label: 'Cherokee Purple on 2026-08-12' },
  ]);
});

test('a row the restore changed keeps the restored value when she did not touch it', () => {
  // "Only they touched it" — and after a restore, "they" is the restore. A stale
  // tab holding the older value must not win, or a restore would be undone one
  // field at a time without ever raising a conflict.
  const restoredWithDifferentWeight = [harvest('h1', { weightLbs: 1.1 })];

  const outcome = mergeCollections(LAPTOP_HAD, LAPTOP_HAD, restoredWithDifferentWeight, {
    describe,
  });

  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.ok ? outcome.merged : null, restoredWithDifferentWeight);
});

test('a row she edited that the restore also changed is put to her', () => {
  // Neither side wins by default. A restore is not automatically more
  // authoritative than something she typed thirty seconds ago; she is the only
  // one who knows which of the two she meant.
  const mine = [harvest('h1', { count: 99 }), harvest('h2'), harvest('h3')];
  const theirs = [harvest('h1', { count: 7 })];

  const outcome = mergeCollections(LAPTOP_HAD, mine, theirs, { describe });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? null : outcome.conflicts[0]?.reason, 'edited-on-both');
});

test('answering "keep the restored copy" settles it without touching her other rows', () => {
  // What the conflict chooser does with a single answer: it resolves that row
  // and leaves every unrelated row of hers alone.
  const mine = [harvest('h1', { count: 99 }), harvest('h2'), harvest('h3'), harvest('h4')];
  const theirs = [harvest('h1', { count: 7 })];

  const outcome = mergeCollections(LAPTOP_HAD, mine, theirs, {
    describe,
    resolutions: { h1: 'theirs' },
  });

  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.ok ? outcome.merged : null, [harvest('h1', { count: 7 }), harvest('h4')]);
});

test('a restore into a stale tab showing an empty garden brings the season back', () => {
  // The mirror image, and the likelier real-world direction: the laptop was
  // open on a garden that had lost its records, and the restore brought them
  // back. Nothing from the stale side should survive to empty it again.
  const outcome = mergeCollections([], [], RESTORED, { describe });

  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.ok ? outcome.merged : null, RESTORED);
});

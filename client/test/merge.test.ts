/**
 * The three-way merge that runs after the server rejects a stale write.
 *
 * Everything here is about not losing something she typed. A wrong answer in
 * `mergeCollections` does not throw and does not show an error: the harvest she
 * logged on her phone is simply not in the list any more. So these tests pin the
 * per-item rules from the doc comment, the conflict reasons, how `resolutions`
 * and `prefer` settle them, and the splice-based ordering that decides where the
 * other device's items land on screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { GardenBed, HarvestLog, SeedPacket } from '@hpt/shared';

import {
  deepEqual,
  mergeCollections,
  type Identified,
  type MergeConflict,
  type MergeResult,
} from '../src/lib/merge.ts';

function seed(overrides: Partial<SeedPacket> = {}): SeedPacket {
  return {
    id: 'seed_cherokee_purple',
    category: 'Nightshade',
    variety: 'Cherokee Purple',
    brand: 'Baker Creek',
    purchaseYear: 2025,
    notes: 'Dusky heirloom slicer.',
    ...overrides,
  };
}

function bed(overrides: Partial<GardenBed> = {}): GardenBed {
  return {
    id: 'bed_raised_north',
    name: 'Bed 1 - Raised',
    rows: 2,
    columns: 3,
    layout: [
      ['Cherokee Purple', null, null],
      [null, null, 'Genovese Basil'],
    ],
    lastYearCategory: 'Nightshade',
    ...overrides,
  };
}

function harvest(overrides: Partial<HarvestLog> = {}): HarvestLog {
  return {
    id: 'harvest_2026_08_12_tomato',
    date: '2026-08-12',
    variety: 'Cherokee Purple',
    weightLbs: 3.4,
    count: 5,
    ...overrides,
  };
}

const describeSeed = (item: SeedPacket): string => item.variety;
const describeBed = (item: GardenBed): string => item.name;
const describeHarvest = (item: HarvestLog): string => `${item.variety} on ${item.date}`;

function mergedOf<T extends Identified>(result: MergeResult<T>): T[] {
  if (!result.ok) {
    assert.fail(`expected a clean merge, got conflicts: ${JSON.stringify(result.conflicts)}`);
  }

  return result.merged;
}

function conflictsOf<T extends Identified>(result: MergeResult<T>): MergeConflict[] {
  if (result.ok) {
    assert.fail(`expected conflicts, got a merge of: ${JSON.stringify(result.merged)}`);
  }

  return result.conflicts;
}

function ids<T extends Identified>(items: readonly T[]): string[] {
  return items.map((item) => item.id);
}

test('an item both devices left exactly as they found it is kept once', () => {
  const result = mergeCollections([seed()], [seed()], [seed()], { describe: describeSeed });

  assert.deepEqual(mergedOf(result), [seed()]);
});

test('an edit only the other device made wins', () => {
  const theirEdit = seed({ notes: 'Sown 12 April, back tray.' });
  const result = mergeCollections([seed()], [seed()], [theirEdit], { describe: describeSeed });

  assert.deepEqual(mergedOf(result), [theirEdit]);
});

test('an edit only this device made wins', () => {
  const myEdit = seed({ notes: 'Down to a dozen seeds.' });
  const result = mergeCollections([seed()], [myEdit], [seed()], { describe: describeSeed });

  assert.deepEqual(mergedOf(result), [myEdit]);
});

test('an item edited differently on both devices is an edited-on-both conflict', () => {
  const result = mergeCollections(
    [seed()],
    [seed({ notes: 'Down to a dozen seeds.' })],
    [seed({ notes: 'Sown 12 April, back tray.' })],
    { describe: describeSeed },
  );

  assert.deepEqual(conflictsOf(result), [
    { id: 'seed_cherokee_purple', reason: 'edited-on-both', label: 'Cherokee Purple' },
  ]);
});

test('the same id added differently on both devices is an added-on-both conflict', () => {
  const result = mergeCollections([], [harvest({ weightLbs: 3.4 })], [harvest({ weightLbs: 4.1 })], {
    describe: describeHarvest,
  });

  assert.deepEqual(conflictsOf(result), [
    {
      id: 'harvest_2026_08_12_tomato',
      reason: 'added-on-both',
      label: 'Cherokee Purple on 2026-08-12',
    },
  ]);
});

test('editing here what the other device deleted is an edited-here-deleted-there conflict', () => {
  const result = mergeCollections([seed()], [seed({ purchaseYear: 2026 })], [], {
    describe: describeSeed,
  });

  assert.deepEqual(conflictsOf(result), [
    { id: 'seed_cherokee_purple', reason: 'edited-here-deleted-there', label: 'Cherokee Purple' },
  ]);
});

test('deleting here what the other device edited is a deleted-here-edited-there conflict', () => {
  const result = mergeCollections([seed()], [], [seed({ purchaseYear: 2026 })], {
    describe: describeSeed,
  });

  assert.deepEqual(conflictsOf(result), [
    { id: 'seed_cherokee_purple', reason: 'deleted-here-edited-there', label: 'Cherokee Purple' },
  ]);
});

test('an item added here that the other device has not seen yet is kept', () => {
  const mine = seed({ id: 'seed_genovese_basil', variety: 'Genovese Basil', category: 'Herb' });
  const result = mergeCollections([seed()], [seed(), mine], [seed()], { describe: describeSeed });

  assert.deepEqual(mergedOf(result), [seed(), mine]);
});

test('an item the other device added is kept', () => {
  const theirs = seed({ id: 'seed_genovese_basil', variety: 'Genovese Basil', category: 'Herb' });
  const result = mergeCollections([seed()], [seed()], [seed(), theirs], { describe: describeSeed });

  assert.deepEqual(mergedOf(result), [seed(), theirs]);
});

test('a delete on the other device is honoured when this device never touched the item', () => {
  const basil = seed({ id: 'seed_genovese_basil', variety: 'Genovese Basil', category: 'Herb' });
  const result = mergeCollections([seed(), basil], [seed(), basil], [seed()], {
    describe: describeSeed,
  });

  assert.deepEqual(mergedOf(result), [seed()]);
});

test('a delete here is honoured when the other device never touched the item', () => {
  const basil = seed({ id: 'seed_genovese_basil', variety: 'Genovese Basil', category: 'Herb' });
  const result = mergeCollections([seed(), basil], [seed()], [seed(), basil], {
    describe: describeSeed,
  });

  assert.deepEqual(mergedOf(result), [seed()]);
});

test('an item deleted on both devices is gone without a conflict', () => {
  const basil = seed({ id: 'seed_genovese_basil', variety: 'Genovese Basil', category: 'Herb' });
  const result = mergeCollections([seed(), basil], [seed()], [seed()], { describe: describeSeed });

  assert.deepEqual(mergedOf(result), [seed()]);
});

test('a resolution of mine keeps this device version of that item', () => {
  const myEdit = seed({ notes: 'Down to a dozen seeds.' });
  const result = mergeCollections([seed()], [myEdit], [seed({ notes: 'Sown 12 April.' })], {
    describe: describeSeed,
    resolutions: { seed_cherokee_purple: 'mine' },
  });

  assert.deepEqual(mergedOf(result), [myEdit]);
});

test('a resolution of theirs keeps the other device version of that item', () => {
  const theirEdit = seed({ notes: 'Sown 12 April.' });
  const result = mergeCollections([seed()], [seed({ notes: 'Down to a dozen.' })], [theirEdit], {
    describe: describeSeed,
    resolutions: { seed_cherokee_purple: 'theirs' },
  });

  assert.deepEqual(mergedOf(result), [theirEdit]);
});

test('resolutions settle each divergent item independently within one call', () => {
  const tomato = seed();
  const basil = seed({ id: 'seed_genovese_basil', variety: 'Genovese Basil', category: 'Herb' });

  const myTomato = seed({ notes: 'Down to a dozen.' });
  const myBasil = { ...basil, notes: 'Bolted early.' };
  const theirTomato = seed({ notes: 'Sown 12 April.' });
  const theirBasil = { ...basil, notes: 'Cut back hard.' };

  const result = mergeCollections([tomato, basil], [myTomato, myBasil], [theirTomato, theirBasil], {
    describe: describeSeed,
    resolutions: { seed_cherokee_purple: 'mine', seed_genovese_basil: 'theirs' },
  });

  assert.deepEqual(mergedOf(result), [myTomato, theirBasil]);
});

test('prefer mine settles anything resolutions does not cover', () => {
  const myEdit = seed({ notes: 'Down to a dozen.' });
  const result = mergeCollections([seed()], [myEdit], [seed({ notes: 'Sown 12 April.' })], {
    describe: describeSeed,
    prefer: 'mine',
  });

  assert.deepEqual(mergedOf(result), [myEdit]);
});

test('prefer theirs settles anything resolutions does not cover', () => {
  const theirEdit = seed({ notes: 'Sown 12 April.' });
  const result = mergeCollections([seed()], [seed({ notes: 'Down to a dozen.' })], [theirEdit], {
    describe: describeSeed,
    prefer: 'theirs',
  });

  assert.deepEqual(mergedOf(result), [theirEdit]);
});

test('a resolution overrides prefer for the item it names', () => {
  const tomato = seed();
  const basil = seed({ id: 'seed_genovese_basil', variety: 'Genovese Basil', category: 'Herb' });

  const myTomato = seed({ notes: 'Down to a dozen.' });
  const myBasil = { ...basil, notes: 'Bolted early.' };

  const result = mergeCollections(
    [tomato, basil],
    [myTomato, myBasil],
    [seed({ notes: 'Sown 12 April.' }), { ...basil, notes: 'Cut back hard.' }],
    {
      describe: describeSeed,
      resolutions: { seed_cherokee_purple: 'mine', seed_genovese_basil: 'mine' },
      prefer: 'theirs',
    },
  );

  assert.deepEqual(mergedOf(result), [myTomato, myBasil]);
});

test('prefer defaults to ask, which reports the conflict rather than guessing', () => {
  const base = [seed()];
  const mine = [seed({ notes: 'Down to a dozen.' })];
  const theirs = [seed({ notes: 'Sown 12 April.' })];

  const byDefault = mergeCollections(base, mine, theirs, { describe: describeSeed });
  const explicit = mergeCollections(base, mine, theirs, {
    describe: describeSeed,
    prefer: 'ask',
  });

  assert.deepEqual(conflictsOf(byDefault), [
    { id: 'seed_cherokee_purple', reason: 'edited-on-both', label: 'Cherokee Purple' },
  ]);
  assert.deepEqual(conflictsOf(explicit), conflictsOf(byDefault));
});

test('choosing a side settles only the divergent item and keeps the other device unrelated work', () => {
  const myEdit = seed({ notes: 'Down to a dozen.' });
  const theirNewSeed = seed({
    id: 'seed_genovese_basil',
    variety: 'Genovese Basil',
    category: 'Herb',
  });

  const result = mergeCollections(
    [seed()],
    [myEdit],
    [seed({ notes: 'Sown 12 April.' }), theirNewSeed],
    { describe: describeSeed, prefer: 'mine' },
  );

  assert.deepEqual(mergedOf(result), [myEdit, theirNewSeed]);
});

test('resolving towards the device that deleted the item leaves it deleted', () => {
  const towardsTheirDelete = mergeCollections([seed()], [seed({ purchaseYear: 2026 })], [], {
    describe: describeSeed,
    resolutions: { seed_cherokee_purple: 'theirs' },
  });

  assert.deepEqual(mergedOf(towardsTheirDelete), []);

  const towardsMyDelete = mergeCollections([seed()], [], [seed({ purchaseYear: 2026 })], {
    describe: describeSeed,
    prefer: 'mine',
  });

  assert.deepEqual(mergedOf(towardsMyDelete), []);
});

test('a conflict result reports ok false and carries no merged array', () => {
  const result = mergeCollections(
    [seed()],
    [seed({ notes: 'Down to a dozen.' })],
    [seed({ notes: 'Sown 12 April.' })],
    { describe: describeSeed },
  );

  assert.equal(result.ok, false);
  assert.ok(!('merged' in result), 'a conflicted merge must not hand back a half-merged array');
});

test('a single conflict suppresses the whole merge, including the items that agreed', () => {
  const basil = seed({ id: 'seed_genovese_basil', variety: 'Genovese Basil', category: 'Herb' });
  const theirNewSeed = seed({ id: 'seed_sungold', variety: 'Sungold' });

  const result = mergeCollections(
    [seed(), basil],
    [seed({ notes: 'Down to a dozen.' }), basil],
    [seed({ notes: 'Sown 12 April.' }), basil, theirNewSeed],
    { describe: describeSeed },
  );

  assert.deepEqual(ids(conflictsOf(result)), ['seed_cherokee_purple']);
});

test('a conflict label comes from describe', () => {
  const result = mergeCollections([bed()], [bed({ rows: 3 })], [bed({ columns: 4 })], {
    describe: describeBed,
  });

  assert.deepEqual(conflictsOf(result), [
    { id: 'bed_raised_north', reason: 'edited-on-both', label: 'Bed 1 - Raised' },
  ]);
});

test('a delete conflict is labelled from whichever device still holds the item', () => {
  const deletedThere = mergeCollections(
    [seed()],
    [seed({ variety: 'Cherokee Purple (saved)' })],
    [],
    { describe: describeSeed },
  );

  assert.equal(conflictsOf(deletedThere)[0]?.label, 'Cherokee Purple (saved)');

  const deletedHere = mergeCollections(
    [seed()],
    [],
    [seed({ variety: 'Cherokee Purple (2026 packet)' })],
    { describe: describeSeed },
  );

  assert.equal(conflictsOf(deletedHere)[0]?.label, 'Cherokee Purple (2026 packet)');
});

test('the merged order follows this device array, not the server one', () => {
  const first = bed({ id: 'bed_1', name: 'Bed 1' });
  const second = bed({ id: 'bed_2', name: 'Bed 2' });
  const third = bed({ id: 'bed_3', name: 'Bed 3' });

  const result = mergeCollections(
    [first, second, third],
    [third, first, second],
    [first, second, third],
    { describe: describeBed },
  );

  assert.deepEqual(ids(mergedOf(result)), ['bed_3', 'bed_1', 'bed_2']);
});

test('a harvest the other device prepended lands at the top of the feed', () => {
  const older = harvest({ id: 'harvest_aug_12', date: '2026-08-12' });
  const newer = harvest({ id: 'harvest_aug_19', date: '2026-08-19' });
  const newest = harvest({ id: 'harvest_aug_26', date: '2026-08-26' });

  const result = mergeCollections([newer, older], [newer, older], [newest, newer, older], {
    describe: describeHarvest,
  });

  assert.deepEqual(ids(mergedOf(result)), ['harvest_aug_26', 'harvest_aug_19', 'harvest_aug_12']);
});

test('a bed the other device appended lands at the end', () => {
  const first = bed({ id: 'bed_1', name: 'Bed 1' });
  const second = bed({ id: 'bed_2', name: 'Bed 2' });
  const third = bed({ id: 'bed_3', name: 'Bed 3' });

  const result = mergeCollections([first, second], [first, second], [first, second, third], {
    describe: describeBed,
  });

  assert.deepEqual(ids(mergedOf(result)), ['bed_1', 'bed_2', 'bed_3']);
});

test('an item the other device inserted in the middle lands after its predecessor', () => {
  const first = bed({ id: 'bed_1', name: 'Bed 1' });
  const inserted = bed({ id: 'bed_2', name: 'Bed 2' });
  const last = bed({ id: 'bed_3', name: 'Bed 3' });

  const result = mergeCollections([first, last], [first, last], [first, inserted, last], {
    describe: describeBed,
  });

  assert.deepEqual(ids(mergedOf(result)), ['bed_1', 'bed_2', 'bed_3']);
});

test('several consecutive items from the other device keep their relative order', () => {
  const first = bed({ id: 'bed_1', name: 'Bed 1' });
  const middleA = bed({ id: 'bed_2', name: 'Bed 2' });
  const middleB = bed({ id: 'bed_3', name: 'Bed 3' });
  const last = bed({ id: 'bed_4', name: 'Bed 4' });

  const result = mergeCollections([first, last], [first, last], [first, middleA, middleB, last], {
    describe: describeBed,
  });

  assert.deepEqual(ids(mergedOf(result)), ['bed_1', 'bed_2', 'bed_3', 'bed_4']);
});

test('an item from the other device whose predecessors were all deleted falls back to the top', () => {
  // The anchor scan walks backwards through `theirs` for something that survived
  // into the merge. Here the only predecessor was deleted on this device, so the
  // scan runs off the front of the array and the item is spliced in at 0 —
  // ahead of the bed it followed on the server.
  const removed = bed({ id: 'bed_1', name: 'Bed 1' });
  const kept = bed({ id: 'bed_2', name: 'Bed 2' });
  const added = bed({ id: 'bed_3', name: 'Bed 3' });

  const result = mergeCollections([removed, kept], [kept], [removed, added, kept], {
    describe: describeBed,
  });

  assert.deepEqual(ids(mergedOf(result)), ['bed_3', 'bed_2']);
});

test('deepEqual compares primitives by identity', () => {
  assert.equal(deepEqual(1, 1), true);
  assert.equal(deepEqual('Cherokee Purple', 'Cherokee Purple'), true);
  assert.equal(deepEqual(true, true), true);
  assert.equal(deepEqual(undefined, undefined), true);
  assert.equal(deepEqual(1, 2), false);
  assert.equal(deepEqual(1, '1'), false);
  assert.equal(deepEqual(0, false), false);
  assert.equal(deepEqual(undefined, null), false);
});

test('deepEqual treats null and an object as different', () => {
  assert.equal(deepEqual(null, null), true);
  assert.equal(deepEqual(null, {}), false);
  assert.equal(deepEqual({}, null), false);
  assert.equal(deepEqual(null, []), false);
});

test('deepEqual rejects arrays of differing length', () => {
  assert.equal(deepEqual([1, 2], [1, 2]), true);
  assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
  assert.equal(deepEqual([1, 2, 3], [1, 2]), false);
  assert.equal(deepEqual([1, 2], [2, 1]), false);
});

test('deepEqual rejects an array compared with a plain object', () => {
  assert.equal(deepEqual([], {}), false);
  assert.equal(deepEqual({}, []), false);
  assert.equal(deepEqual([1], { 0: 1 }), false);
});

test('deepEqual walks nested objects and arrays', () => {
  assert.equal(deepEqual(bed(), bed()), true);
  assert.equal(
    deepEqual(
      bed(),
      bed({
        layout: [
          ['Cherokee Purple', null, null],
          [null, null, null],
        ],
      }),
    ),
    false,
  );
  assert.equal(deepEqual({ a: { b: { c: [1, 2] } } }, { a: { b: { c: [1, 2] } } }), true);
  assert.equal(deepEqual({ a: { b: { c: [1, 2] } } }, { a: { b: { c: [1, 3] } } }), false);
});

test('deepEqual rejects objects with a different number of keys', () => {
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(deepEqual({ a: 1, b: 2 }, { a: 1 }), false);
});

test('deepEqual rejects objects with the same keys but different values', () => {
  assert.equal(deepEqual(seed(), seed({ purchaseYear: 2026 })), false);
  assert.equal(deepEqual(seed(), seed({ notes: '' })), false);
});

test('deepEqual ignores key order', () => {
  assert.equal(
    deepEqual(
      { variety: 'Cherokee Purple', purchaseYear: 2025 },
      { purchaseYear: 2025, variety: 'Cherokee Purple' },
    ),
    true,
  );
});

test('deepEqual rejects objects of equal size whose key sets differ', () => {
  assert.equal(deepEqual({ weightLbs: 3.4, count: 5 }, { weightLbs: 3.4, punnets: 5 }), false);
  assert.equal(deepEqual({ a: undefined }, { b: undefined }), false);
});

/**
 * The opt-in correction for packets filed under the wrong family.
 *
 * The rule under test, and the one that matters most, is that **nothing here
 * changes her data**. `findCategoryFixes` reports; `applyCategoryFix` returns a
 * new array and leaves the old one alone. The actual write happens only when
 * she clicks, in the component.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SeedPacket } from '@hpt/shared';
import {
  applyCategoryFix,
  categoryFixKey,
  explainCategoryFix,
  findCategoryFixes,
  readDismissals,
  writeDismissals,
} from '../src/lib/categoryFix.ts';

function packet(overrides: Partial<SeedPacket> = {}): SeedPacket {
  return {
    id: 'seed_cherry',
    variety: 'Cherry Tomato',
    category: 'Leafy Green',
    brand: 'Burpee',
    purchaseYear: 2026,
    notes: '',
    ...overrides,
  };
}

/** A `localStorage` stand-in, since the client suite has no DOM. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));

  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

test('her actual row is spotted, with the frost consequence attached', () => {
  const [fix, ...rest] = findCategoryFixes([packet()]);

  assert.equal(rest.length, 0);
  assert.equal(fix?.variety, 'Cherry Tomato');
  assert.equal(fix?.storedCategory, 'Leafy Green');
  assert.equal(fix?.suggestedCategory, 'Nightshade');
  assert.equal(fix?.storedTenderness, 'hardy');
  assert.equal(fix?.suggestedTenderness, 'tender');
  // This is the whole reason the nudge exists.
  assert.equal(fix?.frostTreatmentDiffers, true);
});

test('a packet already filed correctly is left alone', () => {
  assert.deepEqual(findCategoryFixes([packet({ category: 'Nightshade' })]), []);
});

test('a variety the catalogue does not know raises nothing', () => {
  // Silence is the right answer when you do not know. Guessing at somebody's
  // saved seed from a neighbour is worse than saying nothing.
  assert.deepEqual(findCategoryFixes([packet({ variety: 'Mystery packet from the swap' })]), []);
});

test('nothing is queried on a mere substring match', () => {
  // This is the guard rail that keeps the nudge worth trusting.
  //
  // "Sungold Cherry Tomato" really is a nightshade and the form would fill it
  // in as one, but overruling a decision she already made needs the whole name
  // to be a plant we know — because the same substring rule reads "Chocolate
  // Cherry", which is a cherry tomato, and would offer to "correct" it into a
  // berry. Being noisily wrong here costs more than staying quiet.
  assert.deepEqual(
    findCategoryFixes([packet({ variety: 'Sungold Cherry Tomato', category: 'Root' })]),
    [],
  );
  assert.deepEqual(
    findCategoryFixes([packet({ variety: "Nana's yellow beans from 1994", category: 'Leafy Green' })]),
    [],
  );
});

test('a cultivar named after another plant is filed by what it is', () => {
  // The catalogue carries the traps it knows about, so these are exact matches
  // and do get offered: Cherry Belle is a radish, Sugar Baby is a watermelon,
  // Black Beauty is an aubergine, Chocolate Cherry is a tomato.
  const fixes = findCategoryFixes([
    packet({ id: 'a', variety: 'Cherry Belle', category: 'Fruit' }),
    packet({ id: 'b', variety: 'Sugar Baby', category: 'Fruit' }),
    packet({ id: 'c', variety: 'Chocolate Cherry', category: 'Fruit' }),
  ]);

  assert.deepEqual(
    fixes.map((fix) => `${fix.variety} -> ${fix.suggestedCategory}`).sort(),
    ['Cherry Belle -> Root', 'Chocolate Cherry -> Nightshade', 'Sugar Baby -> Cucurbit'],
  );
});

test('an empty category is a gap, not a mistake', () => {
  // Nothing is being overridden, so there is nothing to ask permission for —
  // and the form now fills this in on the way past anyway.
  assert.deepEqual(findCategoryFixes([packet({ category: '' })]), []);
  assert.deepEqual(findCategoryFixes([packet({ category: '   ' })]), []);
});

test('a compound variety resolves through the same matcher the form uses', () => {
  const [fix] = findCategoryFixes([
    packet({ id: 'seed_grape', variety: 'Grape Tomato', category: 'Root' }),
  ]);

  assert.equal(fix?.suggestedCategory, 'Nightshade');
  assert.equal(fix?.plantName, 'Grape Tomato');
});

test('fixes the frost engine treats differently are offered first', () => {
  const fixes = findCategoryFixes([
    // Brassica and Root are both hardy: real, but not urgent.
    packet({ id: 'seed_radish', variety: 'Radish', category: 'Brassica' }),
    packet({ id: 'seed_cherry', variety: 'Cherry Tomato', category: 'Leafy Green' }),
  ]);

  assert.deepEqual(
    fixes.map((fix) => fix.variety),
    ['Cherry Tomato', 'Radish'],
  );
  assert.equal(fixes[1]?.frostTreatmentDiffers, false);
});

test('dismissing one disagreement hides exactly that one', () => {
  const seeds = [
    packet(),
    packet({ id: 'seed_basil', variety: 'Basil', category: 'Leafy Green' }),
  ];
  const dismissed = new Set([categoryFixKey('Cherry Tomato', 'Leafy Green')]);

  assert.deepEqual(
    findCategoryFixes(seeds, dismissed).map((fix) => fix.variety),
    ['Basil'],
  );
});

test('a dismissal survives a change of spelling or case', () => {
  // Refiling the same packet as "cherry tomato" must not resurrect a nudge she
  // has already waved away.
  const dismissed = new Set([categoryFixKey('Cherry Tomato', 'Leafy Green')]);

  assert.deepEqual(findCategoryFixes([packet({ variety: 'cherry tomato' })], dismissed), []);
  assert.deepEqual(findCategoryFixes([packet({ variety: '  Cherry  Tomato ' })], dismissed), []);
});

test('refiling under a different wrong category is a new question', () => {
  // She declined "is it a Nightshade rather than a Leafy Green". Filing it as a
  // Root later is a different disagreement and worth asking about.
  const dismissed = new Set([categoryFixKey('Cherry Tomato', 'Leafy Green')]);

  assert.equal(findCategoryFixes([packet({ category: 'Root' })], dismissed).length, 1);
});

test('applying a fix returns a new list and never touches the old one', () => {
  const original = packet();
  const seeds = [original, packet({ id: 'seed_basil', variety: 'Basil', category: 'Herb' })];
  const [fix] = findCategoryFixes(seeds);
  const updated = applyCategoryFix(seeds, fix!);

  assert.equal(updated[0]?.category, 'Nightshade');
  // The input is untouched, object identity and all.
  assert.equal(original.category, 'Leafy Green');
  assert.equal(seeds[0], original);
  assert.notEqual(updated[0], original);
  // Every other field of the corrected packet survives.
  assert.equal(updated[0]?.brand, 'Burpee');
  assert.equal(updated[0]?.purchaseYear, 2026);
  // And the untouched packet is the very same object, so React skips it.
  assert.equal(updated[1], seeds[1]);
});

test('applying a fix for a packet that has since gone changes nothing', () => {
  const seeds = [packet()];
  const [fix] = findCategoryFixes(seeds);

  assert.deepEqual(applyCategoryFix([], fix!), []);
});

test('the explanation names the consequence, not the taxonomy', () => {
  const [tender] = findCategoryFixes([packet()]);
  // The sentence this used to make — "so you are not being warned about this
  // one" — is no longer true, because the frost engine cross-checks the name and
  // errs towards tender. The banner has to say what is actually the case, which
  // is that the warning is leaning on the plant's name rather than her records,
  // and that the rotation reminder still believes the filing.
  assert.match(explainCategoryFix(tender!), /still warned about this one/);
  assert.doesNotMatch(explainCategoryFix(tender!), /not being warned/);
  assert.match(explainCategoryFix(tender!), /rotation reminder/);

  const [hardy] = findCategoryFixes([
    packet({ id: 'seed_kale', variety: 'Kale', category: 'Nightshade' }),
  ]);
  assert.match(explainCategoryFix(hardy!), /warned about when it does not need to be/);

  const [tidy] = findCategoryFixes([
    packet({ id: 'seed_radish', variety: 'Radish', category: 'Brassica' }),
  ]);
  assert.match(explainCategoryFix(tidy!), /treated the same way for frost/);
});

test('dismissals round-trip through storage', () => {
  const storage = fakeStorage();
  writeDismissals(storage, new Set(['a', 'b']));

  assert.deepEqual([...readDismissals(storage)].sort(), ['a', 'b']);
});

test('unreadable storage costs her the dismissals, never the seed vault', () => {
  assert.deepEqual([...readDismissals(undefined)], []);
  assert.deepEqual([...readDismissals(fakeStorage({ 'hpt.dismissedCategoryFixes': 'not json' }))], []);
  assert.deepEqual([...readDismissals(fakeStorage({ 'hpt.dismissedCategoryFixes': '{"a":1}' }))], []);
  assert.deepEqual(
    [...readDismissals(fakeStorage({ 'hpt.dismissedCategoryFixes': '["a", 7, null]' }))],
    ['a'],
  );

  // Writing into a full or unavailable store must not throw either.
  assert.doesNotThrow(() => writeDismissals(undefined, new Set(['a'])));
  const hostile = fakeStorage();
  hostile.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.doesNotThrow(() => writeDismissals(hostile, new Set(['a'])));
});

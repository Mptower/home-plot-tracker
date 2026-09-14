/**
 * Getting from "what she typed in a square" to "which crop family", which is
 * the step that decides whether she is warned at all.
 *
 * The bug this closes is a silence, not a wrong answer: a square the app cannot
 * categorise resolves to `unknown`, an `unknown` square never puts a bed on the
 * at-risk list, and she is never told. So the tests here are mostly about what
 * is *no longer* silent — and, just as deliberately, about what still is.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFrostRisk } from '../src/ha/frost.ts';
import type { ForecastPoint } from '../src/ha/frost.ts';
import { buildCategoryLookup } from '../src/ha/varietyCategory.ts';
import { tendernessOf } from '../src/ha/tenderness.ts';
import { bed, seed } from './helpers.ts';

const NOW = new Date('2026-10-09T12:00:00-04:00');

function ahead(days: number, hour = 23): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);

  return date.toISOString();
}

function point(at: string, lowF: number): ForecastPoint {
  return { at, lowF, precision: 'day' };
}

// ------------------------------------------------------------------ tier 1: exact

test('a packet matched exactly still wins, and wins first', () => {
  const lookup = buildCategoryLookup([
    seed({ id: 's1', variety: 'Corn Salad', category: 'Leafy Green' }),
    seed({ id: 's2', variety: 'Corn', category: 'Other' }),
  ]);

  // "Corn Salad" is a salad, not corn. The exact tier is what guarantees the
  // longer packet name is not lost to a tolerant hit on the shorter one.
  assert.equal(lookup('Corn Salad'), 'Leafy Green');
  assert.equal(lookup('Corn'), 'Other');
});

// --------------------------------------------------------------- tier 2: tolerant

test('a packet is found through case, accents and punctuation', () => {
  const lookup = buildCategoryLookup([seed({ variety: 'Jalapeño', category: 'Nightshade' })]);

  assert.equal(lookup('Jalapeño'), 'Nightshade');
  assert.equal(lookup('jalapeno'), 'Nightshade');
  assert.equal(lookup('JALAPEÑO!'), 'Nightshade');
  assert.equal(lookup('  Jalapeno  '), 'Nightshade');
});

test('a plural square finds the singular packet', () => {
  const lookup = buildCategoryLookup([
    seed({ id: 's1', variety: 'Cherry Tomato', category: 'Nightshade' }),
    seed({ id: 's2', variety: 'Radish', category: 'Root' }),
  ]);

  assert.equal(lookup('Cherry Tomatoes'), 'Nightshade');
  // The spelling people actually type, as well as the correct one.
  assert.equal(lookup('cherry tomatos'), 'Nightshade');
  assert.equal(lookup('Radishes'), 'Root');
});

test('plurals are generated forwards from the packet, never stripped off the square', () => {
  // Stripping a trailing "s" from user input is how "Brussels" becomes
  // "Brussel" and "cress" becomes "cres". The packet name is the known word, so
  // it is the one that gets pluralised.
  const lookup = buildCategoryLookup([seed({ variety: 'Cress', category: 'Leafy Green' })]);

  assert.equal(lookup('Cress'), 'Leafy Green');
  assert.equal(lookup('cress'), 'Leafy Green');
});

test('a tolerant vault hit still beats the catalogue', () => {
  // She filed her cherry tomatoes as a leafy green. Typing it in lower case must
  // not quietly switch her to the catalogue's opinion — that is the vault
  // winning, and it is what makes the fix-it banner worth trusting.
  const lookup = buildCategoryLookup([seed({ variety: 'Cherry Tomato', category: 'Leafy Green' })]);

  assert.equal(lookup('cherry tomato'), 'Leafy Green');
  assert.equal(lookup('Cherry Tomato'), 'Leafy Green');
});

// -------------------------------------------------------------- tier 3: catalogue

test('a planting with no packet at all gets a family from the catalogue', () => {
  const lookup = buildCategoryLookup([]);

  assert.equal(lookup('Sungold'), 'Nightshade');
  assert.equal(lookup('Zucchini'), 'Cucurbit');
  assert.equal(lookup('Kale'), 'Brassica');
  // Whole-word span inside a longer name, nearest the end: a cherry tomato is a
  // tomato, and a sugar baby watermelon is a melon.
  assert.equal(lookup('Sugar Baby Watermelon'), 'Cucurbit');
  assert.equal(lookup('Genovese Basil'), 'Herb');
});

test('the vault takes precedence over the catalogue, never the other way round', () => {
  const lookup = buildCategoryLookup([seed({ variety: 'Sungold', category: 'Leafy Green' })]);

  // The catalogue is certain Sungold is a tomato. It is not asked.
  assert.equal(lookup('Sungold'), 'Leafy Green');
});

test('a packet whose category means nothing falls through to the catalogue', () => {
  // Free text from before the app offered a category list. The vault has not
  // told us anything usable, so treating it as an answer would leave the square
  // `unknown` and unwarned — which is the exact bug this file exists to close.
  const lookup = buildCategoryLookup([seed({ variety: 'Cherry Tomato', category: 'Tomatoes' })]);

  assert.equal(tendernessOf('Tomatoes'), 'unknown');
  assert.equal(lookup('Cherry Tomato'), 'Nightshade');
});

// ------------------------------------------------------------ tier 4: still silent

test('the catalogue declines to guess rather than answering confidently wrong', () => {
  const lookup = buildCategoryLookup([]);

  assert.equal(lookup('Peppercorn'), null);
  assert.equal(lookup('Who Knows'), null);
  assert.equal(lookup('Something Else'), null);
  assert.equal(lookup(''), null);
  assert.equal(lookup('   '), null);
});

test('a word that merely contains a plant name is not that plant', () => {
  const lookup = buildCategoryLookup([]);

  // Whole-word spans only. "Peppermint" and "Horseradish" are in the catalogue
  // in their own right, so the interesting assertion is not that they resolve
  // but that they resolve to what they actually are — a mint and a brassica,
  // not a capsicum and a root.
  assert.equal(lookup('Peppermint'), 'Herb');
  assert.equal(lookup('Horseradish'), 'Brassica');
  assert.equal(lookup('Pepper'), 'Nightshade');
  assert.equal(lookup('Radish'), 'Root');
});

test('nothing reaches through a prototype and comes back a category', () => {
  // The keys on both sides come from text boxes.
  const lookup = buildCategoryLookup([seed({ variety: 'Kale', category: 'Brassica' })]);

  assert.equal(lookup('constructor'), null);
  assert.equal(lookup('toString'), null);
  assert.equal(lookup('__proto__'), null);
  assert.equal(lookup('hasOwnProperty'), null);
});

test('a malformed packet cannot break the index', () => {
  const lookup = buildCategoryLookup([
    { id: 'junk', variety: null, category: 'Nightshade' },
    { id: 'junk2', category: 'Nightshade' },
    seed({ variety: 'Kale', category: 'Brassica' }),
  ] as never);

  assert.equal(lookup('Kale'), 'Brassica');
});

test('the first packet wins when two fold to the same key', () => {
  // Deterministic, matching the catalogue's own tie-break, so the answer can
  // never depend on the order rows came back from SQLite.
  const seeds = [
    seed({ id: 's1', variety: 'Pepper', category: 'Nightshade' }),
    seed({ id: 's2', variety: 'PEPPER', category: 'Leafy Green' }),
  ];

  assert.equal(buildCategoryLookup(seeds)('peppers'), 'Nightshade');
});

// ------------------------------------------------------- end to end, as a warning

test('a bed planted from the plant list is now warned about', () => {
  // The gap this change closes. Before it, an empty vault meant an empty
  // warning, however cold the night and however tender the plant.
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 30)],
    beds: [
      bed({
        name: 'Bed 1 - Raised',
        layout: [
          ['Sungold', 'Zucchini', null],
          ['Lacinato Kale', null, null],
        ],
      }),
    ],
    seeds: [],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.ok(watch);
  assert.equal(watch.severity, 'frost');
  assert.deepEqual(watch.tenderVarieties, ['Sungold', 'Zucchini']);
  assert.deepEqual(watch.hardyVarieties, ['Lacinato Kale']);
  assert.deepEqual(watch.bedsAtRisk.map((b) => b.bedName), ['Bed 1 - Raised']);
  assert.equal(watch.unknownSquareCount, 0);
});

test('a square spelled differently from the packet is warned about', () => {
  // Her own data: a packet called "Cherry Tomato", a square that says
  // "cherry tomatoes". Before this, that square was `unknown` and silent.
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 30)],
    beds: [bed({ layout: [['cherry tomatoes', null, null], [null, null, null]] })],
    seeds: [seed({ variety: 'Cherry Tomato', category: 'Nightshade' })],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(watch?.severity, 'frost');
  assert.deepEqual(watch?.tenderVarieties, ['cherry tomatoes']);
  assert.equal(watch?.unknownSquareCount, 0);
});

test('a packet filed as something hardy is still trusted, and still silent', () => {
  // The user-facing decision behind all of this: the catalogue fills gaps, it
  // does not overrule her. Correcting this packet is CategoryFixBanner's job,
  // and the banner's promise depends on this staying true.
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 30)],
    beds: [bed({ layout: [['Cherry Tomato', null, null], [null, null, null]] })],
    seeds: [seed({ variety: 'Cherry Tomato', category: 'Leafy Green' })],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(watch?.severity, 'none');
  assert.deepEqual(watch?.bedsAtRisk, []);
  // Classified, so not counted as a gap either. It is a decision, not a silence.
  assert.equal(watch?.unknownSquareCount, 0);
});

test('a name nothing can place is still unknown, and still raises nothing', () => {
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 30)],
    beds: [bed({ layout: [['Who Knows', null, null], [null, null, null]] })],
    seeds: [],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(watch?.severity, 'none');
  assert.equal(watch?.unknownSquareCount, 1);
});

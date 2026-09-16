/**
 * Getting from "what she typed in a square" to "which crop family", which is
 * the step that decides whether she is warned at all.
 *
 * The bug this closes is a silence, not a wrong answer: a square the app cannot
 * categorise resolves to `unknown`, an `unknown` square never puts a bed on the
 * at-risk list, and she is never told. So the tests here are mostly about what
 * is *no longer* silent — and, just as deliberately, about what still is.
 *
 * The category and the tenderness are tested separately below, because they are
 * separate answers. `buildCategoryLookup` says what she filed; only
 * `buildTendernessLookup` is allowed to be more cautious than she was, and only
 * about the cold.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFrostRisk } from '../src/ha/frost.ts';
import type { ForecastPoint } from '../src/ha/frost.ts';
import { buildCategoryLookup, buildTendernessLookup } from '../src/ha/varietyCategory.ts';
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

// ------------------------------------------- tenderness: the one-way safety bias

test('a tomato filed as a leafy green is treated as tender without being refiled', () => {
  // Her row. The category is untouched — the vault still shows what she typed,
  // and rotation still counts that bed as a leafy green — but the frost engine
  // asks a different question and gets the cautious answer.
  const seeds = [seed({ variety: 'Cherry Tomato', category: 'Leafy Green' })];

  assert.equal(buildCategoryLookup(seeds)('Cherry Tomato'), 'Leafy Green');
  assert.equal(tendernessOf('Leafy Green'), 'hardy');
  assert.equal(buildTendernessLookup(seeds)('Cherry Tomato'), 'tender');
});

test('a genuinely hardy packet filed as a leafy green stays hardy', () => {
  // The control. Kale is a brassica rather than a leafy green, so the catalogue
  // disagrees with her filing here too — but both readings are hardy, so
  // nothing moves. This is what makes the bias targeted rather than a blanket
  // "treat everything as tender".
  const seeds = [seed({ variety: 'Kale', category: 'Leafy Green' })];

  assert.equal(buildCategoryLookup(seeds)('Kale'), 'Leafy Green');
  assert.equal(buildTendernessLookup(seeds)('Kale'), 'hardy');
});

test('the bias only ever travels towards tender', () => {
  // Filed `Other`, which is tender; the catalogue calls rhubarb a `Fruit`,
  // which is hardy. Her reading is the more cautious one, so it stands. The
  // catalogue is never allowed to talk the frost engine out of a warning.
  const seeds = [seed({ variety: 'Rhubarb', category: 'Other' })];

  assert.equal(tendernessOf('Other'), 'tender');
  assert.equal(tendernessOf('Fruit'), 'hardy');
  assert.equal(buildTendernessLookup(seeds)('Rhubarb'), 'tender');
});

test('a loose catalogue match is not grounds for overruling her', () => {
  // "Sugar Baby Watermelon" is not a catalogue entry; `sugar baby` is found
  // inside it. That is enough to fill a blank and not enough to overturn
  // something she typed — the same bar `categoryFix.ts` holds itself to, and the
  // reason "Chocolate Cherry" never gets read as a berry.
  const seeds = [seed({ variety: 'Sugar Baby Watermelon', category: 'Leafy Green' })];

  assert.equal(buildTendernessLookup(seeds)('Sugar Baby Watermelon'), 'hardy');
  // Without a packet the loose match is still allowed to fill the gap, because
  // there is nothing to overrule.
  assert.equal(buildTendernessLookup([])('Sugar Baby Watermelon'), 'tender');
});

test('a plural or oddly-spelled square is still an exact match', () => {
  // The bias would be worth very little if it only fired on the one spelling
  // she happened to use. Plurals and casing are keys the catalogue generates for
  // `Cherry Tomato` itself, so they resolve exactly rather than loosely.
  const lookup = buildTendernessLookup([
    seed({ variety: 'Cherry Tomato', category: 'Leafy Green' }),
  ]);

  assert.equal(lookup('cherry tomatoes'), 'tender');
  assert.equal(lookup('CHERRY TOMATO'), 'tender');
});

test('a square nothing can place is still unknown, and unknown is never promoted', () => {
  const lookup = buildTendernessLookup([seed({ variety: 'Cherry Tomato', category: 'Leafy Green' })]);

  assert.equal(lookup('Who Knows'), 'unknown');
  assert.equal(lookup('Peppercorn'), 'unknown');
  assert.equal(lookup(''), 'unknown');
});

test('the bias hands back no category for anything else to pick up', () => {
  // The guarantee that keeps crop rotation reading her records. There is no
  // route from here to a category, by construction: the only thing this resolver
  // returns is a tenderness.
  const seeds = [seed({ variety: 'Cherry Tomato', category: 'Leafy Green' })];
  const tenderness = buildTendernessLookup(seeds)('Cherry Tomato');

  assert.equal(tenderness, 'tender');
  assert.equal(buildCategoryLookup(seeds)('Cherry Tomato'), 'Leafy Green');
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

test('a packet filed as something hardy is still trusted, and now still warned about', () => {
  // This test used to assert the opposite, and the decision behind it was a
  // real one: the catalogue fills gaps, it does not overrule her. That is still
  // true of the category — the assertion below says so — and `CategoryFixBanner`
  // still exists to offer the correction.
  //
  // What changed is that "do not overrule her" was being paid for on the one
  // night it mattered. She filed a tomato as a leafy green, and the cost of
  // trusting that at 30°F is a dead plant, while the cost of doubting it is a
  // bedsheet. Those are not the same size, so the frost engine no longer splits
  // the difference.
  const seeds = [seed({ variety: 'Cherry Tomato', category: 'Leafy Green' })];
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 30)],
    beds: [bed({ layout: [['Cherry Tomato', null, null], [null, null, null]] })],
    seeds,
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(watch?.severity, 'frost');
  assert.deepEqual(watch?.tenderVarieties, ['Cherry Tomato']);
  // Classified, so not counted as a gap either. It is a decision, not a silence.
  assert.equal(watch?.unknownSquareCount, 0);
  // Her filing is untouched. Nothing was rewritten to make the warning happen.
  assert.equal(buildCategoryLookup(seeds)('Cherry Tomato'), 'Leafy Green');
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

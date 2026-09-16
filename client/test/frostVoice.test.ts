/**
 * The frost voice.
 *
 * These live in the client workspace for the same reason `plants.test.ts` does:
 * `@hpt/shared` has no test runner of its own, and the client is the newest
 * consumer of this module. They are pure-function tests because the wording is
 * a pure function — which is the whole reason `FrostBanner.tsx` is now a thin
 * renderer over `frostSentences`. There is no DOM test here and there should
 * not be one; if a sentence is worth pinning it belongs below, not behind a
 * component-testing dependency the client does not otherwise need.
 *
 * What is being defended:
 *
 * * **One voice on two surfaces.** Her phone and the banner describe the same
 *   night. Anything asserted here is asserted for both.
 * * **The retired jargon stays retired.** "Tender" and "crop family" are words
 *   she has never used, and the banner was the last place still saying them.
 * * **The banner's economies are the ones a screen justifies.** It differs from
 *   the notification in exactly two ways — it names every crop and every bed —
 *   and those are options, not a second implementation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BedAtRisk, FrostWatch } from '@hpt/shared';
import { frostHeadline, frostSentences, joinNames } from '@hpt/shared';

/** What the banner passes: a surface with room to name the whole garden. */
const BANNER = { nameLimit: Infinity, bedLimit: Infinity };

function bed(bedName: string, tender: string[], hardy: string[] = []): BedAtRisk {
  return { bedId: bedName, bedName, tender, hardy, unknown: [] };
}

function watch(overrides: Partial<FrostWatch> = {}): FrostWatch {
  const severity = overrides.severity ?? 'frost';
  const night = overrides.night ?? '2026-10-10';

  return {
    severity,
    lowF: 31,
    expectedAt: '2026-10-11T10:00:00Z',
    precision: 'hour',
    night,
    observedAt: '2026-10-09T17:00:00Z',
    bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato'])],
    tenderVarieties: ['Cherry Tomato'],
    hardyVarieties: ['Kale'],
    unknownSquareCount: 0,
    eventKey: `${night}:${severity}`,
    ...overrides,
  };
}

/** Everything the banner would render, in the order it renders it. */
function bannerText(w: FrostWatch, hour = '5am'): string {
  const said = frostSentences(w, hour, BANNER);

  return [...said.lead, said.caveat, said.aside, said.reassurance, said.unrecorded]
    .filter((sentence) => sentence !== '')
    .join(' ');
}

test('the frost leads with what to go and do', () => {
  const said = frostSentences(watch(), '5am', BANNER);

  assert.equal(said.action, 'Cover your Cherry Tomato in Tomato bed');
  assert.equal(said.actionIsOpenClause, true);
  assert.deepEqual(said.lead, ["Cover your Cherry Tomato in Tomato bed — it'll be coldest around 5am."]);
});

test('one bed is named inline, so the dash is free for the hour', () => {
  assert.equal(
    bannerText(watch({ hardyVarieties: [] })),
    "Cover your Cherry Tomato in Tomato bed — it'll be coldest around 5am.",
  );
});

test('no bed at all still reads as a sentence', () => {
  // The old banner said "Your Cherry Tomato are tender." here — wrong number as
  // well as wrong voice.
  assert.equal(
    bannerText(watch({ bedsAtRisk: [], hardyVarieties: [] })),
    "Cover your Cherry Tomato — it'll be coldest around 5am.",
  );
});

test('two beds are split off with the dash, so the two lists cannot collide', () => {
  const said = frostSentences(
    watch({
      tenderVarieties: ['Cherry Tomato', 'Jalapeño', 'Basil'],
      bedsAtRisk: [
        bed('Tomato bed', ['Cherry Tomato', 'Jalapeño']),
        bed('Bed 2', ['Basil'], ['Kale']),
      ],
    }),
    '3am',
    BANNER,
  );

  assert.equal(said.actionIsOpenClause, false);
  assert.deepEqual(said.lead, [
    "Cover your Cherry Tomato, Jalapeño and Basil — they're in Tomato bed and Bed 2.",
    "It'll be coldest around 3am.",
  ]);
  // At most one dash, whichever job it is doing.
  assert.equal(said.lead.join(' ').split('—').length - 1, 1);
});

test('one crop in several beds still agrees with itself', () => {
  const said = frostSentences(
    watch({
      hardyVarieties: [],
      bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato']), bed('Bed 2', ['Cherry Tomato'])],
    }),
    '5am',
    BANNER,
  );

  assert.match(said.action, /— it's in Tomato bed and Bed 2\./);
});

test('a bed holding nothing tender is not named as though it were', () => {
  const said = frostSentences(
    watch({
      bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato']), bed('Kale bed', [], ['Kale'])],
    }),
    '5am',
    BANNER,
  );

  assert.doesNotMatch(said.action, /Kale bed/);
});

/**
 * The one thing the banner is allowed to say differently.
 *
 * A lock screen collapses four beds into a count because the names stop being
 * readable there. A panel on a page she opened has room for all of them, and a
 * count is strictly less useful than the list it replaces.
 */

test('the banner names every bed, however many there are', () => {
  const many = watch({
    tenderVarieties: ['Cherry Tomato', 'Jalapeño'],
    hardyVarieties: [],
    bedsAtRisk: [
      bed('Tomato bed', ['Cherry Tomato']),
      bed('Bed 2', ['Jalapeño']),
      bed('Bed 3', ['Jalapeño']),
      bed('Herb spiral', ['Jalapeño']),
      bed('The long one by the fence', ['Jalapeño']),
    ],
  });

  assert.equal(
    bannerText(many, '4am'),
    'Cover your Cherry Tomato and Jalapeño — ' +
      "they're in Tomato bed, Bed 2, Bed 3, Herb spiral and The long one by the fence. " +
      "It'll be coldest around 4am.",
  );
  assert.doesNotMatch(bannerText(many, '4am'), /spread across/);
  // And never the reading the old banner produced: "Bed 3 and 2 more" parses as
  // a bed called "2 more".
  assert.doesNotMatch(bannerText(many, '4am'), /and \d+ more/);
});

test('the notification still collapses them, because a lock screen has to', () => {
  const many = watch({
    tenderVarieties: ['Cherry Tomato', 'Jalapeño'],
    hardyVarieties: [],
    bedsAtRisk: [
      bed('Tomato bed', ['Cherry Tomato']),
      bed('Bed 2', ['Jalapeño']),
      bed('Bed 3', ['Jalapeño']),
      bed('Herb spiral', ['Jalapeño']),
    ],
  });

  // Defaults are the notification's, so the two surfaces differ only where a
  // caller asked them to.
  assert.match(frostSentences(many, '4am').action, /they're spread across 4 beds\./);
});

test('the banner names every crop, however many there are', () => {
  const crowded = watch({
    tenderVarieties: ['Basil', 'Cherry Tomato', 'Jalapeño', 'Zucchini'],
    hardyVarieties: [],
    bedsAtRisk: [bed('Tomato bed', ['Basil', 'Cherry Tomato', 'Jalapeño', 'Zucchini'])],
  });

  assert.equal(
    bannerText(crowded, '4am'),
    'Cover your Basil, Cherry Tomato, Jalapeño and Zucchini in Tomato bed — ' +
      "it'll be coldest around 4am.",
  );
  // The old banner read "Basil, Cherry Tomato and Jalapeño and 1 more".
  assert.doesNotMatch(bannerText(crowded, '4am'), /and 1 more/);
  assert.match(frostSentences(crowded, '4am').action, /Basil, Cherry Tomato, Jalapeño and 1 more/);
});

test('one crop and many crops both read as English', () => {
  assert.match(frostSentences(watch(), '5am', BANNER).action, /Cover your Cherry Tomato in/);
  assert.match(
    frostSentences(
      watch({
        tenderVarieties: ['Cherry Tomato', 'Basil'],
        bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato', 'Basil'])],
      }),
      '5am',
      BANNER,
    ).action,
    /Cover your Cherry Tomato and Basil in/,
  );
});

/** The reassuring half, and its hard-freeze replacement. */

test('the reassurance stays hedged, because a forecast is not a promise', () => {
  const said = frostSentences(watch(), '5am', BANNER);

  assert.equal(said.reassurance, 'The Kale should be fine.');
  assert.equal(said.aside, '');
  assert.equal(said.caveat, '');
  assert.doesNotMatch(said.reassurance, /will be fine/);
});

test('nothing hardy planted means nothing to reassure her about', () => {
  assert.equal(frostSentences(watch({ hardyVarieties: [] }), '5am', BANNER).reassurance, '');
});

test('a hard freeze does not tell her to cover what a cover cannot save', () => {
  const said = frostSentences(watch({ severity: 'hard_freeze', lowF: 24 }), '5am', BANNER);

  assert.match(said.action, /^Pick what you can from your Cherry Tomato in Tomato bed/);
  assert.doesNotMatch(said.action, /Cover your/);
  assert.equal(said.caveat, "A cover won't be enough this cold.");
  // At 24°F the kale is no longer "fine" either, and saying nothing about it —
  // which is what the banner used to do — loses her the whole hardy half.
  assert.equal(said.aside, 'Even the Kale may take damage.');
  assert.equal(said.reassurance, '');
});

test('the banner carries the two sentences the notification drops first', () => {
  assert.equal(
    bannerText(watch({ severity: 'hard_freeze', lowF: 24 })),
    "Pick what you can from your Cherry Tomato in Tomato bed — it'll be coldest around 5am. " +
      "A cover won't be enough this cold. Even the Kale may take damage.",
  );
});

test('a hard freeze with only hardy crops names them instead of overstating it', () => {
  // The old banner said "Everything planted is at risk at this temperature."
  // here — no crops named, and untrue about the beds that are empty.
  const said = frostSentences(
    watch({
      severity: 'hard_freeze',
      lowF: 24,
      tenderVarieties: [],
      hardyVarieties: ['Kale', 'Carrots'],
      bedsAtRisk: [bed('Kale bed', [], ['Kale', 'Carrots'])],
    }),
    '5am',
    BANNER,
  );

  assert.equal(said.action, "It's cold enough to damage even your Kale and Carrots.");
  assert.equal(said.actionIsOpenClause, false);
  assert.equal(said.caveat, '');
  assert.equal(said.aside, '');
});

test('a hard freeze over an empty garden still finishes its sentence', () => {
  const said = frostSentences(
    watch({
      severity: 'hard_freeze',
      lowF: 24,
      tenderVarieties: [],
      hardyVarieties: [],
      bedsAtRisk: [],
    }),
    '5am',
    BANNER,
  );

  assert.equal(said.action, "It's cold enough to damage anything still in the ground.");
});

test('nothing at risk is coherent even though no surface shows it', () => {
  // `severity: 'none'` is refused by the notifier and returns `null` from the
  // banner before this is reached. Dead wording rots, so it is still pinned.
  const said = frostSentences(
    watch({ severity: 'none', lowF: 38, tenderVarieties: [], bedsAtRisk: [] }),
    '5am',
    BANNER,
  );

  assert.equal(said.action, "Nothing you've planted should mind a night this cold.");
});

/** The hour, and the honesty about not knowing it. */

test('an hourly forecast names the hour', () => {
  assert.equal(frostSentences(watch(), '5am', BANNER).hour, "It'll be coldest around 5am.");
});

test('a daily forecast invents nothing', () => {
  const said = frostSentences(watch({ precision: 'day' }), '', BANNER);

  assert.equal(said.hour, '');
  assert.deepEqual(said.lead, ['Cover your Cherry Tomato in Tomato bed.']);
  // Never the bare fragment the old banner used, and never a dangling dash.
  assert.doesNotMatch(bannerText(watch({ precision: 'day' }), ''), /Coldest around/);
  assert.doesNotMatch(bannerText(watch({ precision: 'day' }), ''), /—\s*$/);
});

test('the hour is a whole sentence when it cannot hang off the opening', () => {
  const said = frostSentences(
    watch({
      hardyVarieties: [],
      bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato']), bed('Bed 2', ['Cherry Tomato'])],
    }),
    '5am',
    BANNER,
  );

  assert.equal(said.lead.length, 2);
  assert.equal(said.lead[1], "It'll be coldest around 5am.");
  // "Coldest around 5am." was the banner's old fragment. It is not a sentence.
  assert.doesNotMatch(said.lead.join(' '), /(^|\. )Coldest around/);
});

/** The squares it cannot speak for. */

test('one unrecorded square is admitted in the singular', () => {
  assert.equal(
    frostSentences(watch({ unknownSquareCount: 1 }), '5am', BANNER).unrecorded,
    "1 square doesn't have a plant recorded, so it's not included.",
  );
});

test('several unrecorded squares are admitted in the plural', () => {
  assert.equal(
    frostSentences(watch({ unknownSquareCount: 3 }), '5am', BANNER).unrecorded,
    "3 squares don't have a plant recorded, so they're not included.",
  );
});

test('a fully recorded garden says nothing about squares', () => {
  assert.equal(frostSentences(watch(), '5am', BANNER).unrecorded, '');
});

/** The headline, which both surfaces now render identically. */

test('the headline names the band, the night and the temperature', () => {
  assert.equal(frostHeadline(watch(), 'tonight'), 'Frost tonight — 31°F');
  assert.equal(
    frostHeadline(watch({ severity: 'advisory', lowF: 34.4 }), 'tomorrow night'),
    'Frost possible tomorrow night — 34°F',
  );
  assert.equal(
    frostHeadline(watch({ severity: 'hard_freeze', lowF: 24 }), 'Wednesday night'),
    'Hard freeze Wednesday night — 24°F',
  );
  // The banner used to join these with a comma while her phone used a dash.
  assert.doesNotMatch(frostHeadline(watch(), 'tonight'), /night,/);
});

/** The list helper the banner used to have a broken copy of. */

test('names are joined the way a person would say them', () => {
  assert.equal(joinNames([]), '');
  assert.equal(joinNames(['Basil']), 'Basil');
  assert.equal(joinNames(['Basil', 'Kale']), 'Basil and Kale');
  assert.equal(joinNames(['Basil', 'Kale', 'Carrots']), 'Basil, Kale and Carrots');
});

test('an overflowing list never says "and" twice', () => {
  // The banner's own copy produced "A, B and C and 2 more", which is where it
  // stopped sounding like a person.
  assert.equal(joinNames(['A', 'B', 'C', 'D', 'E']), 'A, B, C and 2 more');
  assert.doesNotMatch(joinNames(['A', 'B', 'C', 'D', 'E']), /and.*and/);
});

test('an unlimited list is simply the whole list', () => {
  assert.equal(joinNames(['A', 'B', 'C', 'D', 'E'], Infinity), 'A, B, C, D and E');
});

/**
 * The guard.
 *
 * Mirrors "the botany does not come back" in `server/test/ha-notify.test.ts`.
 * She should not have to know what "tender" means to read a warning, and after
 * the plant catalogue landed she should never see the words "crop family" — the
 * banner was the last place in the app still saying both.
 */
test('the botany does not come back', () => {
  const shapes: FrostWatch[] = [
    watch(),
    watch({ severity: 'advisory', lowF: 35 }),
    watch({ severity: 'hard_freeze', lowF: 24 }),
    watch({ precision: 'day' }),
    watch({ unknownSquareCount: 1 }),
    watch({ unknownSquareCount: 7 }),
    watch({ hardyVarieties: [] }),
    watch({ bedsAtRisk: [], hardyVarieties: [] }),
    watch({
      severity: 'hard_freeze',
      lowF: 24,
      tenderVarieties: [],
      hardyVarieties: ['Kale', 'Carrots'],
      bedsAtRisk: [bed('Kale bed', [], ['Kale', 'Carrots'])],
    }),
    watch({
      tenderVarieties: ['Cherry Tomato', 'Basil'],
      bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato']), bed('Bed 2', ['Basil'])],
    }),
    watch({ severity: 'none', lowF: 38, tenderVarieties: [], bedsAtRisk: [] }),
  ];

  for (const shape of shapes) {
    for (const hour of ['5am', '']) {
      const text = bannerText(shape, hour);

      assert.doesNotMatch(text, /tender/i, `"tender" is back in: ${text}`);
      assert.doesNotMatch(text, /crop famil/i, `"crop family" is back in: ${text}`);
      assert.doesNotMatch(text, /uncatalogu/i, `"uncatalogued" is back in: ${text}`);
      assert.doesNotMatch(text, /hardy/i, `"hardy" is back in: ${text}`);
      // Every sentence is a whole sentence, so every one of them ends in a stop.
      assert.match(text, /\.$/, `not a finished sentence: ${text}`);
    }
  }
});

test('the banner gives nothing up, whatever the garden looks like', () => {
  // The notification has a 200-character ceiling and drops sentences from the
  // end to stay under it. The banner is on a screen she chose to look at; the
  // crowded garden that costs her the unrecorded-squares admission on her phone
  // must keep it here.
  const crowded = watch({
    tenderVarieties: ['Basil', 'Black Beauty', 'Cherry Tomato', 'Jalapeño', 'Zucchini'],
    hardyVarieties: ['Carrots', 'Garlic', 'Kale'],
    bedsAtRisk: [
      bed('Tomato bed', ['Black Beauty', 'Cherry Tomato']),
      bed('Bed 2', ['Basil']),
      bed('Bed 3', ['Jalapeño']),
      bed('Herb spiral', ['Basil']),
      bed('The long one by the fence', ['Zucchini']),
    ],
    unknownSquareCount: 4,
  });

  const text = bannerText(crowded, '5am');

  assert.ok(text.length > 200, `expected more than a notification would carry, got ${text.length}`);
  assert.match(text, /4 squares don't have a plant recorded, so they're not included\.$/);
  assert.match(text, /The Carrots, Garlic and Kale should be fine\./);
  assert.match(text, /The long one by the fence/);
});

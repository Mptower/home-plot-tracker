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
 * * **The hour is a bare hour.** `frostSentences` builds the preamble around
 *   it, so a caller passing the finished clause renders it twice. That is a
 *   `ColdestHour` now, and — because the caller who hit it was JavaScript and a
 *   brand would have saved it nothing — guarded at runtime as well.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { BedAtRisk, ColdestHour, FrostWatch } from '@hpt/shared';
import { coldestHour, frostHeadline, frostSentences, isColdestHour, joinNames } from '@hpt/shared';

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
  const said = frostSentences(w, coldestHour(hour), BANNER);

  return [...said.lead, said.caveat, said.aside, said.reassurance, said.unrecorded]
    .filter((sentence) => sentence !== '')
    .join(' ');
}

test('the frost leads with what to go and do', () => {
  const said = frostSentences(watch(), coldestHour('5am'), BANNER);

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
    coldestHour('3am'),
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
    coldestHour('5am'),
    BANNER,
  );

  assert.match(said.action, /— it's in Tomato bed and Bed 2\./);
});

test('a bed holding nothing tender is not named as though it were', () => {
  const said = frostSentences(
    watch({
      bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato']), bed('Kale bed', [], ['Kale'])],
    }),
    coldestHour('5am'),
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
  assert.match(frostSentences(many, coldestHour('4am')).action, /they're spread across 4 beds\./);
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
  assert.match(frostSentences(crowded, coldestHour('4am')).action, /Basil, Cherry Tomato, Jalapeño and 1 more/);
});

test('one crop and many crops both read as English', () => {
  assert.match(frostSentences(watch(), coldestHour('5am'), BANNER).action, /Cover your Cherry Tomato in/);
  assert.match(
    frostSentences(
      watch({
        tenderVarieties: ['Cherry Tomato', 'Basil'],
        bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato', 'Basil'])],
      }),
      coldestHour('5am'),
      BANNER,
    ).action,
    /Cover your Cherry Tomato and Basil in/,
  );
});

/** The reassuring half, and its hard-freeze replacement. */

test('the reassurance stays hedged, because a forecast is not a promise', () => {
  const said = frostSentences(watch(), coldestHour('5am'), BANNER);

  assert.equal(said.reassurance, 'The Kale should be fine.');
  assert.equal(said.aside, '');
  assert.equal(said.caveat, '');
  assert.doesNotMatch(said.reassurance, /will be fine/);
});

test('nothing hardy planted means nothing to reassure her about', () => {
  assert.equal(frostSentences(watch({ hardyVarieties: [] }), coldestHour('5am'), BANNER).reassurance, '');
});

test('a hard freeze does not tell her to cover what a cover cannot save', () => {
  const said = frostSentences(watch({ severity: 'hard_freeze', lowF: 24 }), coldestHour('5am'), BANNER);

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
    coldestHour('5am'),
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
    coldestHour('5am'),
    BANNER,
  );

  assert.equal(said.action, "It's cold enough to damage anything still in the ground.");
});

test('nothing at risk is coherent even though no surface shows it', () => {
  // `severity: 'none'` is refused by the notifier and returns `null` from the
  // banner before this is reached. Dead wording rots, so it is still pinned.
  const said = frostSentences(
    watch({ severity: 'none', lowF: 38, tenderVarieties: [], bedsAtRisk: [] }),
    coldestHour('5am'),
    BANNER,
  );

  assert.equal(said.action, "Nothing you've planted should mind a night this cold.");
});

/**
 * Her actual garden.
 *
 * Not a hypothetical. As of this morning the live install holds one seed packet
 * (`Cherry Tomato`), one 3x6 bed (`Tomato bed`) with exactly two squares
 * planted, both reading `Cherry Tomato`, and one harvest row. Every other test
 * in this file describes a garden she does not have yet, and the overflow cases
 * describe one she may never have — so the simplest shape is the one that has
 * to be right, because it is the only banner she is going to see.
 *
 * It matters more than it looks: her frost notifications are switched off, so
 * this banner is currently the *only* frost warning that reaches her at all.
 */
test('her real garden — one crop, one bed, two squares — reads as a sentence', () => {
  const hers = watch({
    // Two squares, one distinct variety, so the singular has to hold.
    bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato'])],
    tenderVarieties: ['Cherry Tomato'],
    hardyVarieties: [],
    unknownSquareCount: 0,
  });

  assert.equal(
    bannerText(hers, '3am'),
    "Cover your Cherry Tomato in Tomato bed — it'll be coldest around 3am.",
  );

  // One sentence, one dash, nothing dangling, and no list machinery showing
  // through on a garden with nothing to list.
  assert.equal(bannerText(hers, '3am').split('—').length - 1, 1);
  assert.doesNotMatch(bannerText(hers, '3am'), /and \d+ more|spread across|,/);
});

test('her real garden under a hard freeze picks rather than covers', () => {
  const hers = watch({
    severity: 'hard_freeze',
    lowF: 24,
    bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato'])],
    tenderVarieties: ['Cherry Tomato'],
    hardyVarieties: [],
  });

  assert.equal(
    bannerText(hers, '5am'),
    "Pick what you can from your Cherry Tomato in Tomato bed — it'll be coldest around 5am. " +
      "A cover won't be enough this cold.",
  );
  // Nothing hardy in the ground, so there is no aside to make — and inventing
  // one would name a crop she has not planted.
  assert.equal(frostSentences(hers, coldestHour('5am'), BANNER).aside, '');
});

test('her real garden with a daily forecast still finishes its sentence', () => {
  const hers = watch({
    precision: 'day',
    bedsAtRisk: [bed('Tomato bed', ['Cherry Tomato'])],
    tenderVarieties: ['Cherry Tomato'],
    hardyVarieties: [],
  });

  assert.equal(bannerText(hers, ''), 'Cover your Cherry Tomato in Tomato bed.');
});

/** The hour, and the honesty about not knowing it. */
test('an hourly forecast names the hour', () => {
  assert.equal(frostSentences(watch(), coldestHour('5am'), BANNER).hour, "It'll be coldest around 5am.");
});

test('a daily forecast invents nothing', () => {
  const said = frostSentences(watch({ precision: 'day' }), coldestHour(''), BANNER);

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
    coldestHour('5am'),
    BANNER,
  );

  assert.equal(said.lead.length, 2);
  assert.equal(said.lead[1], "It'll be coldest around 5am.");
  // "Coldest around 5am." was the banner's old fragment. It is not a sentence.
  assert.doesNotMatch(said.lead.join(' '), /(^|\. )Coldest around/);
});

/**
 * The hour is a `ColdestHour`, and the reason it had to become one.
 *
 * `frostSentences` builds the preamble itself, into one of two shapes depending
 * on whether the opening clause still has its em dash free. So the one thing a
 * caller must never pass is the finished clause — and while the parameter was a
 * plain `string`, that was also the most obvious thing to pass. A reviewer
 * building a verification harness did it within an hour of the module landing
 * and got `it'll be coldest around it'll be coldest around 3am` on the screen.
 *
 * Two defences, because one of them would not have caught that:
 *
 * * The **brand** stops a TypeScript caller at the keyboard. It would have done
 *   nothing for the harness, which was a `.mjs` script importing the built
 *   `.js` — the brand is erased long before that code exists.
 * * The **runtime guard** inside `frostSentences` is the half that would have.
 *   It is what these tests mostly exercise, because it is the half that has to
 *   hold for callers the type system never sees.
 */

test('a bare hour round-trips through the constructor untouched', () => {
  assert.equal(coldestHour('5am'), '5am');
  assert.equal(coldestHour('11pm'), '11pm');
  assert.equal(
    frostSentences(watch(), coldestHour('5am'), BANNER).hour,
    "It'll be coldest around 5am.",
  );
});

test('an unknown hour is a normal answer, not an error', () => {
  const said = frostSentences(watch({ precision: 'day' }), coldestHour(''), BANNER);

  assert.equal(coldestHour(''), '');
  assert.equal(said.hour, '');
  // The hour is the only thing lost. The instruction — the part that makes her
  // go outside — is still a finished sentence.
  assert.deepEqual(said.lead, ['Cover your Cherry Tomato in Tomato bed.']);
  assert.match(said.lead.join(' '), /\.$/);
});

test('the clause that caused this cannot produce a doubled preamble', () => {
  const said = frostSentences(watch(), coldestHour("it'll be coldest around 3am"), BANNER);

  // The reported bug, exactly: "it'll be coldest around it'll be coldest around 3am".
  assert.doesNotMatch(said.hour, /coldest around.*coldest around/);
  assert.doesNotMatch(said.lead.join(' '), /coldest around.*coldest around/);
  // It degrades to the no-hour wording rather than throwing, because this
  // banner is currently the only frost warning that reaches her at all.
  assert.equal(said.hour, '');
  assert.deepEqual(said.lead, ['Cover your Cherry Tomato in Tomato bed.']);
});

test('the guard holds for a caller the brand cannot reach', () => {
  // What the harness actually did: JavaScript, no types, straight into the
  // built module. The cast is the honest simulation of that — if this only
  // passed through `coldestHour` it would be testing the wrong half.
  const asJavaScriptWould = "it'll be coldest around 3am" as unknown as ColdestHour;
  const said = frostSentences(watch(), asJavaScriptWould, BANNER);

  assert.doesNotMatch(said.lead.join(' '), /coldest around.*coldest around/);
  assert.deepEqual(said.lead, ['Cover your Cherry Tomato in Tomato bed.']);
});

test('the discriminator is whitespace, not a format', () => {
  // A real hour never carries whitespace: both surfaces render it through
  // `.replace(/\s/g, '')`. Every clause does.
  assert.equal(isColdestHour('5am'), true);
  assert.equal(isColdestHour(''), true);
  assert.equal(isColdestHour('coldest around 3am'), false);
  assert.equal(isColdestHour('3 am'), false);

  // Not an American-English format check. The banner renders the device's
  // locale, so a 24-hour or non-English clock is a legitimate hour, and a
  // pattern built around "5am" would drop it — reintroducing the missing-hour
  // failure this guard exists to prevent.
  assert.equal(isColdestHour('17'), true);
  assert.equal(isColdestHour('5a.m.'), true);
  assert.equal(isColdestHour('午後5時'), true);
});

test('the other shapes a bare hour never has are refused too', () => {
  // A clause with its spaces stripped defeats the whitespace test, so the word
  // itself is checked as well. Both of these are short enough to clear the
  // length bound, so it really is the word doing the work here.
  assert.equal(coldestHour('coldest3am'), '');
  assert.equal(coldestHour('COLDEST'), '');
  // An em dash would put a second one in a sentence that already spent its own,
  // which is the one typographic rule this voice actually has.
  assert.equal(coldestHour('5am—ish'), '');
  // The reason this rejects whitespace rather than stripping it. Stripping
  // would turn a caller's half-trimmed clause into 'around5am' — no whitespace,
  // inside the length bound, no "coldest" — and render "it'll be coldest around
  // around5am", a fresh variant of the bug the guard exists for.
  assert.equal(coldestHour('around 5am'), '');
  // ...because the stripped form *is* accepted, which is the whole danger.
  assert.equal(coldestHour('around5am'), 'around5am');
  // Surrounding whitespace is canonicalised rather than refused; a label that
  // is nothing but whitespace is simply the unknown hour.
  assert.equal(coldestHour('  5am  '), '5am');
  assert.equal(coldestHour('   '), '');
  // A sanity bound, so a runaway label cannot eat the notification's
  // 200-character budget and cost her a real sentence.
  assert.equal(coldestHour('5am5am5am5am5am'), '');
});

test('a refused hour never leaves a dangling dash or a bare fragment', () => {
  for (const rubbish of ["it'll be coldest around 3am", 'coldest around 3am', '   ', '3 am']) {
    const text = bannerText(watch({ hardyVarieties: [] }), rubbish);

    assert.equal(text, 'Cover your Cherry Tomato in Tomato bed.');
    assert.doesNotMatch(text, /—\s*$/);
    assert.doesNotMatch(text, /(^|\. )Coldest around/);
  }
});

/**
 * The producers normalise, and that is load-bearing in two other files.
 *
 * The guard rejects *any* internal whitespace, and ICU puts whitespace inside a
 * perfectly legitimate hour: on the Node this was written against, `en-US`
 * renders `{ hour: 'numeric' }` as `5 AM` and `de-DE` as `05 Uhr`. Handed
 * either raw, `coldestHour` refuses it and the hour vanishes — the guard
 * reintroducing, for a whole locale, the failure it exists to prevent.
 *
 * What makes it safe is the `.replace(/\s/g, '')` in both `describeTime`
 * implementations, which runs *before* the constructor. Nothing else states
 * that dependency, and deleting it reads as tidying, so the tests below are
 * what stand between "harmless cleanup" and a silently hourless banner.
 *
 * The server half is already pinned end-to-end: `ha-notify.test.ts` asserts
 * whole notification strings under forced `TZ`, and dropping the `.replace`
 * there fails nine of them. The client half had nothing — removing it left
 * 178/178 green and the typecheck clean — which is why one of these reads the
 * source of a component that cannot be rendered without a DOM dependency this
 * repo deliberately does not carry.
 */

test('an unnormalised locale hour is refused, which is why callers normalise', () => {
  // A regular space (what `en-US` uses here) and a narrow no-break space (what
  // ICU uses in other time patterns). `\s` matches both, so both are refused.
  assert.equal(coldestHour('5 AM'), '');
  assert.equal(coldestHour('5\u202fAM'), '');
  assert.equal(coldestHour('05 Uhr'), '');
});

test('every locale ICU actually produces survives the documented normalisation', () => {
  const at = new Date('2026-10-11T10:00:00Z');

  for (const locale of ['en-US', 'en-GB', 'de-DE', 'ja-JP']) {
    const raw = at.toLocaleTimeString(locale, { hour: 'numeric', timeZone: 'America/Chicago' });
    // Exactly what both `describeTime` implementations do.
    const hour = coldestHour(raw.replace(/\s/g, '').toLowerCase());

    assert.notEqual(hour, '', `${locale} lost its hour: ${JSON.stringify(raw)}`);
    assert.match(
      frostSentences(watch(), hour, BANNER).hour,
      /^It'll be coldest around .+\.$/,
      `${locale} did not produce an hour sentence`,
    );
  }
});

test('both surfaces still strip whitespace before constructing the hour', () => {
  // A source assertion, not a behavioural one, and deliberately so: the two
  // `describeTime`s are private to a Node module and a React component, and the
  // only behavioural route to the client's is a DOM test this repo has decided
  // not to take a dependency for. The invariant is worth more than the purity
  // of the test that holds it.
  const producers = [
    ['client/src/components/FrostBanner.tsx', '../src/components/FrostBanner.tsx'],
    ['server/src/ha/notifier.ts', '../../server/src/ha/notifier.ts'],
  ] as const;

  for (const [label, relative] of producers) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    const start = source.indexOf('function describeTime(');

    assert.notEqual(start, -1, `no describeTime in ${label}`);

    const body = source.slice(start, source.indexOf('\n}', start));

    assert.match(
      body,
      /\.replace\(\/\\s\/g, ''\)/,
      `${label} stopped stripping whitespace before building a ColdestHour — ` +
        "en-US renders '5 AM' and the guard will refuse it, so her banner loses the hour",
    );
    assert.match(body, /coldestHour\(/, `${label} stopped going through coldestHour`);
  }
});

/** The squares it cannot speak for. */

test('one unrecorded square is admitted in the singular', () => {
  assert.equal(
    frostSentences(watch({ unknownSquareCount: 1 }), coldestHour('5am'), BANNER).unrecorded,
    "1 square doesn't have a plant recorded, so it's not included.",
  );
});

test('several unrecorded squares are admitted in the plural', () => {
  assert.equal(
    frostSentences(watch({ unknownSquareCount: 3 }), coldestHour('5am'), BANNER).unrecorded,
    "3 squares don't have a plant recorded, so they're not included.",
  );
});

test('a fully recorded garden says nothing about squares', () => {
  assert.equal(frostSentences(watch(), coldestHour('5am'), BANNER).unrecorded, '');
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

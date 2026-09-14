/**
 * Reading a backup file before it is allowed to do anything.
 *
 * The refusals are as much the subject here as the successes. This is the code
 * path somebody hits when they are already having a bad day, and a message that
 * names the wrong cause will send her editing a file that was never broken.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  describeAge,
  describeCounts,
  describeRestore,
  formatDay,
  reviewBackupFile,
} from '../src/lib/backup.ts';

/** Her actual garden: one seed, one bed, one harvest. */
const HER_GARDEN = {
  format: BACKUP_FORMAT,
  formatVersion: BACKUP_FORMAT_VERSION,
  exportedAt: '2026-09-14T16:05:00.000Z',
  counts: { seeds: 1, beds: 1, harvests: 1 },
  seeds: [
    {
      id: 'seed_cherry_tomato',
      category: 'Leafy Green',
      variety: 'Cherry Tomato',
      brand: '',
      purchaseYear: 2026,
      notes: '',
    },
  ],
  beds: [
    {
      id: 'bed_tomato',
      name: 'Tomato bed',
      rows: 3,
      columns: 6,
      layout: [
        ['Cherry Tomato', null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
      ],
      lastYearCategory: '',
    },
  ],
  harvests: [
    { id: 'harvest_2026_09_04', date: '2026-09-04', variety: 'Tomato', weightLbs: 0, count: 10 },
  ],
};

function review(value: unknown) {
  return reviewBackupFile(JSON.stringify(value));
}

/**
 * A copy of the garden with some top-level keys taken away.
 *
 * Written as a function rather than rest-destructuring because the discarded
 * bindings that pattern produces are exactly what `no-unused-vars` exists to
 * catch, and silencing the rule for a test file is a worse trade than one
 * three-line helper.
 */
function without(source: object, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !keys.includes(key)),
  );
}

test('a real export previews with counts and the day it was saved', () => {
  const result = review(HER_GARDEN);

  assert.ok(result.ok, 'her own export should be readable');
  assert.deepEqual(result.preview.counts, { seeds: 1, beds: 1, harvests: 1 });
  assert.equal(result.preview.recognised, true);
  assert.equal(result.preview.exportedAt, '2026-09-14T16:05:00.000Z');
  // The sentence she reads before confirming. Singular where singular is right.
  assert.equal(
    result.preview.summary,
    '1 seed packet, 1 bed and 1 harvest, saved on 14 September 2026',
  );
});

test('a bare ha-tools snapshot previews too, without inventing a date', () => {
  // The shape `export-garden.mjs` writes: three collections, no envelope. These
  // files are the only copies of her garden anyone is certain exist, so reading
  // them is the difference between her being able to recover and not.
  const bare = without(HER_GARDEN, 'format', 'formatVersion', 'exportedAt', 'counts');

  const result = reviewBackupFile(JSON.stringify(bare));

  assert.ok(result.ok);
  assert.equal(result.preview.recognised, false, 'it carries no format marker, and we do not pretend');
  assert.equal(result.preview.exportedAt, null);
  assert.equal(result.preview.summary, '1 seed packet, 1 bed and 1 harvest');
});

test('an empty file says the download did not finish', () => {
  const result = reviewBackupFile('   \n  ');

  assert.equal(result.ok, false);
  assert.match(result.message, /empty/i);
  assert.match(result.message, /download/i);
  // Never "unexpected end of JSON input", which describes the symptom and not
  // the thing that went wrong.
  assert.doesNotMatch(result.message, /JSON/);
});

test('a saved sign-in page is named for what it is', () => {
  // The realistic silent corruption: a phone hands the download to the OS, the
  // session cookie does not travel with it, and an HTML login page is saved
  // under a sensible .json name. The file exists, looks plausible and contains
  // nothing.
  const result = reviewBackupFile('<!doctype html>\n<html><body>Sign in</body></html>');

  assert.equal(result.ok, false);
  assert.match(result.message, /web page/i);
  assert.match(result.message, /sign-in page/i);
});

test('broken JSON blames a hand edit, which is the only way it happens', () => {
  const result = reviewBackupFile('{ "seeds": [], "beds": [], }');

  assert.equal(result.ok, false);
  assert.match(result.message, /comma or bracket/i);
  assert.match(result.message, /Nothing has been changed/i);
});

test('another program’s export is refused by name', () => {
  const result = review({ format: 'some-other-app.export', seeds: [], beds: [], harvests: [] });

  assert.equal(result.ok, false);
  assert.match(result.message, /some-other-app\.export/);
  assert.match(result.message, /Home Plot Tracker/);
});

test('a missing format marker is not treated as a wrong one', () => {
  /*
   * The distinction this pins is the difference between "you picked somebody
   * else's file" and "this is an older snapshot of yours". The snapshots the
   * maintainer has been taking before every rollout have no `format` key at
   * all, and they are currently the oldest copies of this garden anybody is
   * certain exist. Telling her one of those "is not a Home Plot Tracker
   * backup" would be false, and would talk her out of the only recovery she
   * has.
   *
   * Absence is silence. A wrong value is a claim, and gets contradicted.
   */
  const withoutMarker = without(HER_GARDEN, 'format');

  const silent = review(withoutMarker);
  assert.ok(silent.ok, 'a file that makes no claim about its format is read on its merits');
  assert.equal(silent.preview.recognised, false);

  const wrong = review({ ...HER_GARDEN, format: 'some-other-app.export' });
  assert.equal(wrong.ok, false);
  assert.match(wrong.message, /not to The Home Plot Tracker/i);

  // And the empty string is a claim, not silence: something wrote it.
  const empty = review({ ...HER_GARDEN, format: '' });
  assert.equal(empty.ok, false);
});

test('a file from a newer version says to update, not to fix the file', () => {
  const result = review({ ...HER_GARDEN, formatVersion: BACKUP_FORMAT_VERSION + 1 });

  assert.equal(result.ok, false);
  assert.match(result.message, /newer version/i);
  assert.match(result.message, /Update the add-on/i);
});

test('an older format version is still readable', () => {
  // The point of a version number is forward refusal, not backward refusal.
  const result = review({ ...HER_GARDEN, formatVersion: 1 });

  assert.ok(result.ok);
});

test('a JSON file that is not a garden says so in one sentence', () => {
  const result = review({ name: 'home-plot-tracker', version: '0.4.0', private: true });

  assert.equal(result.ok, false);
  assert.match(result.message, /does not contain any seeds, beds or harvests/i);
});

test('a file missing one collection is refused — absent is not empty', () => {
  const withoutHarvests = without(HER_GARDEN, 'harvests');

  const result = review(withoutHarvests);

  assert.equal(result.ok, false);
  assert.match(result.message, /no harvests/i);
  // The reasoning is in the message, because the alternative — treating it as
  // "restore zero harvests" — would delete a season and look deliberate.
  assert.match(result.message, /cannot be treated as an empty one/i);
});

test('a collection of the wrong shape is refused rather than counted', () => {
  const result = review({ ...HER_GARDEN, harvests: ['tomatoes', 'more tomatoes'] });

  assert.equal(result.ok, false);
  assert.match(result.message, /harvests/);
  // Previewing "2 harvests" and then having the server refuse it would be
  // finding out in the wrong order.
  assert.doesNotMatch(result.message, /2 harvests/);
});

test('an empty garden is a legitimate thing to restore', () => {
  const result = review({ ...HER_GARDEN, seeds: [], beds: [], harvests: [] });

  assert.ok(result.ok, '"nothing yet" is a real state to save and return to');
  assert.equal(result.preview.summary.startsWith('0 seed packets'), true);
});

test('a top-level array is not a garden', () => {
  const result = review([1, 2, 3]);

  assert.equal(result.ok, false);
  assert.match(result.message, /does not contain a garden/i);
});

test('counts read like English', () => {
  assert.equal(describeCounts({ seeds: 1, beds: 1, harvests: 1 }), '1 seed packet, 1 bed and 1 harvest');
  assert.equal(
    describeCounts({ seeds: 3, beds: 2, harvests: 14 }),
    '3 seed packets, 2 beds and 14 harvests',
  );
  assert.equal(describeCounts({ seeds: 0, beds: 0, harvests: 0 }), '0 seed packets, 0 beds and 0 harvests');
});

test('the confirm sentence names what is lost as well as what arrives', () => {
  const sentence = describeRestore(
    { seeds: 3, beds: 2, harvests: 14 },
    { seeds: 1, beds: 1, harvests: 1 },
  );

  // A confirmation that only describes the gain is not a confirmation.
  assert.match(sentence, /1 seed packet, 1 bed and 1 harvest/);
  assert.match(sentence, /3 seed packets, 2 beds and 14 harvests/);
  assert.match(sentence, /can be undone/);
});

test('the age of the last copy is rounded, and honest when there is none', () => {
  const now = new Date('2026-09-14T12:00:00.000Z');

  assert.match(describeAge(null, now), /never saved a copy/i);
  assert.match(describeAge('2026-09-14T09:00:00.000Z', now), /today/);
  assert.match(describeAge('2026-09-13T09:00:00.000Z', now), /yesterday/);
  assert.match(describeAge('2026-09-09T12:00:00.000Z', now), /5 days ago/);
  // Rounded to weeks past a fortnight: the number is there to prompt a habit,
  // and "23 days ago" invites arithmetic where "3 weeks ago" invites action.
  assert.match(describeAge('2026-08-22T12:00:00.000Z', now), /3 weeks ago/);
  assert.match(describeAge('2026-06-14T12:00:00.000Z', now), /3 months ago, on 14 June 2026/);
  assert.match(describeAge('not a date', now), /not recently/i);
});

test('dates read the same on every device', () => {
  // Written out rather than left to toLocaleDateString, so her phone and her
  // laptop describe the same file the same way.
  assert.equal(formatDay('2026-09-14T16:05:00.000Z'), '14 September 2026');
  assert.equal(formatDay('2026-01-01'), '1 January 2026');
  assert.equal(formatDay('whenever'), 'whenever');
});

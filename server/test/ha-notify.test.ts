/**
 * The notification rules.
 *
 * Every test in this file is about *not* sending something. That imbalance is
 * deliberate and is the whole design: a frost warning she learns to swipe away
 * is worse than no frost warning at all, because it takes the real one with it.
 * The rules that suppress are therefore the ones worth pinning down hardest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { FrostWatch } from '@hpt/shared';
import { openDatabase } from '../src/db/open.ts';
import type { Database } from '../src/db/open.ts';
import { runMigrations } from '../src/db/migrate.ts';
import {
  composeNotification,
  decideNotification,
  describeNight,
  inQuietHours,
  recordNotification,
} from '../src/ha/notifier.ts';
import { tempDir } from './helpers.ts';
import path from 'node:path';

const OPTIONS = {
  enabled: true,
  // 21:00 and 07:00 in minutes from midnight.
  quietHoursStartMinutes: 21 * 60,
  quietHoursEndMinutes: 7 * 60,
};

/** A fresh migrated database, plus the directory to clean up. */
function freshDb(): { db: Database; dir: string } {
  const dir = tempDir('hpt-notify-');
  const db = openDatabase(path.join(dir, 'garden.db'));

  runMigrations(db);

  return { db, dir };
}

function cleanup(db: Database, dir: string): void {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

function watch(overrides: Partial<FrostWatch> = {}): FrostWatch {
  const severity = overrides.severity ?? 'frost';
  const night = overrides.night ?? '2026-10-10';

  return {
    severity,
    lowF: 30,
    expectedAt: new Date(2026, 9, 11, 5).toISOString(),
    precision: 'hour',
    night,
    observedAt: new Date(2026, 9, 9, 12).toISOString(),
    bedsAtRisk: [
      {
        bedId: 'b1',
        bedName: 'Bed 1 - Raised',
        tender: ['Cherokee Purple'],
        hardy: [],
        unknown: [],
      },
    ],
    tenderVarieties: ['Cherokee Purple'],
    hardyVarieties: ['Lacinato Kale'],
    unknownSquareCount: 0,
    eventKey: `${night}:${severity}`,
    ...overrides,
  };
}

/** Midday, so quiet hours are never accidentally in play. */
const NOON = new Date(2026, 9, 9, 12);

test('a frost with something tender planted is announced', () => {
  const { db, dir } = freshDb();

  try {
    const decision = decideNotification(db, watch(), OPTIONS, NOON);

    assert.equal(decision.send, true);
    assert.match(decision.title, /Frost/);
    // The words that make it worth more than a weather app: her crop, her bed.
    assert.match(decision.message, /Cherokee Purple/);
    assert.match(decision.message, /Bed 1 - Raised/);
    // And the reassuring half.
    assert.match(decision.message, /Lacinato Kale/);
  } finally {
    cleanup(db, dir);
  }
});

test('the same cold snap is announced once, not once per poll', () => {
  const { db, dir } = freshDb();

  try {
    const first = decideNotification(db, watch(), OPTIONS, NOON);
    assert.equal(first.send, true);

    recordNotification(db, watch(), NOON);

    // The forecast is re-read every fifteen minutes. Without this rule that is
    // ninety-six notifications a day for one Saturday frost.
    for (let i = 0; i < 5; i += 1) {
      const again = decideNotification(db, watch(), OPTIONS, NOON);

      assert.equal(again.send, false);
      assert.equal(again.send === false && again.reason, 'already_sent');
    }
  } finally {
    cleanup(db, dir);
  }
});

test('a snap that gets worse is allowed to speak up again', () => {
  const { db, dir } = freshDb();

  try {
    recordNotification(db, watch({ severity: 'advisory' }), NOON);

    // An advisory that becomes a hard freeze is genuinely new information.
    const worse = decideNotification(db, watch({ severity: 'hard_freeze' }), OPTIONS, NOON);

    assert.equal(worse.send, true);
  } finally {
    cleanup(db, dir);
  }
});

test('a snap that merely gets re-forecast milder stays quiet', () => {
  const { db, dir } = freshDb();

  try {
    recordNotification(db, watch({ severity: 'hard_freeze' }), NOON);

    const milder = decideNotification(db, watch({ severity: 'advisory' }), OPTIONS, NOON);

    assert.equal(milder.send, false);
    assert.equal(milder.send === false && milder.reason, 'already_sent');
  } finally {
    cleanup(db, dir);
  }
});

test('escalation is capped, so a wobbling forecast cannot ratchet', () => {
  const { db, dir } = freshDb();

  try {
    recordNotification(db, watch({ severity: 'advisory' }), NOON);
    recordNotification(db, watch({ severity: 'frost' }), NOON);

    // Two is the cap even though hard_freeze is a further escalation.
    const third = decideNotification(db, watch({ severity: 'hard_freeze' }), OPTIONS, NOON);

    assert.equal(third.send, false);
    assert.equal(third.send === false && third.reason, 'capped');
  } finally {
    cleanup(db, dir);
  }
});

test('a different night is a different event', () => {
  const { db, dir } = freshDb();

  try {
    recordNotification(db, watch({ night: '2026-10-10' }), NOON);

    const next = decideNotification(db, watch({ night: '2026-10-14' }), OPTIONS, NOON);

    assert.equal(next.send, true);
  } finally {
    cleanup(db, dir);
  }
});

test('nothing tender planted means no notification', () => {
  const { db, dir } = freshDb();

  try {
    // A frost in April with nothing in the ground is not news.
    const decision = decideNotification(
      db,
      watch({ tenderVarieties: [], bedsAtRisk: [] }),
      OPTIONS,
      NOON,
    );

    assert.equal(decision.send, false);
    assert.equal(decision.send === false && decision.reason, 'nothing_at_risk');
  } finally {
    cleanup(db, dir);
  }
});

test('a hard freeze speaks up even when only hardy crops are planted', () => {
  const { db, dir } = freshDb();

  try {
    const decision = decideNotification(
      db,
      watch({
        severity: 'hard_freeze',
        lowF: 25,
        tenderVarieties: [],
        hardyVarieties: ['Lacinato Kale'],
        bedsAtRisk: [
          { bedId: 'b1', bedName: 'Kale bed', tender: [], hardy: ['Lacinato Kale'], unknown: [] },
        ],
      }),
      OPTIONS,
      NOON,
    );

    assert.equal(decision.send, true);
    assert.match(decision.message, /Lacinato Kale/);
  } finally {
    cleanup(db, dir);
  }
});

test('severity none is never announced', () => {
  const { db, dir } = freshDb();

  try {
    const decision = decideNotification(db, watch({ severity: 'none' }), OPTIONS, NOON);

    assert.equal(decision.send, false);
    assert.equal(decision.send === false && decision.reason, 'nothing_at_risk');
  } finally {
    cleanup(db, dir);
  }
});

test('no watch at all is silence, not an error', () => {
  const { db, dir } = freshDb();

  try {
    const decision = decideNotification(db, null, OPTIONS, NOON);

    assert.equal(decision.send, false);
    assert.equal(decision.send === false && decision.reason, 'no_watch');
  } finally {
    cleanup(db, dir);
  }
});

test('turning notifications off turns them off', () => {
  const { db, dir } = freshDb();

  try {
    const decision = decideNotification(db, watch(), { ...OPTIONS, enabled: false }, NOON);

    assert.equal(decision.send, false);
    assert.equal(decision.send === false && decision.reason, 'disabled');
  } finally {
    cleanup(db, dir);
  }
});

test('quiet hours hold a warning that can wait', () => {
  const { db, dir } = freshDb();

  try {
    // 11pm on the 9th, for a frost on the night of the 13th — days away.
    const lateNight = new Date(2026, 9, 9, 23);
    const distant = watch({
      night: '2026-10-13',
      expectedAt: new Date(2026, 9, 14, 5).toISOString(),
    });

    const decision = decideNotification(db, distant, OPTIONS, lateNight);

    assert.equal(decision.send, false);
    assert.equal(decision.send === false && decision.reason, 'quiet_hours');
  } finally {
    cleanup(db, dir);
  }
});

test('a held warning is reconsidered, not dropped', () => {
  const { db, dir } = freshDb();

  try {
    const distant = watch({
      night: '2026-10-13',
      expectedAt: new Date(2026, 9, 14, 5).toISOString(),
    });

    assert.equal(decideNotification(db, distant, OPTIONS, new Date(2026, 9, 9, 23)).send, false);

    // Nothing was recorded, so the first poll after 07:00 sends it.
    assert.equal(decideNotification(db, distant, OPTIONS, new Date(2026, 9, 10, 8)).send, true);
  } finally {
    cleanup(db, dir);
  }
});

test('an imminent frost overrides quiet hours', () => {
  const { db, dir } = freshDb();

  try {
    // Discovered at 10pm, landing at 4am. Waiting until 07:00 would be six
    // hours after the damage — exactly the notification worth buzzing for.
    const lateNight = new Date(2026, 9, 9, 22);
    const imminent = watch({
      night: '2026-10-09',
      expectedAt: new Date(2026, 9, 10, 4).toISOString(),
    });

    const decision = decideNotification(db, imminent, OPTIONS, lateNight);

    assert.equal(decision.send, true);
  } finally {
    cleanup(db, dir);
  }
});

test('the record survives a restart, so a reboot cannot re-notify', () => {
  const dir = tempDir('hpt-notify-restart-');
  const dbPath = path.join(dir, 'garden.db');

  try {
    const first = openDatabase(dbPath);
    runMigrations(first);
    recordNotification(first, watch(), NOON);
    first.close();

    // An add-on restarts on every update, every Home Assistant reboot and every
    // option change. In-memory state would re-announce on each of those.
    const second = openDatabase(dbPath);
    runMigrations(second);

    const decision = decideNotification(second, watch(), OPTIONS, NOON);

    assert.equal(decision.send, false);
    assert.equal(decision.send === false && decision.reason, 'already_sent');
    second.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('quiet hours wrap around midnight', () => {
  const start = 21 * 60;
  const end = 7 * 60;

  assert.equal(inQuietHours(new Date(2026, 9, 9, 22), start, end), true);
  assert.equal(inQuietHours(new Date(2026, 9, 9, 3), start, end), true);
  assert.equal(inQuietHours(new Date(2026, 9, 9, 21), start, end), true);
  assert.equal(inQuietHours(new Date(2026, 9, 9, 7), start, end), false);
  assert.equal(inQuietHours(new Date(2026, 9, 9, 12), start, end), false);
  assert.equal(inQuietHours(new Date(2026, 9, 9, 20, 59), start, end), false);
});

test('a daytime quiet window still works', () => {
  // Not the default, but nothing should assume the window wraps.
  assert.equal(inQuietHours(new Date(2026, 9, 9, 10), 9 * 60, 17 * 60), true);
  assert.equal(inQuietHours(new Date(2026, 9, 9, 20), 9 * 60, 17 * 60), false);
});

test('equal quiet hours switch the window off rather than silencing everything', () => {
  // A misconfiguration that silenced every notification forever would be a
  // nasty way for this to fail, and an invisible one.
  assert.equal(inQuietHours(new Date(2026, 9, 9, 3), 0, 0), false);
  assert.equal(inQuietHours(new Date(2026, 9, 9, 15), 8 * 60, 8 * 60), false);
});

test('nights are described the way she would say them', () => {
  const now = new Date(2026, 9, 9, 12);

  assert.equal(describeNight('2026-10-09', now), 'tonight');
  assert.equal(describeNight('2026-10-10', now), 'tomorrow night');
  assert.match(describeNight('2026-10-12', now), /night$/);
  assert.match(describeNight('2026-11-20', now), /^the night of/);
});

test('the message admits to squares it cannot classify', () => {
  const composed = composeNotification(watch({ unknownSquareCount: 3 }), NOON);

  assert.match(composed.message, /3 squares have no crop family recorded/);
});

test('the message names the hour only when the forecast was hourly', () => {
  const hourly = composeNotification(watch({ precision: 'hour' }), NOON);
  assert.match(hourly.message, /Coldest around/);

  // A daily forecast carries no hour, so inventing one would be a lie.
  const daily = composeNotification(watch({ precision: 'day' }), NOON);
  assert.doesNotMatch(daily.message, /Coldest around/);
});

test('a long variety list is summarised rather than dumped', () => {
  const composed = composeNotification(
    watch({
      tenderVarieties: ['A', 'B', 'C', 'D', 'E'],
    }),
    NOON,
  );

  assert.match(composed.message, /and 2 more/);
});

/**
 * Timezone: the wording and the quiet hours are hers, not the container's.
 *
 * These exist because the dependence is invisible and the failure mode is
 * silent. Quiet hours of 21:00–07:00 read in UTC rather than America/Chicago
 * become 16:00–02:00 on her clock: her whole afternoon suppressed, and 1am let
 * through. Nothing would throw, no test would fail, and the first sign would be
 * a frost warning at the wrong hour some night next October.
 *
 * It is sound today, and that was measured rather than reasoned about: a
 * throwaway add-on install on the target machine reported `TZ=America/Chicago`
 * injected by Supervisor and a Node zone of `America/Chicago` resolved from
 * Node's own bundled tzdata — in the same container where busybox `date` said
 * UTC, because Alpine ships no `/usr/share/zoneinfo`. Node carries its own copy
 * and the shell does not.
 *
 * So these tests guard the assumption rather than the arithmetic. If a future
 * base image, Node version or Dockerfile change breaks the `TZ` path, this file
 * fails in CI instead of her garden.
 */

/**
 * Runs `fn` with the process timezone forced to `zone`.
 *
 * The assertion inside is not decoration. Node currently re-reads
 * `process.env.TZ` on assignment and resets its date cache, but if that ever
 * stops being true every test below would quietly start asserting the ambient
 * zone and pass for entirely the wrong reason — which is precisely the class of
 * bug this whole block exists to catch.
 */
function withTimeZone<T>(zone: string, fn: () => T): T {
  const previous = process.env.TZ;

  process.env.TZ = zone;

  try {
    assert.equal(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      zone,
      `forcing TZ=${zone} had no effect, so this test proves nothing`,
    );

    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('quiet hours are her wall clock, not the container clock', () => {
  // 21:00 UTC is 16:00 in Chicago: her mid-afternoon, and the exact instant a
  // UTC-bound reading would wrongly silence.
  const afternoon = new Date('2026-10-09T21:00:00Z');

  assert.equal(
    withTimeZone('America/Chicago', () =>
      inQuietHours(afternoon, OPTIONS.quietHoursStartMinutes, OPTIONS.quietHoursEndMinutes),
    ),
    false,
    'four in the afternoon must not be quiet hours',
  );

  assert.equal(
    withTimeZone('UTC', () =>
      inQuietHours(afternoon, OPTIONS.quietHoursStartMinutes, OPTIONS.quietHoursEndMinutes),
    ),
    true,
    'the same instant read as UTC is 21:00 — this is the bug being guarded against',
  );

  // And the inverse: 11:00 UTC is 06:00 for her, still inside quiet hours.
  const dawn = new Date('2026-10-10T11:00:00Z');

  assert.equal(
    withTimeZone('America/Chicago', () =>
      inQuietHours(dawn, OPTIONS.quietHoursStartMinutes, OPTIONS.quietHoursEndMinutes),
    ),
    true,
    'six in the morning is still quiet hours',
  );

  assert.equal(
    withTimeZone('UTC', () =>
      inQuietHours(dawn, OPTIONS.quietHoursStartMinutes, OPTIONS.quietHoursEndMinutes),
    ),
    false,
  );
});

test('the coldest-hour wording is rendered in the local zone', () => {
  // 10:00 UTC — which is 5am for her, the canonical "cover the beds" hour.
  const coldest = watch({ expectedAt: '2026-10-11T10:00:00Z', precision: 'hour' });
  const now = new Date('2026-10-09T17:00:00Z');

  assert.match(
    withTimeZone('America/Chicago', () => composeNotification(coldest, now)).message,
    /Coldest around 5am\./,
  );

  assert.match(
    withTimeZone('Asia/Tokyo', () => composeNotification(coldest, now)).message,
    /Coldest around 7pm\./,
  );

  assert.match(
    withTimeZone('UTC', () => composeNotification(coldest, now)).message,
    /Coldest around 10am\./,
  );
});

test('"tonight" versus "tomorrow night" follows her local date', () => {
  // 02:00 UTC on the 10th is still 21:00 on the 9th for her, so the frost on
  // the night of the 10th is tomorrow's problem, not tonight's.
  const now = new Date('2026-10-10T02:00:00Z');

  assert.equal(
    withTimeZone('America/Chicago', () => describeNight('2026-10-10', now)),
    'tomorrow night',
  );

  assert.equal(
    withTimeZone('UTC', () => describeNight('2026-10-10', now)),
    'tonight',
  );
});

test('weekday names still render under a non-local zone', () => {
  // 2026-10-10 is a Saturday; the reviewer's own example sentence.
  assert.equal(
    withTimeZone('America/Chicago', () =>
      describeNight('2026-10-10', new Date('2026-10-07T18:00:00Z')),
    ),
    'Saturday night',
  );

  // Formatting must not quietly degrade to a numeric date on a zone the base
  // image has never seen before.
  assert.equal(
    withTimeZone('Asia/Tokyo', () =>
      describeNight('2026-10-14', new Date('2026-10-10T02:00:00Z')),
    ),
    'Wednesday night',
  );
});

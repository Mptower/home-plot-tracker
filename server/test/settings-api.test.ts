/**
 * The Settings endpoints, and the promise they exist to keep.
 *
 * The endpoints themselves are small. The tests that earn their keep are the
 * ones at the bottom, which prove the thing the whole feature is for: a change
 * she makes on the Settings page is honoured by the very next forecast poll,
 * with nothing restarted and no stale copy of her answer anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { GardenSettings } from '@hpt/shared';
import { DEFAULT_SETTINGS, readSettings } from '../src/db/settings.ts';
import { decideNotification } from '../src/ha/notifier.ts';
import {
  bed,
  fakeHomeAssistant,
  readIntegrationStatus,
  readSettingsBody,
  seed,
  startServer,
} from './helpers.ts';
import type { TestServer } from './helpers.ts';

const OFF_AT_NINE: GardenSettings = {
  frostNotifications: false,
  quietHoursStart: '21:00',
  quietHoursEnd: '07:00',
};

/** Quiet hours switched off, so a test never depends on the hour it runs at. */
const ALWAYS_LOUD: GardenSettings = {
  frostNotifications: true,
  quietHoursStart: '00:00',
  quietHoursEnd: '00:00',
};

/** `HH:MM` a whole number of hours either side of the ambient wall clock. */
function localTimeOffsetBy(hours: number): string {
  const when = new Date();

  when.setHours(when.getHours() + hours);

  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}

/** Two days out at 5am: cold, and comfortably outside the twelve-hour override. */
function frostNight(): string {
  const date = new Date();

  date.setDate(date.getDate() + 2);
  date.setHours(5, 0, 0, 0);

  return date.toISOString();
}

/** A bed with something tender in it, so a frost is worth announcing. */
async function plantSomethingTender(server: TestServer): Promise<void> {
  assert.equal((await server.putJson('/api/seeds', [seed()])).status, 200);
  assert.equal((await server.putJson('/api/beds', [bed()])).status, 200);
}

function notifyCalls(server: TestServer): number {
  return server.ha!.callsMatching('/services/notify/').length;
}

test('a fresh install reads back the defaults', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const { status, body } = await readSettingsBody(server);

  assert.equal(status, 200);
  assert.deepEqual(body, DEFAULT_SETTINGS);
});

test('an upgraded install reads back what she had set in the add-on', async (t) => {
  const server = await startServer({}, { settingsSeed: OFF_AT_NINE });
  t.after(() => server.close());

  assert.deepEqual((await readSettingsBody(server)).body, OFF_AT_NINE);
});

test('a saved setting is stored, returned, and read back the same', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const wanted: GardenSettings = {
    frostNotifications: false,
    quietHoursStart: '22:30',
    quietHoursEnd: '06:15',
  };

  const response = await server.putRaw('/api/settings', wanted);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), wanted, 'the response is what was stored');
  assert.deepEqual((await readSettingsBody(server)).body, wanted);
  assert.deepEqual(readSettings(server.db), wanted, 'and the database agrees');
});

test('saving settings needs no If-Match, unlike every collection write', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  // Deliberate, and the one thing on this router that works this way. Settings
  // is three scalars: the worst a lost update can do is revert a toggle she can
  // see and re-flip. A collection write can destroy records, which is why those
  // insist on a precondition and this does not.
  assert.equal((await server.putRaw('/api/settings', ALWAYS_LOUD)).status, 200);

  // A collection write with no precondition is refused outright, which is what
  // makes the line above a decision rather than an oversight.
  assert.equal((await server.putRaw('/api/seeds', [seed()])).status, 428);

  // And a stale precondition is not honoured here either — it is simply not
  // part of this endpoint's contract, so it cannot half-work.
  const stale = await server.putRaw('/api/settings', OFF_AT_NINE, { 'If-Match': '"1"' });

  assert.equal(stale.status, 200);
  assert.deepEqual((await readSettingsBody(server)).body, OFF_AT_NINE);
});

test('the last write wins, twice over', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putRaw('/api/settings', { ...ALWAYS_LOUD, quietHoursStart: '20:00' });
  await server.putRaw('/api/settings', { ...ALWAYS_LOUD, quietHoursStart: '23:00' });

  assert.equal((await readSettingsBody(server)).body.quietHoursStart, '23:00');
});

test('equal quiet hours are accepted, because that is how they are switched off', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.putRaw('/api/settings', {
    frostNotifications: true,
    quietHoursStart: '07:00',
    quietHoursEnd: '07:00',
  });

  assert.equal(response.status, 200, 'this is a supported choice, not a malformed one');
});

test('a malformed settings payload is rejected field by field', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const rejections = [
    {
      label: 'a time that is not a time',
      body: { ...ALWAYS_LOUD, quietHoursStart: '9pm' },
      path: 'body.quietHoursStart',
    },
    {
      label: 'a 25th hour',
      body: { ...ALWAYS_LOUD, quietHoursEnd: '25:00' },
      path: 'body.quietHoursEnd',
    },
    {
      label: 'a string where a boolean belongs',
      body: { ...ALWAYS_LOUD, frostNotifications: 'yes' },
      path: 'body.frostNotifications',
    },
    {
      label: 'a missing field',
      body: { frostNotifications: true, quietHoursStart: '21:00' },
      path: 'body.quietHoursEnd',
    },
    {
      label: 'an unknown field',
      body: { ...ALWAYS_LOUD, weatherEntity: 'weather.forecast_home' },
      path: 'body.weatherEntity',
    },
    { label: 'an array', body: [ALWAYS_LOUD], path: 'body' },
  ];

  for (const rejection of rejections) {
    const response = await server.putRaw('/api/settings', rejection.body);

    assert.equal(response.status, 400, rejection.label);

    const failure = (await response.json()) as {
      error: string;
      issues?: { path: string; message: string }[];
    };

    assert.equal(failure.error, 'validation_failed', rejection.label);
    assert.ok(
      failure.issues?.some((issue) => issue.path === rejection.path),
      `${rejection.label} should be reported at ${rejection.path}`,
    );
  }
});

test('a rejected save leaves the stored settings untouched', async (t) => {
  const server = await startServer({}, { settingsSeed: OFF_AT_NINE });
  t.after(() => server.close());

  const response = await server.putRaw('/api/settings', { ...ALWAYS_LOUD, quietHoursEnd: 'noon' });

  assert.equal(response.status, 400);
  assert.deepEqual(
    (await readSettingsBody(server)).body,
    OFF_AT_NINE,
    'a failed save must not half-apply the fields that were fine',
  );
});

test('the status block is answerable with no Home Assistant at all', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const { status, body } = await readIntegrationStatus(server);

  assert.equal(status, 200, 'there is no failure branch here, by design');
  assert.equal(body.configured, false);
  assert.equal(body.connected, false);
  assert.equal(body.reason, 'not_configured');
  assert.equal(body.weatherEntity, null);
  assert.deepEqual(body.sensors, []);
  assert.equal(body.frostRisk, null);
  // The timezone is a property of this process, not of the integration, and it
  // is the one line that explains a notification arriving at the wrong hour.
  assert.equal(body.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test('the status block names the plumbing once Home Assistant is there', async (t) => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha });
  t.after(() => server.close());

  ha.setDailyLows([{ at: frostNight(), lowF: 71 }]);
  await server.haService!.refreshForecast();

  const { body } = await readIntegrationStatus(server);

  assert.equal(body.configured, true);
  assert.equal(body.connected, true);
  assert.equal(body.reason, null);
  assert.equal(body.weatherEntity, 'weather.forecast_home');
  assert.equal(body.notifyService, 'notify.mobile_app_julie_s_phone');
  assert.deepEqual(body.sensors, [
    'sensor.garden_harvest_weight',
    'sensor.garden_harvest_count',
    'sensor.garden_top_variety',
    'sensor.garden_frost_risk',
  ]);
  assert.equal(typeof body.forecastObservedAt, 'string');

  // A September low of 71°F. `none` is the correct answer and a different thing
  // from "no answer" — which is the entire reason this block exists.
  assert.equal(body.frostRisk, 'none');
});

test('the status block distinguishes broken from not frosty', async (t) => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha });
  t.after(() => server.close());

  const before = await readIntegrationStatus(server);
  assert.equal(before.body.reason, 'no_forecast', 'nothing has been read yet');
  assert.equal(before.body.frostRisk, null);

  ha.setFailureMode('throw');
  await server.haService!.refreshForecast();

  const after = await readIntegrationStatus(server);

  assert.equal(after.body.configured, true, 'there is a Home Assistant, it just is not answering');
  assert.equal(after.body.connected, false);
  assert.equal(after.body.reason, 'unreachable');
  assert.equal(after.body.frostRisk, null);
});

test('turning notifications on takes effect on the next poll, with no restart', async (t) => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha, settingsSeed: OFF_AT_NINE });
  t.after(() => server.close());

  await plantSomethingTender(server);
  ha.setDailyLows([{ at: frostNight(), lowF: 28 }]);

  await server.haService!.refreshForecast();
  assert.equal(notifyCalls(server), 0, 'notifications are off, so nothing is sent');

  // The whole point of the feature: she flips the toggle in the app, and the
  // service is never told, never restarted, and never handed a new options
  // object. It simply reads the database the next time it has a decision.
  assert.equal((await server.putRaw('/api/settings', ALWAYS_LOUD)).status, 200);

  await server.haService!.refreshForecast();
  assert.equal(notifyCalls(server), 1, 'the very next poll honours the new answer');
});

test('turning notifications off takes effect just as immediately', async (t) => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha, settingsSeed: ALWAYS_LOUD });
  t.after(() => server.close());

  await plantSomethingTender(server);
  ha.setDailyLows([{ at: frostNight(), lowF: 28 }]);

  await server.haService!.refreshForecast();
  assert.equal(notifyCalls(server), 1);

  await server.putRaw('/api/settings', { ...ALWAYS_LOUD, frostNotifications: false });

  // A colder forecast for the same night would otherwise be allowed to speak up
  // again, so this is a real second chance to notify, not a de-duplicated one.
  ha.setDailyLows([{ at: frostNight(), lowF: 20 }]);
  await server.haService!.refreshForecast();

  assert.equal(notifyCalls(server), 1, 'off means off, from the next poll onwards');
});

test('quiet hours changed at runtime are read against her local wall clock', async (t) => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha, settingsSeed: ALWAYS_LOUD });
  t.after(() => server.close());

  await plantSomethingTender(server);
  ha.setDailyLows([{ at: frostNight(), lowF: 28 }]);

  // A window built from the ambient clock, so this holds whatever hour the
  // suite runs at — and so it is genuinely a wall-clock reading rather than a
  // UTC one. The ambient zone is the contract; see the note in `notifier.ts`.
  assert.equal(
    (
      await server.putRaw('/api/settings', {
        frostNotifications: true,
        quietHoursStart: localTimeOffsetBy(-1),
        quietHoursEnd: localTimeOffsetBy(1),
      })
    ).status,
    200,
  );

  await server.haService!.refreshForecast();
  assert.equal(notifyCalls(server), 0, 'a frost two nights out can wait until morning');

  // And a held warning is reconsidered rather than dropped: widening the window
  // to nothing lets the same frost through on the next poll.
  await server.putRaw('/api/settings', ALWAYS_LOUD);
  await server.haService!.refreshForecast();

  assert.equal(notifyCalls(server), 1);
});

test('a frost within twelve hours still overrides the quiet hours she just set', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putRaw('/api/settings', {
    frostNotifications: true,
    quietHoursStart: '21:00',
    quietHoursEnd: '07:00',
  });

  const stored = readSettings(server.db);
  const options = {
    enabled: stored.frostNotifications,
    quietHoursStartMinutes: 21 * 60,
    quietHoursEndMinutes: 7 * 60,
  };

  // 23:00 local, deep inside the window she just saved.
  const now = new Date(2026, 9, 9, 23, 0, 0);
  const soon = new Date(2026, 9, 10, 5, 0, 0);
  const distant = new Date(2026, 9, 11, 5, 0, 0);

  const watch = (expectedAt: Date, night: string) => ({
    severity: 'frost' as const,
    lowF: 30,
    expectedAt: expectedAt.toISOString(),
    precision: 'hour' as const,
    night,
    observedAt: now.toISOString(),
    bedsAtRisk: [
      { bedId: 'b1', bedName: 'Bed 1', tender: ['Cherokee Purple'], hardy: [], unknown: [] },
    ],
    tenderVarieties: ['Cherokee Purple'],
    hardyVarieties: [],
    unknownSquareCount: 0,
    eventKey: `${night}:frost`,
  });

  // Six hours away. Waiting until 07:00 would be after the frost, so the
  // window is overridden — the behaviour the Settings page has to explain in
  // as many words, or it reads as a bug the first time it wakes her.
  assert.equal(decideNotification(server.db, watch(soon, '2026-10-10'), options, now).send, true);

  // Thirty hours away. That one can wait for the morning.
  assert.equal(
    decideNotification(server.db, watch(distant, '2026-10-11'), options, now).send,
    false,
  );
});

/**
 * Home Assistant present, but broken.
 *
 * The rule this file enforces is that the garden never pays for Home
 * Assistant's problems. Supervisor can be down, restarting, timing out or
 * returning an HTML error page, and her seeds, beds and harvests must behave
 * exactly as they do on a laptop with no Home Assistant at all — same status
 * codes, same speed, no unhandled rejection taking the process down at 3am.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FakeFailureMode } from './helpers.ts';
import { fakeHomeAssistant, startServer, harvest, seed, readHomeAssistant } from './helpers.ts';

const FAILURE_MODES: Exclude<FakeFailureMode, null>[] = [
  'throw',
  'timeout',
  'status',
  'malformed',
];

for (const mode of FAILURE_MODES) {
  test(`a ${mode} failure still answers the endpoint cleanly`, async () => {
    const ha = fakeHomeAssistant();
    const server = await startServer({}, { ha });

    try {
      ha.setFailureMode(mode);

      await server.haService!.refreshForecast();

      const { status, body } = await readHomeAssistant(server);

      assert.equal(status, 200);
      assert.equal(body.available, false);
      assert.equal(body.frost, null);
      // Not 'not_configured': there *is* a Home Assistant, we just cannot
      // reach it. The distinction is the difference between a bug and a blip.
      assert.equal(body.reason, 'unreachable');
    } finally {
      await server.close();
    }
  });

  test(`a ${mode} failure leaves the garden untouched`, async () => {
    const ha = fakeHomeAssistant();
    const server = await startServer({}, { ha });

    try {
      ha.setFailureMode(mode);

      const started = Date.now();

      assert.equal((await server.putJson('/api/seeds', [seed()])).status, 200);
      assert.equal((await server.putJson('/api/harvests', [harvest()])).status, 200);
      assert.equal((await server.get('/api/seeds')).status, 200);
      assert.equal((await server.get('/api/harvests')).status, 200);

      const elapsed = Date.now() - started;

      // Four requests, none of which may wait on a five-second Home Assistant
      // timeout. If this ever creeps up, something has started calling Home
      // Assistant on the request path.
      assert.ok(elapsed < 2000, `four garden requests took ${elapsed}ms`);
    } finally {
      await server.close();
    }
  });
}

test('a failure does not become an unhandled rejection', async () => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha });
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };

  process.on('unhandledRejection', onRejection);

  try {
    ha.setFailureMode('throw');

    // Every path that talks to Home Assistant, driven directly.
    await server.haService!.refreshForecast();
    await server.haService!.refreshSensors();
    await server.putJson('/api/harvests', [harvest()]);

    // Let the debounced publish fire and fail on its own timer, away from any
    // request — the place an unhandled rejection would actually kill the
    // process rather than just failing a request.
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.deepEqual(rejections, []);
  } finally {
    process.off('unhandledRejection', onRejection);
    await server.close();
  }
});

test('the poller recovers on its own once Home Assistant comes back', async () => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha });

  try {
    ha.setFailureMode('throw');
    await server.haService!.refreshForecast();

    assert.equal((await readHomeAssistant(server)).body.available, false);

    // A Home Assistant restart is a normal Tuesday. Nothing should need
    // restarting on our side to notice it came back.
    ha.setFailureMode(null);
    ha.setDailyLows([{ at: futureDate(2), lowF: 30 }]);

    await server.haService!.refreshForecast();

    const { body } = await readHomeAssistant(server);

    assert.equal(body.available, true);
  } finally {
    await server.close();
  }
});

test('a forecast that goes away again does not strand a stale warning', async () => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha });

  try {
    ha.setDailyLows([{ at: futureDate(2), lowF: 28 }]);
    await server.haService!.refreshForecast();

    assert.equal((await readHomeAssistant(server)).body.available, true);

    ha.setFailureMode('throw');
    await server.haService!.refreshForecast();

    // A frost banner is only useful if it is current. Continuing to show
    // Tuesday's forecast on Friday because the connection dropped would be
    // worse than showing nothing.
    const { body } = await readHomeAssistant(server);

    assert.equal(body.available, false);
    assert.equal(body.reason, 'unreachable');
  } finally {
    await server.close();
  }
});

test('a weather entity that does not exist is reported as no forecast', async () => {
  const ha = fakeHomeAssistant();
  const server = await startServer({ HA_WEATHER_ENTITY: 'weather.renamed_by_accident' }, { ha });

  try {
    // She renames an entity in the Home Assistant UI. The add-on option still
    // points at the old id, so every read 404s. That is a configuration
    // problem, not an outage, and either way the app must stay quiet and keep
    // working rather than showing a broken banner.
    await server.haService!.refreshForecast();

    const { status, body } = await readHomeAssistant(server);

    assert.equal(status, 200);
    assert.equal(body.available, false);
    assert.equal(body.frost, null);
    assert.equal((await server.get('/api/seeds')).status, 200);
  } finally {
    await server.close();
  }
});

test('a garbage forecast payload is ignored rather than believed', async () => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha });

  try {
    // Temperatures that are not numbers, and a datetime that is not a date.
    ha.setDailyLows([
      { at: 'not-a-date', lowF: 30 },
      { at: futureDate(1), lowF: Number.NaN },
    ]);

    await server.haService!.refreshForecast();

    const { status, body } = await readHomeAssistant(server);

    assert.equal(status, 200);

    // No usable point means no claim about the weather. Never a NaN°F banner.
    if (body.available) {
      assert.equal(body.frost, null);
    }
  } finally {
    await server.close();
  }
});

test('sensor publishing survives Home Assistant being down', async () => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha });

  try {
    ha.setFailureMode('status');

    await server.haService!.refreshSensors();

    // Nothing landed, and nothing threw.
    assert.equal(ha.states.size, 0);

    ha.setFailureMode(null);
    await server.haService!.refreshSensors();

    assert.equal(ha.states.size, 4);
  } finally {
    await server.close();
  }
});

/** An ISO date `days` from now, so fixtures are never accidentally in the past. */
function futureDate(days: number): string {
  const date = new Date();

  date.setDate(date.getDate() + days);
  date.setHours(5, 0, 0, 0);

  return date.toISOString();
}

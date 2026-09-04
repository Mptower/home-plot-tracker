/**
 * The sensors published back to Home Assistant.
 *
 * These four entities are the part of this feature that ends up on a dashboard
 * and stays there, so the payloads are pinned exactly — ids, units, device and
 * state classes, rounding and icons. Getting a `state_class` wrong is not a
 * cosmetic bug: it feeds the long-term statistics engine and is painful to
 * unpick after the fact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { HarvestLog } from '@hpt/shared';
import {
  PUBLISHED_SENSORS,
  SENSOR_ATTRIBUTION,
  buildSensorPayloads,
  findWritableSensors,
  summariseHarvests,
} from '../src/ha/sensors.ts';
import { HomeAssistantClient } from '../src/ha/client.ts';
import { fakeHomeAssistant, startServer, harvest } from './helpers.ts';

/** A client pointed at the fake, with the same shape the service builds. */
function clientFor(ha: ReturnType<typeof fakeHomeAssistant>): HomeAssistantClient {
  return new HomeAssistantClient({
    baseUrl: 'http://supervisor',
    token: 'test-token',
    fetchImpl: ha.fetchImpl,
  });
}

function payloadFor(prefix: string, sensor: string, harvests: readonly HarvestLog[]) {
  const payloads = buildSensorPayloads({
    prefix,
    harvests,
    frost: null,
    frostKnown: false,
  });

  const found = payloads.find((payload) => payload.entityId === `sensor.${prefix}_${sensor}`);

  assert.ok(found, `expected a payload for sensor.${prefix}_${sensor}`);

  return found;
}

test('exactly four sensors are published, and they are the interesting ones', () => {
  const payloads = buildSensorPayloads({ prefix: 'garden', harvests: [], frost: null, frostKnown: false });

  // Four is a dashboard card. Forty — a sensor per variety — is entity spam
  // that nothing here could ever clean up, because the states API creates
  // entities but cannot delete them.
  assert.equal(payloads.length, 4);
  assert.deepEqual(
    payloads.map((payload) => payload.entityId),
    PUBLISHED_SENSORS.map((sensor) => `sensor.garden_${sensor}`),
  );
});

test('every sensor carries the attribution that the collision guard reads', () => {
  const payloads = buildSensorPayloads({ prefix: 'garden', harvests: [], frost: null, frostKnown: false });

  for (const payload of payloads) {
    assert.equal(payload.attributes.attribution, SENSOR_ATTRIBUTION);
    assert.ok(payload.attributes.friendly_name, `${payload.entityId} needs a friendly name`);
    assert.ok(payload.attributes.icon, `${payload.entityId} needs an icon`);
  }
});

test('the weight sensor is a measurement in pounds', () => {
  const payload = payloadFor('garden', 'harvest_weight', [
    harvest({ weightLbs: 1.5, count: 2, variety: 'Cherokee Purple', date: '2026-08-01' }),
    harvest({ weightLbs: 2.25, count: 1, variety: 'Cherokee Purple', date: '2026-08-03' }),
  ]);

  assert.equal(payload.state, '3.75');
  assert.equal(payload.attributes.unit_of_measurement, 'lb');
  assert.equal(payload.attributes.device_class, 'weight');
  // Not `total_increasing`: correcting a harvest row makes this drop, and Home
  // Assistant would read the drop as a meter reset and corrupt the sum forever.
  // Not `total`: these entities vanish on every restart, which would leave
  // statistics gaps and "state class changed" repairs.
  assert.equal(payload.attributes.state_class, 'measurement');
  assert.equal(payload.attributes.entries, 2);
  assert.equal(payload.attributes.varieties, 1);
});

test('weights are rounded to something a scale could have said', () => {
  // Floating point sums like 0.1 + 0.2 must not reach her dashboard.
  const payload = payloadFor('garden', 'harvest_weight', [
    harvest({ weightLbs: 0.1 }),
    harvest({ weightLbs: 0.2 }),
  ]);

  assert.equal(payload.state, '0.30');
});

test('an empty garden publishes honest zeroes rather than nothing', () => {
  const weight = payloadFor('garden', 'harvest_weight', []);
  const count = payloadFor('garden', 'harvest_count', []);
  const top = payloadFor('garden', 'top_variety', []);

  assert.equal(weight.state, '0.00');
  assert.equal(count.state, '0');
  // Julie's garden is empty right now, so this is the state she will actually
  // see first. `unknown` is Home Assistant's own word for it and renders
  // properly; an empty string shows as a blank card.
  assert.equal(top.state, 'unknown');
  assert.equal(top.attributes.weight_lbs, 0);
});

test('the top variety is the heaviest, not the most recent', () => {
  const payload = payloadFor('garden', 'top_variety', [
    harvest({ variety: 'Sungold', weightLbs: 1, count: 40, date: '2026-09-01' }),
    harvest({ variety: 'Black Beauty', weightLbs: 6.5, count: 3, date: '2026-08-01' }),
    harvest({ variety: 'Sungold', weightLbs: 1, count: 30, date: '2026-09-02' }),
  ]);

  assert.equal(payload.state, 'Black Beauty');
  assert.equal(payload.attributes.weight_lbs, 6.5);
  assert.equal(payload.attributes.count, 3);
});

test('the harvest count adds up items, not rows', () => {
  const payload = payloadFor('garden', 'harvest_count', [
    harvest({ count: 12, date: '2026-08-01' }),
    harvest({ count: 5, date: '2026-08-01' }),
    harvest({ count: 3, date: '2026-08-02' }),
  ]);

  assert.equal(payload.state, '20');
  assert.equal(payload.attributes.entries, 3);
  // Two distinct dates, three rows.
  assert.equal(payload.attributes.harvest_days, 2);
});

test('the totals span every entry, and say so', () => {
  // A deliberate match with the Harvest Log view, which summarises the whole
  // array rather than the current year. Publishing a calendar-year number would
  // put a different value on her dashboard than on her screen under the same
  // name. The dates make the window explicit instead of implied.
  const payload = payloadFor('garden', 'harvest_weight', [
    harvest({ weightLbs: 1, date: '2025-07-04' }),
    harvest({ weightLbs: 1, date: '2026-09-15' }),
  ]);

  assert.equal(payload.state, '2.00');
  assert.equal(payload.attributes.first_harvest, '2025-07-04');
  assert.equal(payload.attributes.last_harvest, '2026-09-15');
});

test('a harvest with no variety still counts towards the totals', () => {
  const totals = summariseHarvests([
    harvest({ variety: '', weightLbs: 2, count: 1 }),
    harvest({ variety: '   ', weightLbs: 1, count: 1 }),
  ]);

  assert.equal(totals.totalWeightLbs, 3);
  assert.equal(totals.totalCount, 2);
  // But it cannot be a top variety, because it has no name.
  assert.equal(totals.topVariety, null);
});

test('a nonsense weight does not poison the total', () => {
  const totals = summariseHarvests([
    harvest({ weightLbs: Number.NaN, count: 1 }),
    harvest({ weightLbs: 2, count: Number.NaN }),
  ]);

  // A NaN state would be rejected by Home Assistant and take the whole publish
  // down with it, so a bad row is worth nothing rather than everything.
  assert.equal(totals.totalWeightLbs, 2);
  assert.equal(totals.totalCount, 1);
});

test('the frost sensor distinguishes "no frost" from "nobody told us"', () => {
  const unknown = buildSensorPayloads({
    prefix: 'garden',
    harvests: [],
    frost: null,
    frostKnown: false,
  }).at(-1)!;

  assert.equal(unknown.state, 'unknown');

  const none = buildSensorPayloads({
    prefix: 'garden',
    harvests: [],
    frost: null,
    frostKnown: true,
  }).at(-1)!;

  // A forecast was read and there is nothing coming. Materially different from
  // Home Assistant being unreachable, and her automations can tell them apart.
  assert.equal(none.state, 'none');
  assert.equal(none.attributes.device_class, 'enum');
  assert.deepEqual(none.attributes.options, ['none', 'advisory', 'frost', 'hard_freeze']);
});

test('the frost sensor carries the detail an automation would branch on', () => {
  const payload = buildSensorPayloads({
    prefix: 'garden',
    harvests: [],
    frostKnown: true,
    frost: {
      severity: 'frost',
      lowF: 30,
      expectedAt: '2026-10-11T05:00:00.000Z',
      precision: 'hour',
      night: '2026-10-10',
      observedAt: '2026-10-09T12:00:00.000Z',
      bedsAtRisk: [
        { bedId: 'b1', bedName: 'Bed 1', tender: ['Cherokee Purple'], hardy: [], unknown: [] },
      ],
      tenderVarieties: ['Cherokee Purple'],
      hardyVarieties: [],
      unknownSquareCount: 0,
      eventKey: '2026-10-10:frost',
    },
  }).at(-1)!;

  assert.equal(payload.state, 'frost');
  assert.equal(payload.attributes.low_f, 30);
  assert.deepEqual(payload.attributes.beds_at_risk, ['Bed 1']);
  assert.deepEqual(payload.attributes.tender_varieties, ['Cherokee Purple']);
});

test('the prefix option moves every entity id', () => {
  const payloads = buildSensorPayloads({
    prefix: 'julies_garden',
    harvests: [],
    frost: null,
    frostKnown: false,
  });

  for (const payload of payloads) {
    assert.match(payload.entityId, /^sensor\.julies_garden_/);
  }
});

test('an absurdly long variety name is truncated to something HA will accept', () => {
  const payload = payloadFor('garden', 'top_variety', [
    harvest({ variety: 'x'.repeat(400), weightLbs: 1 }),
  ]);

  // Home Assistant rejects a state over 255 characters, and a rejected POST
  // would silently drop the sensor.
  assert.ok(payload.state.length <= 255);
});

test('an entity somebody else owns is left alone', async () => {
  const ha = fakeHomeAssistant();

  ha.states.set('sensor.garden_harvest_weight', {
    state: '42',
    attributes: { friendly_name: 'Something else entirely' },
  });

  const warnings: string[] = [];
  const client = clientFor(ha);
  const writable = await findWritableSensors(client, 'garden', (message) => warnings.push(message));

  // Posting would have silently replaced it, and she would have no idea why
  // some other integration started reporting pounds of tomatoes.
  assert.equal(writable.has('sensor.garden_harvest_weight'), false);
  assert.equal(writable.has('sensor.garden_harvest_count'), true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /sensor_prefix/);
});

test('an entity we created before is ours to update', async () => {
  const ha = fakeHomeAssistant();

  ha.states.set('sensor.garden_harvest_weight', {
    state: '12.00',
    attributes: { attribution: SENSOR_ATTRIBUTION },
  });

  const client = clientFor(ha);
  const writable = await findWritableSensors(client, 'garden', () => {});

  assert.equal(writable.size, 4);
});

test('a failed collision check publishes anyway', async () => {
  const ha = fakeHomeAssistant();

  ha.setUnreachable(true);

  const client = clientFor(ha);
  const writable = await findWritableSensors(client, 'garden', () => {});

  // "I could not check" must not mean "give up". The alternative is that one
  // flaky request during boot disables her sensors until the next restart.
  assert.equal(writable.size, 4);
});

test('publishing writes all four entities to Home Assistant', async () => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha });

  try {
    await server.haService!.refreshSensors();

    for (const sensor of PUBLISHED_SENSORS) {
      const entityId = `sensor.garden_${sensor}`;
      const published = ha.states.get(entityId);

      assert.ok(published, `${entityId} should have been published`);
      assert.equal(published.attributes.attribution, SENSOR_ATTRIBUTION);
    }
  } finally {
    await server.close();
  }
});

test('a harvest write republishes the sensors with the new total', async () => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha });

  try {
    await server.haService!.refreshSensors();
    assert.equal(ha.states.get('sensor.garden_harvest_weight')?.state, '0.00');

    const response = await server.putJson('/api/harvests', [
      harvest({ id: 'h1', weightLbs: 4.5, count: 3, variety: 'Cherokee Purple' }),
    ]);
    assert.equal(response.status, 200);

    await server.haService!.refreshSensors();

    assert.equal(ha.states.get('sensor.garden_harvest_weight')?.state, '4.50');
    assert.equal(ha.states.get('sensor.garden_harvest_count')?.state, '3');
    assert.equal(ha.states.get('sensor.garden_top_variety')?.state, 'Cherokee Purple');
  } finally {
    await server.close();
  }
});

test('the write that triggers a republish is not slowed down by it', async () => {
  const ha = fakeHomeAssistant();
  const server = await startServer({}, { ha });

  try {
    const before = ha.calls.length;

    const started = Date.now();
    const response = await server.putJson('/api/harvests', [harvest({ id: 'h1' })]);
    const elapsed = Date.now() - started;

    assert.equal(response.status, 200);
    // The publish is debounced onto a timer, so nothing about Home Assistant
    // is on the path of a request that stores her data. If Supervisor were
    // hanging, this write would still return now.
    assert.equal(ha.calls.length, before);
    assert.ok(elapsed < 1000, `a harvest write took ${elapsed}ms`);
  } finally {
    await server.close();
  }
});

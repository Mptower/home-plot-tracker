/**
 * The frost assessment, tested where all the interesting decisions actually
 * live: the bands, the crop-family mapping, the night boundary and which beds
 * get named.
 *
 * None of this needs Home Assistant, which is the point — the logic that
 * decides whether to worry her is pure, so it can be pinned down exactly rather
 * than inferred from a live forecast that will be different tomorrow.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_CATEGORIES } from '@hpt/shared';
import { assessFrostRisk, nightOf, severityFor } from '../src/ha/frost.ts';
import type { ForecastPoint } from '../src/ha/frost.ts';
import {
  CATEGORY_TENDERNESS,
  categoriesMissingTenderness,
  tendernessOf,
} from '../src/ha/tenderness.ts';
import { extractForecast, normalisePoint, readCapabilities, toFahrenheit } from '../src/ha/forecast.ts';
import { bed, seed } from './helpers.ts';

const NOW = new Date('2026-10-09T12:00:00-04:00');

/** `days` ahead of NOW at the given local hour, as an ISO instant. */
function ahead(days: number, hour = 23): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);

  return date.toISOString();
}

function point(at: string, lowF: number, precision: 'day' | 'hour' = 'day'): ForecastPoint {
  return { at, lowF, precision };
}

test('every category the app offers has a tenderness', () => {
  // If this fails somebody added a category and every plant of that family
  // silently became `unknown` — which means it would stop being warned about,
  // with nothing anywhere to say so.
  assert.deepEqual(categoriesMissingTenderness(SEED_CATEGORIES), []);
});

test('tenderness maps the families a gardener would expect', () => {
  assert.equal(tendernessOf('Nightshade'), 'tender');
  assert.equal(tendernessOf('Cucurbit'), 'tender');
  assert.equal(tendernessOf('Legume'), 'tender');
  assert.equal(tendernessOf('Brassica'), 'hardy');
  assert.equal(tendernessOf('Allium'), 'hardy');
  assert.equal(tendernessOf('Root'), 'hardy');
  assert.equal(tendernessOf('Leafy Green'), 'hardy');
});

test('an unrecorded or unheard-of category is unknown, never a guess', () => {
  assert.equal(tendernessOf('Brambles'), 'unknown');
  assert.equal(tendernessOf(''), 'unknown');
  assert.equal(tendernessOf(null), 'unknown');
  assert.equal(tendernessOf(undefined), 'unknown');
  // Nothing may reach through the map's prototype and come back as a category.
  assert.equal(tendernessOf('constructor'), 'unknown');
  assert.equal(tendernessOf('toString'), 'unknown');
  assert.equal(CATEGORY_TENDERNESS.Brambles, undefined);
});

test('the bands sit exactly where they are documented', () => {
  assert.equal(severityFor(36.1), 'none');
  assert.equal(severityFor(36), 'advisory');
  assert.equal(severityFor(32.1), 'advisory');
  assert.equal(severityFor(32), 'frost');
  assert.equal(severityFor(28.1), 'frost');
  assert.equal(severityFor(28), 'hard_freeze');
  assert.equal(severityFor(-5), 'hard_freeze');
});

test('an early-morning low belongs to the night before', () => {
  // Built in the machine's own local time on purpose. `nightOf` reasons in
  // local hours — a gardener's "Saturday night" is local by definition — so a
  // fixture written with a fixed UTC offset would pass or fail depending on
  // where the suite happens to run.
  const at = (day: number, hour: number, minute = 0): string =>
    new Date(2026, 9, day, hour, minute).toISOString();

  // A 5am Sunday frost is Saturday night's frost: Saturday evening is when she
  // has to cover the beds, and calling it Sunday would send her out a day late.
  assert.equal(nightOf(at(11, 5), 'hour'), '2026-10-10');
  assert.equal(nightOf(at(11, 23), 'hour'), '2026-10-11');
  // Noon is the boundary.
  assert.equal(nightOf(at(11, 11, 59), 'hour'), '2026-10-10');
  assert.equal(nightOf(at(11, 12), 'hour'), '2026-10-11');
});

test('a daily point keeps its own date, having no hour to reason about', () => {
  assert.equal(nightOf(new Date(2026, 9, 11, 5).toISOString(), 'day'), '2026-10-11');
});

test('nightOf refuses to invent a date from rubbish', () => {
  assert.equal(nightOf('not a date', 'hour'), null);
});

test('no cold in the window means no assessment at all', () => {
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 48), point(ahead(2), 41)],
    beds: [bed()],
    seeds: [seed()],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(watch, null);
});

test('cold with nothing tender planted is reported, but as severity none', () => {
  // The frost sensor still has something true to say; the banner and the phone
  // both stay quiet. That distinction is the whole reason this returns a watch
  // rather than null.
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 30)],
    beds: [bed({ layout: [['Lacinato Kale', null, null], [null, null, null]] })],
    seeds: [seed({ variety: 'Lacinato Kale', category: 'Brassica' })],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.ok(watch);
  assert.equal(watch.severity, 'none');
  assert.deepEqual(watch.bedsAtRisk, []);
});

test('a frost names the tender varieties and the bed holding them', () => {
  const watch = assessFrostRisk({
    forecast: [point(ahead(2), 30)],
    beds: [
      bed({
        layout: [
          ['Cherokee Purple', 'Black Beauty', null],
          ['Lacinato Kale', null, null],
        ],
      }),
    ],
    seeds: [
      seed({ variety: 'Cherokee Purple', category: 'Nightshade' }),
      seed({ id: 's2', variety: 'Black Beauty', category: 'Cucurbit' }),
      seed({ id: 's3', variety: 'Lacinato Kale', category: 'Brassica' }),
    ],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.ok(watch);
  assert.equal(watch.severity, 'frost');
  assert.equal(watch.lowF, 30);
  assert.deepEqual(watch.tenderVarieties, ['Black Beauty', 'Cherokee Purple']);
  // The reassuring half of the message: what will be fine.
  assert.deepEqual(watch.hardyVarieties, ['Lacinato Kale']);
  assert.equal(watch.bedsAtRisk.length, 1);
  assert.equal(watch.bedsAtRisk[0]?.bedName, 'Bed 1 - Raised');
  assert.equal(watch.eventKey, `${watch.night}:frost`);
});

test('a hardy-only bed is left out of a frost but named in a hard freeze', () => {
  const beds = [
    bed({ id: 'b1', name: 'Tomato bed', layout: [['Cherokee Purple', null, null], [null, null, null]] }),
    bed({ id: 'b2', name: 'Kale bed', layout: [['Lacinato Kale', null, null], [null, null, null]] }),
  ];
  const seeds = [
    seed({ variety: 'Cherokee Purple', category: 'Nightshade' }),
    seed({ id: 's2', variety: 'Lacinato Kale', category: 'Brassica' }),
  ];

  const frost = assessFrostRisk({
    forecast: [point(ahead(1), 30)],
    beds,
    seeds,
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.deepEqual(frost?.bedsAtRisk.map((b) => b.bedName), ['Tomato bed']);

  const hardFreeze = assessFrostRisk({
    forecast: [point(ahead(1), 26)],
    beds,
    seeds,
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(hardFreeze?.severity, 'hard_freeze');
  // Below 28°F the kale is in trouble too, so it gets named.
  assert.deepEqual(hardFreeze?.bedsAtRisk.map((b) => b.bedName), ['Tomato bed', 'Kale bed']);
});

test('an uncatalogued planting is counted and admitted, never warned about', () => {
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 30)],
    beds: [
      bed({
        layout: [
          ['Mystery Squash', 'Mystery Squash', null],
          ['Something Else', null, null],
        ],
      }),
    ],
    seeds: [],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.ok(watch);
  // Nothing is classified, so nothing is at risk and the banner stays quiet…
  assert.equal(watch.severity, 'none');
  assert.deepEqual(watch.bedsAtRisk, []);
  // …but the squares are counted, so the UI can be honest about the gap. Three
  // planted squares, two of them the same variety.
  assert.equal(watch.unknownSquareCount, 3);
});

test('unknown squares are counted across every bed, not only the ones at risk', () => {
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 30)],
    beds: [
      bed({ id: 'b1', name: 'Tomatoes', layout: [['Cherokee Purple', null, null], [null, null, null]] }),
      bed({ id: 'b2', name: 'Mystery', layout: [['Who Knows', null, null], [null, null, null]] }),
    ],
    seeds: [seed({ variety: 'Cherokee Purple', category: 'Nightshade' })],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(watch?.bedsAtRisk.length, 1);
  assert.equal(watch?.unknownSquareCount, 1);
});

test('the coldest night wins, and one snap stays one event', () => {
  const watch = assessFrostRisk({
    // Two readings for the same night plus a colder one later. Without the
    // per-night rollup this would be three candidate events.
    forecast: [
      point(ahead(1, 23), 34),
      point(ahead(2, 5), 33, 'hour'),
      point(ahead(3, 23), 27),
    ],
    beds: [bed({ layout: [['Cherokee Purple', null, null], [null, null, null]] })],
    seeds: [seed({ variety: 'Cherokee Purple', category: 'Nightshade' })],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(watch?.lowF, 27);
  assert.equal(watch?.severity, 'hard_freeze');
});

test('an hourly reading beats a daily one at the same temperature', () => {
  // Both describe the same night; the hourly one can name an hour, so it is the
  // one worth keeping.
  const watch = assessFrostRisk({
    forecast: [point(ahead(1, 12), 30, 'day'), point(ahead(1, 23), 30, 'hour')],
    beds: [bed({ layout: [['Cherokee Purple', null, null], [null, null, null]] })],
    seeds: [seed({ variety: 'Cherokee Purple', category: 'Nightshade' })],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(watch?.precision, 'hour');
});

test('readings in the past and beyond the window are ignored', () => {
  const watch = assessFrostRisk({
    forecast: [point(ahead(-1), 20), point(ahead(9), 18)],
    beds: [bed({ layout: [['Cherokee Purple', null, null], [null, null, null]] })],
    seeds: [seed({ variety: 'Cherokee Purple', category: 'Nightshade' })],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(watch, null);
});

test('an empty garden is never at risk', () => {
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 20)],
    beds: [],
    seeds: [],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.equal(watch?.severity, 'none');
  assert.equal(watch?.unknownSquareCount, 0);
});

test('a ragged or hand-edited layout still has its plantings counted', () => {
  const watch = assessFrostRisk({
    forecast: [point(ahead(1), 30)],
    // `rows`/`columns` disagree with the layout, and there is junk in it.
    beds: [
      bed({
        rows: 9,
        columns: 9,
        layout: [['Cherokee Purple'], [], [null, '  '], ['Cherokee Purple']] as never,
      }),
    ],
    seeds: [seed({ variety: 'Cherokee Purple', category: 'Nightshade' })],
    observedAt: NOW.toISOString(),
    now: NOW,
  });

  assert.deepEqual(watch?.tenderVarieties, ['Cherokee Purple']);
});

test('Celsius is converted on the way in, so everything downstream is °F', () => {
  assert.equal(toFahrenheit(0, '°C'), 32);
  assert.equal(toFahrenheit(-2, '°C'), 28.4);
  // Already Fahrenheit: left exactly alone.
  assert.equal(toFahrenheit(30, '°F'), 30);
});

test('a Celsius forecast entry lands in the right band', () => {
  const converted = normalisePoint({ datetime: ahead(1), templow: -1 }, 'day', '°C');

  assert.equal(converted?.lowF, 30.2);
  assert.equal(severityFor(converted!.lowF), 'frost');
});

test('supported_features decides which forecasts are even asked for', () => {
  assert.deepEqual(readCapabilities({ supported_features: 3, temperature_unit: '°F' }), {
    temperatureUnit: '°F',
    supportsDaily: true,
    supportsHourly: true,
  });

  const dailyOnly = readCapabilities({ supported_features: 1 });
  assert.equal(dailyOnly.supportsDaily, true);
  assert.equal(dailyOnly.supportsHourly, false);

  // No features advertised at all: assume daily rather than nothing, because a
  // call that fails is cheaper than a feature that silently never runs.
  assert.equal(readCapabilities({}).supportsDaily, true);
});

test('a daily entry without an overnight low is skipped, not read as its high', () => {
  // `temperature` on a daily entry is the daytime high. Treating a 70°F high as
  // the night's low would miss the frost entirely.
  assert.equal(normalisePoint({ datetime: ahead(1), temperature: 70 }, 'day', '°F'), null);
  assert.equal(normalisePoint({ datetime: ahead(1), templow: 30 }, 'day', '°F')?.lowF, 30);
  // An hourly entry has only `temperature`, and that is the hour's temperature.
  assert.equal(normalisePoint({ datetime: ahead(1), temperature: 30 }, 'hour', '°F')?.lowF, 30);
});

test('malformed forecast entries are dropped rather than crashing the poll', () => {
  assert.equal(normalisePoint(null, 'day', '°F'), null);
  assert.equal(normalisePoint({ templow: 30 }, 'day', '°F'), null);
  assert.equal(normalisePoint({ datetime: 'nope', templow: 30 }, 'day', '°F'), null);
  assert.equal(normalisePoint({ datetime: ahead(1), templow: 'cold' }, 'day', '°F'), null);
});

test('the forecast is found wherever the service response nests it', () => {
  const forecast = [{ datetime: ahead(1), templow: 30 }];

  assert.deepEqual(
    extractForecast({ service_response: { 'weather.forecast_home': { forecast } } }, 'weather.forecast_home'),
    forecast,
  );
  // Entity key not assumed: the nesting has moved between versions.
  assert.deepEqual(
    extractForecast({ service_response: { 'weather.other': { forecast } } }, 'weather.forecast_home'),
    forecast,
  );
  assert.deepEqual(extractForecast({}, 'weather.forecast_home'), []);
  assert.deepEqual(extractForecast(null, 'weather.forecast_home'), []);
});

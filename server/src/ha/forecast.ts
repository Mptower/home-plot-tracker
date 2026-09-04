/**
 * Reading her weather forecast and normalising it to something assessable.
 *
 * Two things about Home Assistant's weather API drive the shape of this file.
 *
 * **The forecast is not in the entity's attributes.** It used to be, and most
 * examples on the internet still say so, but since 2024.4 `weather.*` entities
 * expose only current conditions in their state attributes. The forecast comes
 * from calling `weather.get_forecasts` with `return_response=true` — a service
 * call that returns data, which is unusual enough to be worth stating plainly.
 *
 * **`supported_features` is a bitmask.** Bit 1 is daily, bit 2 is hourly. Her
 * `weather.forecast_home` reports `3`, so both. Checking rather than assuming
 * means a different weather integration — or the same one after an upgrade —
 * degrades to whatever it does support instead of logging a failure every
 * fifteen minutes for a call that was never going to work.
 */
import type { ForecastPoint } from './frost.ts';
import type { HaResult, HomeAssistantClient } from './client.ts';

const FEATURE_DAILY = 1;
const FEATURE_HOURLY = 2;

/** What the weather entity itself tells us before we ask for a forecast. */
export interface WeatherCapabilities {
  /** `°F` or `°C`, as the entity reports it. */
  temperatureUnit: string;
  supportsDaily: boolean;
  supportsHourly: boolean;
}

export interface ForecastReading {
  points: ForecastPoint[];
  /** ISO-8601 instant the forecast was fetched. */
  observedAt: string;
}

/**
 * °C to °F, when her entity ever reports Celsius.
 *
 * It currently reports °F, and the brief was explicit about not introducing
 * Celsius anywhere she can see. But the unit is a property of her Home
 * Assistant's configuration, not of this app, and one day it might change.
 * Converting on the way in means every threshold, sensor and sentence
 * downstream can be written in °F without a second thought.
 */
export function toFahrenheit(value: number, unit: string): number {
  return unit.includes('C') ? value * 1.8 + 32 : value;
}

export function readCapabilities(attributes: Record<string, unknown>): WeatherCapabilities {
  const features =
    typeof attributes.supported_features === 'number' ? attributes.supported_features : 0;
  const unit =
    typeof attributes.temperature_unit === 'string' ? attributes.temperature_unit : '°F';

  return {
    temperatureUnit: unit,
    // A weather entity with no `supported_features` at all is old or unusual.
    // Assume daily rather than nothing: the daily forecast is the one the
    // warning actually needs, and a call that fails is cheaper than a feature
    // that silently never runs.
    supportsDaily: features === 0 || (features & FEATURE_DAILY) !== 0,
    supportsHourly: (features & FEATURE_HOURLY) !== 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Digs the forecast array out of the service response.
 *
 * The response is shaped `{ service_response: { "weather.x": { forecast: [...] } } }`,
 * but the exact nesting has moved between versions, so the entity key is not
 * assumed — the first entry with a `forecast` array wins.
 */
export function extractForecast(response: unknown, entityId: string): unknown[] {
  if (!isRecord(response)) return [];

  const body = isRecord(response.service_response) ? response.service_response : response;
  const direct = body[entityId];

  if (isRecord(direct) && Array.isArray(direct.forecast)) return direct.forecast;

  for (const value of Object.values(body)) {
    if (isRecord(value) && Array.isArray(value.forecast)) return value.forecast;
  }

  return [];
}

/**
 * One forecast entry to a normalised point, or `null` if it says nothing useful.
 *
 * A daily entry carries both `templow` (the overnight low) and `temperature`
 * (the daytime high); the low is the one that matters and the high is a poor
 * substitute, so a daily entry without `templow` is skipped rather than
 * assessed on its high — treating a 40°F daytime high as the night's low would
 * miss the frost entirely.
 *
 * An hourly entry has only `temperature`, which *is* that hour's temperature,
 * so it is used directly.
 */
export function normalisePoint(
  entry: unknown,
  precision: 'day' | 'hour',
  unit: string,
): ForecastPoint | null {
  if (!isRecord(entry)) return null;
  if (typeof entry.datetime !== 'string') return null;

  const raw = precision === 'day' ? entry.templow : entry.temperature;

  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (Number.isNaN(new Date(entry.datetime).getTime())) return null;

  return {
    at: entry.datetime,
    lowF: Math.round(toFahrenheit(raw, unit) * 10) / 10,
    precision,
  };
}

/**
 * The whole forecast read, as one call.
 *
 * Returns `ok: false` only when there is nothing usable at all — a missing
 * entity, or both service calls failing. A daily forecast that arrives without
 * its hourly companion is a success with less precision, not a failure: the
 * warning still works, it just says "Saturday" instead of "around 5am".
 */
export async function readForecast(
  client: HomeAssistantClient,
  entityId: string,
): Promise<HaResult<ForecastReading>> {
  const state = await client.getState(entityId);

  if (!state.ok) return state;

  const capabilities = readCapabilities(state.value.attributes ?? {});
  const points: ForecastPoint[] = [];
  let anySucceeded = false;

  for (const [supported, type] of [
    [capabilities.supportsDaily, 'daily'],
    [capabilities.supportsHourly, 'hourly'],
  ] as const) {
    if (!supported) continue;

    const response = await client.callService(
      'weather',
      'get_forecasts',
      { entity_id: entityId, type },
      true,
    );

    if (!response.ok) continue;

    anySucceeded = true;

    for (const entry of extractForecast(response.value, entityId)) {
      const point = normalisePoint(entry, type === 'daily' ? 'day' : 'hour', capabilities.temperatureUnit);

      if (point !== null) points.push(point);
    }
  }

  if (!anySucceeded) {
    return { ok: false, error: `no forecast available from ${entityId}` };
  }

  return { ok: true, value: { points, observedAt: new Date().toISOString() } };
}

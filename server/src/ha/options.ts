/**
 * The add-on's user-facing options, read in Node rather than in the entrypoint.
 *
 * Supervisor writes whatever the user typed into the add-on's Configuration tab
 * to `/data/options.json` and starts the container. The usual way to get those
 * into the process is `bashio::config` in the entrypoint — but this image is
 * built on `node:22-alpine` rather than a Home Assistant base image, so there is
 * no `bashio`, and `sh` cannot parse JSON without dragging in `jq`.
 *
 * Reading the file here instead means `addon/rootfs/run.sh` needs no changes at
 * all, there is no shell JSON parsing to get subtly wrong, and the same code
 * path is exercised by the tests, which point `ADDON_OPTIONS_PATH` at a
 * temporary file.
 *
 * Precedence is **options.json > environment > default**. That inversion of the
 * usual order is deliberate: the environment here is set by `run.sh`, which is
 * ours, while `options.json` is the only one of the three she can actually
 * change from the Home Assistant UI. A setting she has typed in should win over
 * one we baked in.
 *
 * Every option is optional and every blank one falls back, so an add-on
 * upgraded from a version that had no options at all starts with sensible
 * values and nothing to fill in.
 */
import fs from 'node:fs';
import type { HomeAssistantEnv } from '../config.ts';
import { parseTimeOfDay } from '../config.ts';

/** Resolved, validated, and ready to hand to the integration. */
export interface HomeAssistantOptions {
  token: string;
  baseUrl: string;
  weatherEntity: string;
  notifyService: string;
  sensorPrefix: string;
  frostNotifications: boolean;
  /** Minutes from local midnight. Equal values mean "no quiet hours". */
  quietHoursStartMinutes: number;
  quietHoursEndMinutes: number;
}

/** `weather.forecast_home`, `notify.mobile_app_julie_s_phone`. */
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
const SENSOR_PREFIX = /^[a-z][a-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads `options.json`, or returns `{}` for every reason it might not be there.
 *
 * A missing file is the normal case off the add-on. A malformed one is somebody
 * hand-editing `/data`, and the right response is still to fall back to the
 * defaults with a warning rather than to refuse to boot: the garden working is
 * worth more than the frost warning working.
 */
export function readAddonOptions(
  optionsPath: string,
  warn: (message: string) => void = console.warn,
): Record<string, unknown> {
  let raw: string;

  try {
    raw = fs.readFileSync(optionsPath, 'utf8');
  } catch {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      warn(`Ignoring ${optionsPath}: expected a JSON object, got ${typeof parsed}.`);
      return {};
    }

    return parsed;
  } catch (error) {
    warn(`Ignoring ${optionsPath}: it is not valid JSON (${(error as Error).message}).`);
    return {};
  }
}

/** A trimmed non-empty string from the options, or `undefined` to fall back. */
function optionalString(options: Record<string, unknown>, key: string): string | undefined {
  const value = options[key];

  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}

/**
 * A validated option, or the fallback with a warning.
 *
 * A typo in an entity id would otherwise show up as "the frost warning never
 * appears", with nothing anywhere to explain why. Naming it in the add-on log
 * turns a silent dead feature into a one-line fix.
 */
function validated(
  raw: string | undefined,
  pattern: RegExp,
  fallback: string,
  label: string,
  warn: (message: string) => void,
): string {
  if (raw === undefined) return fallback;

  if (!pattern.test(raw)) {
    warn(
      `Ignoring the ${label} option ${JSON.stringify(raw)}: it is not a valid ${label}. ` +
        `Using ${fallback}.`,
    );
    return fallback;
  }

  return raw;
}

function optionalBoolean(options: Record<string, unknown>, key: string): boolean | undefined {
  const value = options[key];

  return typeof value === 'boolean' ? value : undefined;
}

function timeOption(
  raw: string | undefined,
  fallback: string,
  label: string,
  warn: (message: string) => void,
): number {
  try {
    return parseTimeOfDay(label, raw ?? fallback);
  } catch {
    warn(`Ignoring the ${label} option ${JSON.stringify(raw)}: expected HH:MM. Using ${fallback}.`);
    return parseTimeOfDay(label, fallback);
  }
}

/**
 * Layers `options.json` over the environment.
 *
 * Returns `null` when there is no `SUPERVISOR_TOKEN`, which is the single
 * switch for the whole integration: no token, no options worth resolving, no
 * timers, no requests. Callers treat `null` as "there is no Home Assistant
 * here", which is a supported way to run this app and not a failure.
 */
export function resolveHomeAssistantOptions(
  env: HomeAssistantEnv,
  warn: (message: string) => void = console.warn,
): HomeAssistantOptions | null {
  if (env.token === null) return null;

  const options = readAddonOptions(env.optionsPath, warn);

  return {
    token: env.token,
    baseUrl: env.baseUrl,
    weatherEntity: validated(
      optionalString(options, 'weather_entity') ?? env.weatherEntity,
      ENTITY_ID,
      env.weatherEntity,
      'weather entity',
      warn,
    ),
    notifyService: validated(
      optionalString(options, 'notify_service') ?? env.notifyService,
      ENTITY_ID,
      env.notifyService,
      'notify service',
      warn,
    ),
    sensorPrefix: validated(
      optionalString(options, 'sensor_prefix') ?? env.sensorPrefix,
      SENSOR_PREFIX,
      env.sensorPrefix,
      'sensor prefix',
      warn,
    ),
    frostNotifications: optionalBoolean(options, 'frost_notifications') ?? env.frostNotifications,
    quietHoursStartMinutes: timeOption(
      optionalString(options, 'quiet_hours_start') ?? env.quietHoursStart,
      env.quietHoursStart,
      'quiet_hours_start',
      warn,
    ),
    quietHoursEndMinutes: timeOption(
      optionalString(options, 'quiet_hours_end') ?? env.quietHoursEnd,
      env.quietHoursEnd,
      'quiet_hours_end',
      warn,
    ),
  };
}

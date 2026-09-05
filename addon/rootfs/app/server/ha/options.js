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
 *
 * What is here is **entity plumbing only** — which weather entity, which notify
 * service, which sensor prefix. Matt sets those once. The three settings a
 * gardener actually changes (frost notifications and quiet hours) moved into
 * the app's own database in 0.3.0; the only thing left of them here is
 * `readLegacyNotificationSettings`, which exists to carry the old values across
 * that upgrade exactly once.
 */
import fs from 'node:fs';
import { DEFAULT_SETTINGS } from "../db/settings.js";
/** `weather.forecast_home`, `notify.mobile_app_julie_s_phone`. */
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
const SENSOR_PREFIX = /^[a-z][a-z0-9_]*$/;
function isRecord(value) {
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
export function readAddonOptions(optionsPath, warn = console.warn) {
    let raw;
    try {
        raw = fs.readFileSync(optionsPath, 'utf8');
    }
    catch {
        return {};
    }
    try {
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) {
            warn(`Ignoring ${optionsPath}: expected a JSON object, got ${typeof parsed}.`);
            return {};
        }
        return parsed;
    }
    catch (error) {
        warn(`Ignoring ${optionsPath}: it is not valid JSON (${error.message}).`);
        return {};
    }
}
/** A trimmed non-empty string from the options, or `undefined` to fall back. */
function optionalString(options, key) {
    const value = options[key];
    if (typeof value !== 'string')
        return undefined;
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
function validated(raw, pattern, fallback, label, warn) {
    if (raw === undefined)
        return fallback;
    if (!pattern.test(raw)) {
        warn(`Ignoring the ${label} option ${JSON.stringify(raw)}: it is not a valid ${label}. ` +
            `Using ${fallback}.`);
        return fallback;
    }
    return raw;
}
function optionalBoolean(options, key) {
    const value = options[key];
    return typeof value === 'boolean' ? value : undefined;
}
/** `HH:MM`, 24-hour. The only shape a quiet-hours bound is accepted in. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;
/**
 * The three preferences as they were last set in the add-on's Configuration tab.
 *
 * **This is a best-effort upgrade path, not a source of truth**, and on a real
 * Supervisor install it will usually find nothing. That is expected.
 *
 * `frost_notifications`, `quiet_hours_start` and `quiet_hours_end` moved into
 * the app's own database in 0.3.0 and are no longer declared in
 * `addon/config.yaml`. Supervisor rewrites `/data/options.json` on every start
 * from the *current* schema — `write_options()` calls
 * `self.schema.validate(self.options)`, and the validator skips any key the
 * schema does not declare ("Ignore unknown options / remove from list"). So by
 * the time this process starts on 0.3.0, the three keys have already been
 * filtered out of the file, and this returns `DEFAULT_SETTINGS`.
 *
 * That is why `DEFAULT_SETTINGS.frostNotifications` is `false`: this fallback is
 * the upgrade's normal outcome, not its edge case, and it must not be able to
 * switch notifications on for someone who deliberately turned them off.
 *
 * It is still worth keeping. It costs one file read at boot, it is correct on
 * any path where the values *are* still present — a hand-managed `options.json`,
 * a standalone deployment, a restore from a backup taken before the update —
 * and it is the only code that can recover a **non-default** quiet-hours window.
 * A window of 22:30–06:00 cannot be reconstructed from the defaults.
 *
 * Anything malformed falls back rather than throwing. A migration that refuses
 * to run because a hand-edited options file has `quiet_hours_start: "9pm"`
 * would take the whole garden down with it.
 */
export function readLegacyNotificationSettings(optionsPath, warn = console.warn) {
    return readSettingsSeed(optionsPath, warn).settings;
}
export function readSettingsSeed(optionsPath, warn = console.warn) {
    const options = readAddonOptions(optionsPath, warn);
    const recovered = [];
    const start = optionalString(options, 'quiet_hours_start');
    const end = optionalString(options, 'quiet_hours_end');
    const time = (raw, fallback, label) => {
        if (raw === undefined)
            return fallback;
        if (!TIME_OF_DAY.test(raw)) {
            warn(`Ignoring the add-on's ${label} option ${JSON.stringify(raw)}: expected HH:MM. ` +
                `Seeding the settings with ${fallback}.`);
            return fallback;
        }
        recovered.push(label);
        return raw;
    };
    const notifications = optionalBoolean(options, 'frost_notifications');
    if (notifications !== undefined)
        recovered.push('frost_notifications');
    return {
        settings: {
            frostNotifications: notifications ?? DEFAULT_SETTINGS.frostNotifications,
            quietHoursStart: time(start, DEFAULT_SETTINGS.quietHoursStart, 'quiet_hours_start'),
            quietHoursEnd: time(end, DEFAULT_SETTINGS.quietHoursEnd, 'quiet_hours_end'),
        },
        recovered,
    };
}
/**
 * Layers `options.json` over the environment.
 *
 * Returns `null` when there is no `SUPERVISOR_TOKEN`, which is the single
 * switch for the whole integration: no token, no options worth resolving, no
 * timers, no requests. Callers treat `null` as "there is no Home Assistant
 * here", which is a supported way to run this app and not a failure.
 */
export function resolveHomeAssistantOptions(env, warn = console.warn) {
    if (env.token === null)
        return null;
    const options = readAddonOptions(env.optionsPath, warn);
    return {
        token: env.token,
        baseUrl: env.baseUrl,
        weatherEntity: validated(optionalString(options, 'weather_entity') ?? env.weatherEntity, ENTITY_ID, env.weatherEntity, 'weather entity', warn),
        notifyService: validated(optionalString(options, 'notify_service') ?? env.notifyService, ENTITY_ID, env.notifyService, 'notify service', warn),
        sensorPrefix: validated(optionalString(options, 'sensor_prefix') ?? env.sensorPrefix, SENSOR_PREFIX, env.sensorPrefix, 'sensor prefix', warn),
    };
}
//# sourceMappingURL=options.js.map
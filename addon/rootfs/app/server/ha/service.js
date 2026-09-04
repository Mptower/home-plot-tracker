import { listBeds, listHarvests, listSeeds } from "../db/collections.js";
import { HomeAssistantClient } from "./client.js";
import { resolveHomeAssistantOptions } from "./options.js";
import { assessFrostRisk } from "./frost.js";
import { readForecast } from "./forecast.js";
import { buildSensorPayloads, findWritableSensors, publishSensors } from "./sensors.js";
import { decideNotification, recordNotification } from "./notifier.js";
/** How often to re-read the forecast. */
const FORECAST_INTERVAL_MS = 15 * 60 * 1000;
/**
 * How often to re-post the sensors.
 *
 * This is a heartbeat, not a change feed. Entities created through
 * `POST /api/states` are dropped by every Home Assistant restart and we get no
 * signal when that happens, so the only way her dashboard heals itself is to
 * keep posting.
 */
const SENSOR_INTERVAL_MS = 5 * 60 * 1000;
/**
 * Let Home Assistant finish starting before asking it anything.
 *
 * The add-on and Home Assistant come up together after a host reboot, and the
 * first thirty seconds are when the API is most likely to be up but not yet
 * answering usefully.
 */
const FIRST_POLL_DELAY_MS = 20 * 1000;
/** Collapses a burst of harvest edits into one publish. */
const CHANGE_DEBOUNCE_MS = 3 * 1000;
export class HomeAssistantService {
    #db;
    #options;
    #client;
    #log;
    #warn;
    #forecast = null;
    /** `false` until a forecast has been read at least once. Drives `reason`. */
    #forecastKnown = false;
    #reachable = true;
    #writableSensors = null;
    /** `undefined` until asked; `null` when Supervisor could not tell us. */
    #ingressSlug = undefined;
    #forecastTimer = null;
    #sensorTimer = null;
    #changeTimer = null;
    #forecastInFlight = false;
    #sensorsInFlight = false;
    #stopped = false;
    constructor(deps, options) {
        this.#db = deps.db;
        this.#options = options;
        this.#log = deps.log ?? console.log;
        this.#warn = deps.warn ?? console.warn;
        this.#client = new HomeAssistantClient({
            baseUrl: options.baseUrl,
            token: options.token,
            fetchImpl: deps.fetchImpl,
        });
    }
    /**
     * Builds the service, or `null` when there is no Home Assistant to talk to.
     *
     * `null` is the whole degrade-to-absent story in one place: no token, no
     * service, and every caller already has to handle the absence because the
     * type says so.
     */
    static create(deps) {
        const options = resolveHomeAssistantOptions(deps.env, deps.warn ?? console.warn);
        if (options === null)
            return null;
        return new HomeAssistantService(deps, options);
    }
    get options() {
        return this.#options;
    }
    start() {
        if (this.#stopped)
            return;
        // `setTimeout` first, then an interval: the first poll is deferred so the
        // add-on is not racing Home Assistant's own startup, and the interval only
        // begins once that has been done.
        this.#forecastTimer = setTimeout(() => {
            void this.#pollForecast();
            this.#forecastTimer = setInterval(() => void this.#pollForecast(), FORECAST_INTERVAL_MS);
            this.#forecastTimer.unref?.();
        }, FIRST_POLL_DELAY_MS);
        this.#forecastTimer.unref?.();
        this.#sensorTimer = setTimeout(() => {
            void this.#publish();
            this.#sensorTimer = setInterval(() => void this.#publish(), SENSOR_INTERVAL_MS);
            this.#sensorTimer.unref?.();
        }, FIRST_POLL_DELAY_MS);
        this.#sensorTimer.unref?.();
        this.#log(`Home Assistant integration enabled (weather: ${this.#options.weatherEntity}, ` +
            `sensors: sensor.${this.#options.sensorPrefix}_*, ` +
            `notifications: ${this.#options.frostNotifications ? this.#options.notifyService : 'off'}).`);
        // Every time this integration renders — quiet hours, "Saturday night",
        // "around 5am" — is read off the ambient zone, which reaches us as `TZ`
        // from Supervisor and is resolved by Node's bundled tzdata. It costs
        // nothing to record it, and when a frost warning arrives at the wrong hour
        // next October this is the first line anyone will want to see.
        this.#log(`Home Assistant integration timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone} ` +
            `(TZ=${process.env.TZ ?? 'unset'}, local hour now ${new Date().getHours()}).`);
    }
    stop() {
        this.#stopped = true;
        for (const timer of [this.#forecastTimer, this.#sensorTimer, this.#changeTimer]) {
            if (timer) {
                clearTimeout(timer);
                clearInterval(timer);
            }
        }
        this.#forecastTimer = null;
        this.#sensorTimer = null;
        this.#changeTimer = null;
    }
    /**
     * Called after any write that changes the numbers on her dashboard.
     *
     * Debounced, because editing three harvest rows in a row is one dashboard
     * update, not three. Never awaited by the request that triggered it — the
     * write returns at exactly the speed it did before this feature existed.
     */
    onGardenChanged() {
        if (this.#stopped)
            return;
        if (this.#changeTimer)
            clearTimeout(this.#changeTimer);
        this.#changeTimer = setTimeout(() => {
            this.#changeTimer = null;
            void this.#publish();
        }, CHANGE_DEBOUNCE_MS);
        this.#changeTimer.unref?.();
    }
    /**
     * Runs one forecast poll now, and notifies if the rules allow it.
     *
     * Public so the tests can drive the integration deterministically instead of
     * waiting on a twenty-second timer, and so a future manual refresh has
     * somewhere obvious to go. Resolves once the poll is done; never rejects.
     */
    async refreshForecast() {
        await this.#pollForecast();
    }
    /** Publishes the sensors now. Same reasoning as `refreshForecast`. */
    async refreshSensors() {
        await this.#publish();
    }
    /**
     * What the client's endpoint returns.
     *
     * Synchronous and local: the cached forecast plus a fresh read of the beds
     * and the vault, so a square planted thirty seconds ago is already reflected
     * without waiting on Home Assistant for anything.
     */
    snapshot() {
        if (!this.#reachable)
            return { available: false, reason: 'unreachable', frost: null };
        if (!this.#forecastKnown) {
            // Before the first poll completes there is genuinely nothing to say. The
            // client renders nothing, which is the same as it will do if there turns
            // out to be no frost — so there is no flash of a placeholder.
            return { available: false, reason: 'no_forecast', frost: null };
        }
        return { available: true, reason: null, frost: this.#assess() };
    }
    #assess() {
        if (this.#forecast === null)
            return null;
        const { beds, seeds } = this.#readGarden();
        return assessFrostRisk({
            forecast: this.#forecast.points,
            beds,
            seeds,
            observedAt: this.#forecast.observedAt,
        });
    }
    #readGarden() {
        try {
            return {
                beds: listBeds(this.#db),
                seeds: listSeeds(this.#db),
                harvests: listHarvests(this.#db),
            };
        }
        catch {
            return { beds: [], seeds: [], harvests: [] };
        }
    }
    /**
     * Logs a connectivity change once, rather than the same line every poll.
     *
     * A night with Home Assistant down should be two lines in the add-on log, not
     * ninety-six.
     */
    #setReachable(reachable, detail) {
        if (reachable === this.#reachable)
            return;
        this.#reachable = reachable;
        if (reachable)
            this.#log('Home Assistant is reachable again.');
        else
            this.#warn(`Home Assistant is not reachable (${detail}). The garden is unaffected.`);
    }
    async #pollForecast() {
        if (this.#stopped || this.#forecastInFlight)
            return;
        this.#forecastInFlight = true;
        try {
            const result = await readForecast(this.#client, this.#options.weatherEntity);
            if (!result.ok) {
                this.#setReachable(false, result.error);
                return;
            }
            this.#setReachable(true, '');
            this.#forecast = { points: result.value.points, observedAt: result.value.observedAt };
            this.#forecastKnown = true;
            await this.#maybeNotify();
        }
        catch (error) {
            // Belt and braces. Nothing below `readForecast` should throw, but an
            // unhandled rejection on a timer would take the whole server down and
            // that is not an acceptable failure mode for a frost warning.
            this.#setReachable(false, error instanceof Error ? error.message : String(error));
        }
        finally {
            this.#forecastInFlight = false;
        }
    }
    async #maybeNotify() {
        const watch = this.#assess();
        const decision = decideNotification(this.#db, watch, {
            enabled: this.#options.frostNotifications,
            quietHoursStartMinutes: this.#options.quietHoursStartMinutes,
            quietHoursEndMinutes: this.#options.quietHoursEndMinutes,
        });
        if (!decision.send || watch === null)
            return;
        const [domain, service] = this.#options.notifyService.split('.');
        if (!domain || !service)
            return;
        // Asked once, lazily, and only when there is actually a notification to
        // send. `undefined` means "not looked up yet"; `null` means "asked and
        // Supervisor could not say", in which case the notification simply goes
        // without a tap target rather than with a wrong one.
        if (this.#ingressSlug === undefined) {
            this.#ingressSlug = await this.#client.getSelfSlug();
        }
        const result = await this.#client.callService(domain, service, {
            title: decision.title,
            message: decision.message,
            data: {
                // A tag means a re-sent warning replaces the old one on her lock screen
                // instead of stacking up next to it.
                tag: 'home-plot-tracker-frost',
                ...(this.#ingressSlug ? { url: `/hassio/ingress/${this.#ingressSlug}` } : {}),
            },
        });
        // Only recorded once it actually left. A send that failed should be retried
        // on the next poll, not remembered as done.
        if (result.ok) {
            recordNotification(this.#db, watch, new Date());
            this.#log(`Sent a frost notification for ${watch.night} (${watch.severity}).`);
        }
    }
    async #publish() {
        if (this.#stopped || this.#sensorsInFlight)
            return;
        this.#sensorsInFlight = true;
        try {
            // The collision check runs once and is remembered: an id owned by
            // something else at boot is not going to become ours later.
            this.#writableSensors ??= await findWritableSensors(this.#client, this.#options.sensorPrefix, this.#warn);
            const { harvests } = this.#readGarden();
            const payloads = buildSensorPayloads({
                prefix: this.#options.sensorPrefix,
                harvests,
                frost: this.#assess(),
                frostKnown: this.#forecastKnown,
            });
            await publishSensors(this.#client, payloads, this.#writableSensors);
        }
        catch (error) {
            this.#setReachable(false, error instanceof Error ? error.message : String(error));
        }
        finally {
            this.#sensorsInFlight = false;
        }
    }
}
//# sourceMappingURL=service.js.map
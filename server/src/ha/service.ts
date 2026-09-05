/**
 * The Home Assistant integration, assembled.
 *
 * This is the only file that owns a timer or decides when anything happens. It
 * exists to keep three promises that matter more than the feature itself:
 *
 * **Home Assistant can never slow the garden down.** Nothing here is called
 * during a request that renders her data. The forecast is polled on a timer and
 * cached; `snapshot()` reads that cache and the local database and never
 * touches the network. If Supervisor takes five seconds to answer, or never
 * answers, the app is exactly as fast as it is today.
 *
 * **Home Assistant can never break the garden.** Every failure path ends in
 * less information, never an exception. The client's endpoint answers `200`
 * with `available: false` and the app renders nothing rather than an error.
 *
 * **With no Home Assistant, none of this exists.** `create()` returns `null`
 * without a `SUPERVISOR_TOKEN`, so on a laptop there is no service, no timer
 * and no request — not a disabled one, not a failing one. That is the ordinary
 * development path and the one the tests run on, so it has to be the quiet one.
 *
 * **Her settings apply without a restart.** Frost notifications and quiet hours
 * are read from the database at the moment each notification decision is made,
 * never cached on this instance. Turning notifications off at 10:00 is honoured
 * by the 10:07 poll; there is no stale copy to go out of date and nothing to
 * restart. That is the practical reason those three settings left the add-on's
 * options in the first place.
 */
import type { GardenBed, HarvestLog, HomeAssistantBody, IntegrationStatusBody, SeedPacket } from '@hpt/shared';
import type { Database } from '../db/open.ts';
import { listBeds, listHarvests, listSeeds } from '../db/collections.ts';
import { readSettings } from '../db/settings.ts';
import type { HomeAssistantEnv } from '../config.ts';
import { parseTimeOfDay } from '../config.ts';
import type { FetchLike } from './client.ts';
import { HomeAssistantClient } from './client.ts';
import type { HomeAssistantOptions } from './options.ts';
import { resolveHomeAssistantOptions } from './options.ts';
import type { ForecastPoint } from './frost.ts';
import { assessFrostRisk } from './frost.ts';
import { readForecast } from './forecast.ts';
import { PUBLISHED_SENSORS, buildSensorPayloads, findWritableSensors, publishSensors } from './sensors.ts';
import { decideNotification, recordNotification } from './notifier.ts';
import type { NotifyOptions } from './notifier.ts';

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

interface CachedForecast {
  points: ForecastPoint[];
  observedAt: string;
}

export interface HomeAssistantServiceDeps {
  db: Database;
  env: HomeAssistantEnv;
  /** Injected by the tests. Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export class HomeAssistantService {
  readonly #db: Database;
  readonly #options: HomeAssistantOptions;
  readonly #client: HomeAssistantClient;
  readonly #log: (message: string) => void;
  readonly #warn: (message: string) => void;

  #forecast: CachedForecast | null = null;
  /** `false` until a forecast has been read at least once. Drives `reason`. */
  #forecastKnown = false;
  #reachable = true;
  #writableSensors: Set<string> | null = null;
  /** `undefined` until asked; `null` when Supervisor could not tell us. */
  #ingressSlug: string | null | undefined = undefined;

  #forecastTimer: NodeJS.Timeout | null = null;
  #sensorTimer: NodeJS.Timeout | null = null;
  #changeTimer: NodeJS.Timeout | null = null;
  #forecastInFlight = false;
  #sensorsInFlight = false;
  #stopped = false;

  private constructor(deps: HomeAssistantServiceDeps, options: HomeAssistantOptions) {
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
  static create(deps: HomeAssistantServiceDeps): HomeAssistantService | null {
    const options = resolveHomeAssistantOptions(deps.env, deps.warn ?? console.warn);

    if (options === null) return null;

    return new HomeAssistantService(deps, options);
  }

  get options(): HomeAssistantOptions {
    return this.#options;
  }

  start(): void {
    if (this.#stopped) return;

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

    this.#log(
      `Home Assistant integration enabled (weather: ${this.#options.weatherEntity}, ` +
        `sensors: sensor.${this.#options.sensorPrefix}_*, ` +
        `notify service: ${this.#options.notifyService}).`,
    );

    // A snapshot for the log, not a cached value. Frost notifications and quiet
    // hours are read from the database at the moment each decision is made —
    // see `#notifyOptions` — so changing them in the app takes effect on the
    // next poll rather than on the next restart, which is the entire point of
    // moving them out of the add-on's options.
    const settings = readSettings(this.#db, this.#warn);

    this.#log(
      `Frost notifications are ${settings.frostNotifications ? 'on' : 'off'}, ` +
        `quiet hours ${
          settings.quietHoursStart === settings.quietHoursEnd
            ? 'disabled'
            : `${settings.quietHoursStart}–${settings.quietHoursEnd}`
        }. Change these in the app's Settings page.`,
    );

    // Every time this integration renders — quiet hours, "Saturday night",
    // "around 5am" — is read off the ambient zone, which reaches us as `TZ`
    // from Supervisor and is resolved by Node's bundled tzdata. It costs
    // nothing to record it, and when a frost warning arrives at the wrong hour
    // next October this is the first line anyone will want to see.
    this.#log(
      `Home Assistant integration timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone} ` +
        `(TZ=${process.env.TZ ?? 'unset'}, local hour now ${new Date().getHours()}).`,
    );
  }

  stop(): void {
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
  onGardenChanged(): void {
    if (this.#stopped) return;
    if (this.#changeTimer) clearTimeout(this.#changeTimer);

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
  async refreshForecast(): Promise<void> {
    await this.#pollForecast();
  }

  /** Publishes the sensors now. Same reasoning as `refreshForecast`. */
  async refreshSensors(): Promise<void> {
    await this.#publish();
  }

  /**
   * What the client's endpoint returns.
   *
   * Synchronous and local: the cached forecast plus a fresh read of the beds
   * and the vault, so a square planted thirty seconds ago is already reflected
   * without waiting on Home Assistant for anything.
   */
  snapshot(): HomeAssistantBody {
    if (!this.#reachable) return { available: false, reason: 'unreachable', frost: null };
    if (!this.#forecastKnown) {
      // Before the first poll completes there is genuinely nothing to say. The
      // client renders nothing, which is the same as it will do if there turns
      // out to be no frost — so there is no flash of a placeholder.
      return { available: false, reason: 'no_forecast', frost: null };
    }

    return { available: true, reason: null, frost: this.#assess() };
  }

  /**
   * The plumbing, for the Settings page's status block.
   *
   * Distinct from `snapshot()` in what it is for: `snapshot()` answers "is a
   * frost coming?", and this answers "is any of this working?". A blank frost
   * banner is the correct display for both a healthy September and a broken
   * integration, and without somewhere to look the two are indistinguishable.
   *
   * Same rules as `snapshot()` — synchronous, local, and never a failure.
   */
  status(): IntegrationStatusBody {
    const frost = this.#forecastKnown && this.#reachable ? this.#assess() : null;

    return {
      configured: true,
      connected: this.#reachable,
      reason: !this.#reachable ? 'unreachable' : this.#forecastKnown ? null : 'no_forecast',
      weatherEntity: this.#options.weatherEntity,
      notifyService: this.#options.notifyService,
      sensors: PUBLISHED_SENSORS.map((name) => `sensor.${this.#options.sensorPrefix}_${name}`),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // `none` is a real answer and a different thing from "no answer yet": it
      // means a forecast was read and nothing planted minds the low.
      frostRisk: this.#forecastKnown && this.#reachable ? (frost?.severity ?? 'none') : null,
      forecastObservedAt: this.#forecast?.observedAt ?? null,
    };
  }

  /**
   * The notification preferences, read fresh from the database every time.
   *
   * Deliberately not cached on the instance. These are hers to change from the
   * Settings page, and a copy taken at construction would mean her answer to
   * "should this wake me?" did not apply until the add-on next restarted. Read
   * here, at the moment the decision is made, a change is honoured by the very
   * next poll and there is no stale window at all.
   *
   * The `HH:MM` strings become minutes from local midnight here, which is the
   * form `inQuietHours` compares against the ambient wall clock. That reading
   * of the clock is deliberate and measured — see the note at the top of
   * `notifier.ts` — and converting a freshly-read setting rather than a cached
   * one does not disturb it: the bounds are still wall-clock minutes, still
   * compared against her local hour.
   */
  #notifyOptions(): NotifyOptions {
    const settings = readSettings(this.#db, this.#warn);

    return {
      enabled: settings.frostNotifications,
      quietHoursStartMinutes: this.#minutes(settings.quietHoursStart, '21:00'),
      quietHoursEndMinutes: this.#minutes(settings.quietHoursEnd, '07:00'),
    };
  }

  /**
   * `HH:MM` to minutes from midnight, falling back rather than throwing.
   *
   * `readSettings` already rejects anything that is not `HH:MM`, so this only
   * fires if the two ever disagree. A throw here would be on a timer, inside a
   * poll, which is not a place to discover a validation gap.
   */
  #minutes(value: string, fallback: string): number {
    try {
      return parseTimeOfDay('quiet hours', value);
    } catch {
      this.#warn(`Ignoring the stored quiet-hours value ${JSON.stringify(value)}; using ${fallback}.`);
      return parseTimeOfDay('quiet hours', fallback);
    }
  }

  #assess() {
    if (this.#forecast === null) return null;

    const { beds, seeds } = this.#readGarden();

    return assessFrostRisk({
      forecast: this.#forecast.points,
      beds,
      seeds,
      observedAt: this.#forecast.observedAt,
    });
  }

  #readGarden(): { beds: GardenBed[]; seeds: SeedPacket[]; harvests: HarvestLog[] } {
    try {
      return {
        beds: listBeds(this.#db),
        seeds: listSeeds(this.#db),
        harvests: listHarvests(this.#db),
      };
    } catch {
      return { beds: [], seeds: [], harvests: [] };
    }
  }

  /**
   * Logs a connectivity change once, rather than the same line every poll.
   *
   * A night with Home Assistant down should be two lines in the add-on log, not
   * ninety-six.
   */
  #setReachable(reachable: boolean, detail: string): void {
    if (reachable === this.#reachable) return;

    this.#reachable = reachable;

    if (reachable) this.#log('Home Assistant is reachable again.');
    else this.#warn(`Home Assistant is not reachable (${detail}). The garden is unaffected.`);
  }

  async #pollForecast(): Promise<void> {
    if (this.#stopped || this.#forecastInFlight) return;

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
    } catch (error) {
      // Belt and braces. Nothing below `readForecast` should throw, but an
      // unhandled rejection on a timer would take the whole server down and
      // that is not an acceptable failure mode for a frost warning.
      this.#setReachable(false, error instanceof Error ? error.message : String(error));
    } finally {
      this.#forecastInFlight = false;
    }
  }

  async #maybeNotify(): Promise<void> {
    const watch = this.#assess();
    const decision = decideNotification(this.#db, watch, this.#notifyOptions());

    if (!decision.send || watch === null) return;

    const [domain, service] = this.#options.notifyService.split('.');

    if (!domain || !service) return;

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

  async #publish(): Promise<void> {
    if (this.#stopped || this.#sensorsInFlight) return;

    this.#sensorsInFlight = true;

    try {
      // The collision check runs once and is remembered: an id owned by
      // something else at boot is not going to become ours later.
      this.#writableSensors ??= await findWritableSensors(
        this.#client,
        this.#options.sensorPrefix,
        this.#warn,
      );

      const { harvests } = this.#readGarden();
      const payloads = buildSensorPayloads({
        prefix: this.#options.sensorPrefix,
        harvests,
        frost: this.#assess(),
        frostKnown: this.#forecastKnown,
      });

      await publishSensors(this.#client, payloads, this.#writableSensors);
    } catch (error) {
      this.#setReachable(false, error instanceof Error ? error.message : String(error));
    } finally {
      this.#sensorsInFlight = false;
    }
  }
}

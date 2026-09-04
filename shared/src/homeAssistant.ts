/**
 * The contract between the server's Home Assistant integration and the browser.
 *
 * Three rules shape everything in this file.
 *
 * **The token never leaves the server.** Home Assistant is reached with
 * `SUPERVISOR_TOKEN` against `http://supervisor/core/api`, which is a
 * credential the browser must never see and could not use anyway. So the client
 * is not given a proxy to Home Assistant; it is given this, a small purpose-built
 * body containing only what the banner renders.
 *
 * **Absence is a normal answer, not a failure.** The app has to run perfectly on
 * a laptop with no Home Assistant at all — that is how it is developed and how
 * the tests run. So the endpoint always answers `200`, and "there is no Home
 * Assistant here" arrives as data rather than as a `404`, a `503` or a timeout.
 * A client that gets `available: false` renders nothing and says nothing. There
 * is deliberately no error state to design, because there is no error.
 *
 * **This file is types only.** Every server import from `@hpt/shared` in this
 * repository is an `import type`, erased at compile time — and that is load
 * bearing, not stylistic. The add-on image built by `scripts/build-addon.mjs`
 * stages `server/dist/src` with `express` as its only dependency; there is no
 * `shared/` and no `node_modules/@hpt/shared` inside it. A runtime value
 * imported from here by the server would resolve fine in development and in the
 * tests, then crash the add-on on boot with `ERR_MODULE_NOT_FOUND`. So the
 * frost bands, the tenderness mapping and the assessment itself live in
 * `server/src/ha/`, and only the shapes they produce live here.
 */

/** How badly a crop family minds the cold. */
export type Tenderness =
  /** Killed or badly burned by a light frost. Cover it or lose it. */
  | 'tender'
  /** Shrugs off a frost; several of these actually taste better after one. */
  | 'hardy'
  /**
   * No crop family recorded, or a family the mapping has never heard of.
   *
   * Never used to raise a warning on its own — guessing would make the warning
   * untrustworthy, which is worse than saying nothing. It is counted and shown,
   * so the UI can be honest that there are squares it cannot speak for.
   */
  | 'unknown';

export type FrostSeverity =
  /** Cold is coming, but nothing planted minds it at that temperature. */
  | 'none'
  /** ≤36°F: tender crops at risk, because plant level runs colder than the forecast. */
  | 'advisory'
  /** ≤32°F: tender crops killed. */
  | 'frost'
  /** ≤28°F: hardy crops damaged too. */
  | 'hard_freeze';

/**
 * How precisely the forecast pins the cold.
 *
 * An hourly forecast can say "around 5am"; a daily one can only say "Saturday".
 * Carrying the difference means the UI never invents a time it was not told.
 */
export type ForecastPrecision = 'hour' | 'day';

/** A bed with something in it that minds the coming cold. */
export interface BedAtRisk {
  bedId: string;
  bedName: string;
  /** Distinct variety names in this bed, by how well they take a frost. */
  tender: string[];
  hardy: string[];
  unknown: string[];
}

export interface FrostWatch {
  severity: FrostSeverity;
  /** Coldest temperature expected in the window, °F. */
  lowF: number;
  /** ISO-8601 instant of that low. */
  expectedAt: string;
  precision: ForecastPrecision;
  /**
   * Local calendar date of the *evening* the cold belongs to, `yyyy-mm-dd`.
   *
   * A 5am low on Sunday is "Saturday night" to a gardener, and the thing she
   * needs to act on before going to bed. This is also what makes one cold snap
   * one event rather than several.
   */
  night: string;
  /** When the forecast behind this was fetched. ISO-8601. */
  observedAt: string;
  /** Beds holding something the band actually threatens. May be empty. */
  bedsAtRisk: BedAtRisk[];
  /** Distinct tender varieties across every bed, for the headline. */
  tenderVarieties: string[];
  /** Distinct hardy varieties across every bed, for the reassuring line. */
  hardyVarieties: string[];
  /** Planted squares whose crop family is not recorded, across every bed. */
  unknownSquareCount: number;
  /**
   * Identity of this cold snap: `night:severity`, e.g. `2026-10-11:frost`.
   *
   * The notifier dedupes on it, and the banner remembers a dismissal against
   * it. Including the band means a snap that gets worse is a new event and is
   * allowed to speak up again, while one that merely gets re-forecast is not.
   */
  eventKey: string;
}

/** Why there is nothing to show. For logs and for deciding to stay quiet — never displayed. */
export type HomeAssistantUnavailableReason =
  /** No `SUPERVISOR_TOKEN`: running outside the add-on. The `npm run dev` case. */
  | 'not_configured'
  /** Configured, but Supervisor did not answer in time or answered with rubbish. */
  | 'unreachable'
  /** Reachable, but the configured weather entity is missing or has no forecast. */
  | 'no_forecast';

export type HomeAssistantBody =
  | { available: false; reason: HomeAssistantUnavailableReason; frost: null }
  /** `frost` is `null` when there is simply no cold in the window. */
  | { available: true; reason: null; frost: FrostWatch | null };

/**
 * The read-only diagnostics behind the Settings page's status block.
 *
 * It exists to answer one question that is otherwise unanswerable from the
 * garden: when no frost warning appears, is this **broken** or is it simply
 * **not frosty**? Those look identical — both are a blank screen — and without
 * somewhere to look, the honest answer to "should I trust this tonight?" is no.
 *
 * So it reports the plumbing rather than the weather: whether Home Assistant is
 * answering at all, which entity the forecast is being read from, which sensor
 * ids are being published, and which timezone the server resolved. A frost risk
 * of `none` alongside a forecast read four minutes ago is a working integration
 * saying there is nothing to warn about — which in a Chicago September, with the
 * lowest forecast low at 71°F, is exactly right.
 *
 * Like `HomeAssistantBody`, absence is data: on a laptop this answers `200` with
 * `configured: false` rather than failing.
 */
export interface IntegrationStatusBody {
  /** `false` without a `SUPERVISOR_TOKEN` — the laptop and test case. */
  configured: boolean;
  /** Talking to Home Assistant successfully as of the last attempt. */
  connected: boolean;
  /** Why there is nothing to show, when there is nothing to show. */
  reason: HomeAssistantUnavailableReason | null;
  /** The entity the forecast is read from, or `null` when not configured. */
  weatherEntity: string | null;
  /** Where a frost warning would be sent. */
  notifyService: string | null;
  /** Fully-qualified ids of the published sensors, e.g. `sensor.garden_frost_risk`. */
  sensors: string[];
  /**
   * The IANA zone the server resolved, e.g. `America/Chicago`.
   *
   * Quiet hours are her wall clock, so this is the one value that explains a
   * notification arriving at the wrong hour. See the note at the top of
   * `server/src/ha/notifier.ts`.
   */
  timeZone: string;
  /** What `sensor.<prefix>_frost_risk` currently reads. `null` before a forecast. */
  frostRisk: FrostSeverity | null;
  /** ISO-8601 instant the forecast behind that was fetched. `null` before the first poll. */
  forecastObservedAt: string | null;
}

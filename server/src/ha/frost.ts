/**
 * Turning a forecast into a sentence about her garden.
 *
 * Everything here is pure: forecast points in, an assessment out. No clock of
 * its own beyond the `now` it is handed, no network, no Home Assistant. That is
 * what makes the interesting parts — the bands, the night boundary, which beds
 * are named — testable without a live Home Assistant anywhere near them.
 *
 * The shape of the answer is driven by what the warning has to say to be worth
 * reading: *what* is coming, *when*, and *which of her beds* mind. A severity
 * on its own is a weather app.
 */
import type {
  BedAtRisk,
  ForecastPrecision,
  FrostSeverity,
  FrostWatch,
  GardenBed,
  SeedPacket,
  Tenderness,
} from '@hpt/shared';
import { FROST_THRESHOLDS_F, tendernessOf } from './tenderness.ts';

/** Rank for comparing bands. Only ever used for ordering, never persisted. */
export const SEVERITY_RANK: Readonly<Record<FrostSeverity, number>> = {
  none: 0,
  advisory: 1,
  frost: 2,
  hard_freeze: 3,
};

/** One normalised forecast reading. Always °F, whatever the entity reported. */
export interface ForecastPoint {
  /** ISO-8601 instant, as Home Assistant gave it. */
  at: string;
  /** The lowest temperature this point implies, in °F. */
  lowF: number;
  precision: ForecastPrecision;
}

/** How far ahead to look. Daily forecasts run about this far and no further. */
export const FORECAST_WINDOW_DAYS = 5;

export function severityFor(lowF: number): FrostSeverity {
  if (lowF <= FROST_THRESHOLDS_F.hardFreeze) return 'hard_freeze';
  if (lowF <= FROST_THRESHOLDS_F.frost) return 'frost';
  if (lowF <= FROST_THRESHOLDS_F.advisory) return 'advisory';

  return 'none';
}

/** `yyyy-mm-dd` from a `Date`, using its **local** calendar parts. */
function toLocalIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Which evening a cold reading belongs to.
 *
 * A frost at 5am on Sunday is Saturday night's frost: it is Saturday evening
 * that she has to cover the beds, and calling it "Sunday" would send her out a
 * day late. Anything before noon is attributed to the night before; anything
 * after is that day's own night.
 *
 * A daily point carries no hour to reason about, so its own date is used as-is
 * — the forecast said "Saturday's low is 30" and that is all it said.
 */
export function nightOf(at: string, precision: ForecastPrecision): string | null {
  const date = new Date(at);

  if (Number.isNaN(date.getTime())) return null;
  if (precision === 'day') return toLocalIsoDate(date);

  const night = new Date(date);
  if (date.getHours() < 12) night.setDate(night.getDate() - 1);

  return toLocalIsoDate(night);
}

interface BedTally {
  bedId: string;
  bedName: string;
  byTenderness: Record<Tenderness, string[]>;
  unknownSquares: number;
}

/** Distinct planted varieties in a bed, bucketed by how they take a frost. */
function tallyBed(bed: GardenBed, categoryOf: (variety: string) => string | null): BedTally {
  const seen = new Map<string, Tenderness>();
  let unknownSquares = 0;

  // The raw layout is walked defensively rather than through `rows`/`columns`.
  // A ragged or hand-edited grid should still have its plantings counted; this
  // is a warning about losing crops, not a place to be strict about shape.
  for (const row of Array.isArray(bed.layout) ? bed.layout : []) {
    for (const cell of Array.isArray(row) ? row : []) {
      if (typeof cell !== 'string') continue;

      const variety = cell.trim();
      if (variety === '') continue;

      const tenderness = tendernessOf(categoryOf(variety));
      if (tenderness === 'unknown') unknownSquares += 1;
      if (!seen.has(variety)) seen.set(variety, tenderness);
    }
  }

  const byTenderness: Record<Tenderness, string[]> = { tender: [], hardy: [], unknown: [] };

  for (const [variety, tenderness] of seen) {
    byTenderness[tenderness].push(variety);
  }

  for (const list of Object.values(byTenderness)) {
    list.sort((left, right) => left.localeCompare(right));
  }

  return { bedId: bed.id, bedName: bed.name, byTenderness, unknownSquares };
}

/** Indexes the vault by variety name, so a lookup is a map hit rather than a scan. */
function buildCategoryLookup(seeds: readonly SeedPacket[]): (variety: string) => string | null {
  const byVariety = new Map<string, string>();

  for (const seed of seeds) {
    if (typeof seed?.variety === 'string') byVariety.set(seed.variety, seed.category);
  }

  return (variety) => byVariety.get(variety) ?? null;
}

export interface FrostAssessmentInput {
  forecast: readonly ForecastPoint[];
  beds: readonly GardenBed[];
  seeds: readonly SeedPacket[];
  /** When the forecast was fetched. ISO-8601. */
  observedAt: string;
  now?: Date;
}

/**
 * The coldest night worth mentioning, and what it means for her beds.
 *
 * Returns `null` when there is simply no cold in the window — no forecast point
 * at or below the advisory band. When there *is* cold but nothing planted minds
 * it, the assessment is returned with `severity: 'none'`: the frost sensor
 * still has something true to report, and the banner and the notifier both know
 * to stay quiet.
 */
export function assessFrostRisk(input: FrostAssessmentInput): FrostWatch | null {
  const now = input.now ?? new Date();
  const horizon = now.getTime() + FORECAST_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  /** Coldest reading per night, so one cold snap cannot become two events. */
  const nights = new Map<string, ForecastPoint>();

  for (const point of input.forecast) {
    if (!Number.isFinite(point.lowF)) continue;
    if (point.lowF > FROST_THRESHOLDS_F.advisory) continue;

    const at = new Date(point.at).getTime();
    if (Number.isNaN(at) || at < now.getTime() || at > horizon) continue;

    const night = nightOf(point.at, point.precision);
    if (night === null) continue;

    const existing = nights.get(night);

    // Coldest wins. On a tie an hourly reading wins over a daily one, because
    // it can name an hour and the daily one cannot.
    if (
      existing === undefined ||
      point.lowF < existing.lowF ||
      (point.lowF === existing.lowF && existing.precision === 'day' && point.precision === 'hour')
    ) {
      nights.set(night, point);
    }
  }

  if (nights.size === 0) return null;

  // The coldest night in the window; the earliest one if two are equally cold,
  // because that is the one she has to act on first.
  const [night, coldest] = [...nights.entries()].reduce((best, candidate) =>
    candidate[1].lowF < best[1].lowF ||
    (candidate[1].lowF === best[1].lowF && candidate[0] < best[0])
      ? candidate
      : best,
  );

  const band = severityFor(coldest.lowF);
  const categoryOf = buildCategoryLookup(input.seeds);
  const tallies = input.beds.map((bed) => tallyBed(bed, categoryOf));

  // What counts as "at risk" depends on the band. Below 28°F the hardy crops
  // are in trouble too, so any planted bed is named. Above that, only tender
  // plantings are. An `unknown` planting never puts a bed on the list by
  // itself — a warning that guesses is a warning she learns to distrust.
  const bedsAtRisk = tallies.filter((tally) =>
    band === 'hard_freeze'
      ? tally.byTenderness.tender.length + tally.byTenderness.hardy.length > 0
      : tally.byTenderness.tender.length > 0,
  );

  const severity: FrostSeverity = bedsAtRisk.length > 0 ? band : 'none';
  const distinct = (lists: string[][]): string[] =>
    [...new Set(lists.flat())].sort((left, right) => left.localeCompare(right));

  const named: BedAtRisk[] = bedsAtRisk.map((tally) => ({
    bedId: tally.bedId,
    bedName: tally.bedName,
    tender: tally.byTenderness.tender,
    hardy: tally.byTenderness.hardy,
    unknown: tally.byTenderness.unknown,
  }));

  return {
    severity,
    lowF: coldest.lowF,
    expectedAt: coldest.at,
    precision: coldest.precision,
    night,
    observedAt: input.observedAt,
    bedsAtRisk: named,
    tenderVarieties: distinct(bedsAtRisk.map((tally) => tally.byTenderness.tender)),
    hardyVarieties: distinct(bedsAtRisk.map((tally) => tally.byTenderness.hardy)),
    // Counted across every bed, not just the ones at risk: the point of this
    // number is to admit what the assessment could not classify at all.
    unknownSquareCount: tallies.reduce((total, tally) => total + tally.unknownSquares, 0),
    eventKey: `${night}:${severity}`,
  };
}

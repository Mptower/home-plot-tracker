/**
 * Pure helpers behind the Harvest Log view: local-safe date handling, grouping
 * by picking day, and season aggregation. Nothing here touches React or storage,
 * so every rule stays easy to reason about and test.
 */
import type { HarvestLog, SeedPacket } from '../types';

/** A harvest entry before it has been given an id. */
export type HarvestDraft = Omit<HarvestLog, 'id'>;

/** All entries logged on one calendar day, with that day's subtotals. */
export interface HarvestDay {
  /** ISO `yyyy-mm-dd` key for the day. */
  date: string;
  /** Human label such as `Saturday, September 4`. */
  label: string;
  entries: HarvestLog[];
  totalWeightLbs: number;
  totalCount: number;
}

/** Season running totals for a single variety. */
export interface VarietyTotal {
  variety: string;
  totalWeightLbs: number;
  totalCount: number;
  entryCount: number;
}

/** Everything the summary strip needs, computed in one pass. */
export interface HarvestTotals {
  totalWeightLbs: number;
  totalCount: number;
  dayCount: number;
  /** Sorted by weight descending, then variety name. */
  varietyTotals: VarietyTotal[];
  topVariety: VarietyTotal | null;
  bestDayWeightLbs: number;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEIGHT_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const COUNT_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

const DAY_LABEL_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

/**
 * Parses an ISO `yyyy-mm-dd` string into a **local** midnight `Date`.
 *
 * `new Date('2026-09-04')` is parsed as UTC midnight, which renders as September
 * 3 anywhere west of Greenwich, so the parts are pulled out and handed to the
 * local `Date` constructor instead. Returns `null` for malformed strings and for
 * calendar-invalid dates such as `2026-02-31` that would otherwise roll over.
 */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

/** Serialises a `Date` back to `yyyy-mm-dd` using its local calendar parts. */
export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/** Today's date in the viewer's own timezone, as `yyyy-mm-dd`. */
export function todayIso(): string {
  return toIsoDate(new Date());
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

/**
 * Formats an ISO date as `Saturday, September 4`, adding the year whenever the
 * entry falls outside the current season. Unparseable input is passed through so
 * a corrupt record still renders something rather than crashing the feed.
 */
export function formatDayLabel(value: string, today: Date = new Date()): string {
  const date = parseIsoDate(value);
  if (!date) return value;

  return date.getFullYear() === today.getFullYear()
    ? DAY_LABEL_FORMATTER.format(date)
    : DAY_LABEL_WITH_YEAR_FORMATTER.format(date);
}

/** Trims float drift (`2.5000000001`) down to a sane two-decimal weight. */
export function roundWeight(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `2.5 lbs` — never `2.5000000001 lbs`. */
export function formatWeight(value: number): string {
  return `${WEIGHT_FORMATTER.format(roundWeight(value))} lbs`;
}

/** Bare weight number, for stat tiles that carry their own unit label. */
export function formatWeightValue(value: number): string {
  return WEIGHT_FORMATTER.format(roundWeight(value));
}

export function formatCount(value: number): string {
  return COUNT_FORMATTER.format(value);
}

/** `1 item` / `4 items`, so rows never read `1 items`. */
export function formatItems(value: number): string {
  return `${formatCount(value)} ${value === 1 ? 'item' : 'items'}`;
}

/**
 * Buckets entries by picking day, newest day first.
 *
 * The stored array is never assumed to be ordered. Within a day, the original
 * array order is preserved, so freshly logged entries (which are prepended)
 * surface at the top of their group.
 */
export function groupHarvestsByDay(harvests: HarvestLog[], today: Date = new Date()): HarvestDay[] {
  const byDate = new Map<string, HarvestLog[]>();

  for (const entry of harvests) {
    const bucket = byDate.get(entry.date);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDate.set(entry.date, [entry]);
    }
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, entries]) => ({
      date,
      label: formatDayLabel(date, today),
      entries,
      totalWeightLbs: roundWeight(
        entries.reduce((total, entry) => total + entry.weightLbs, 0),
      ),
      totalCount: entries.reduce((total, entry) => total + entry.count, 0),
    }));
}

/** Season totals, per-variety rollups and the heaviest single day. */
export function summarizeHarvests(harvests: HarvestLog[]): HarvestTotals {
  const varieties = new Map<string, VarietyTotal>();
  const dayWeights = new Map<string, number>();
  let totalWeightLbs = 0;
  let totalCount = 0;

  for (const entry of harvests) {
    totalWeightLbs += entry.weightLbs;
    totalCount += entry.count;

    const existing = varieties.get(entry.variety);
    if (existing) {
      existing.totalWeightLbs += entry.weightLbs;
      existing.totalCount += entry.count;
      existing.entryCount += 1;
    } else {
      varieties.set(entry.variety, {
        variety: entry.variety,
        totalWeightLbs: entry.weightLbs,
        totalCount: entry.count,
        entryCount: 1,
      });
    }

    dayWeights.set(entry.date, (dayWeights.get(entry.date) ?? 0) + entry.weightLbs);
  }

  const varietyTotals = [...varieties.values()]
    .map((total) => ({ ...total, totalWeightLbs: roundWeight(total.totalWeightLbs) }))
    .sort(
      (left, right) =>
        right.totalWeightLbs - left.totalWeightLbs ||
        right.totalCount - left.totalCount ||
        left.variety.localeCompare(right.variety),
    );

  return {
    totalWeightLbs: roundWeight(totalWeightLbs),
    totalCount,
    dayCount: dayWeights.size,
    varietyTotals,
    topVariety: varietyTotals[0] ?? null,
    bestDayWeightLbs: roundWeight(Math.max(0, ...dayWeights.values())),
  };
}

/**
 * Variety suggestions for the entry form: everything in the vault plus anything
 * already logged, deduplicated case-insensitively and alphabetised. Free-text
 * varieties stay possible because this only feeds a `<datalist>`.
 */
export function collectVarietyOptions(seeds: SeedPacket[], harvests: HarvestLog[]): string[] {
  const seen = new Map<string, string>();

  for (const value of [...seeds.map((seed) => seed.variety), ...harvests.map((entry) => entry.variety)]) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }

  return [...seen.values()].sort((left, right) => left.localeCompare(right));
}

/** Case-insensitive substring match on the variety name. */
export function filterHarvests(harvests: HarvestLog[], query: string): HarvestLog[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return harvests;

  return harvests.filter((entry) => entry.variety.toLowerCase().includes(needle));
}

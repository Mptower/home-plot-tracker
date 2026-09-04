/**
 * Germination estimates for the Seed Vault.
 *
 * Real viability depends on species and storage conditions, so this is a
 * deliberately simple, deterministic rule of thumb: packets start near the
 * printed germination rate and lose ground every year, slowly at first and then
 * faster once they are past their useful shelf life.
 */
import type { SeedPacket } from '../types';

export type GerminationStatus = 'fresh' | 'aging' | 'stale';

export interface GerminationEstimate {
  ageYears: number;
  ratePercent: number;
  status: GerminationStatus;
  label: string;
}

/** Assumed viability of a packet bought this season, before any storage losses. */
const BASE_RATE_PERCENT = 95;
/** Points of viability lost per year while a packet is still fresh or aging. */
const EARLY_DECLINE_PER_YEAR = 6;
/** Losses accelerate once a packet is past its useful shelf life. */
const LATE_DECLINE_PER_YEAR = 12;
/** Even an ancient packet keeps a few viable seeds, so the estimate never hits zero. */
const FLOOR_RATE_PERCENT = 5;

/** Packets this age or younger are `fresh`. */
export const FRESH_MAX_AGE_YEARS = 1;
/** Packets older than this are `stale` and need a replacement warning. */
export const AGING_MAX_AGE_YEARS = 3;

/**
 * Whole years between purchase and now. Future or nonsensical years clamp to 0
 * so a typo can never produce a negative age or a bogus germination rate.
 */
export function getSeedAge(purchaseYear: number, currentYear = new Date().getFullYear()): number {
  if (!Number.isFinite(purchaseYear) || !Number.isFinite(currentYear)) return 0;

  return Math.max(0, Math.trunc(currentYear) - Math.trunc(purchaseYear));
}

export function getGerminationStatus(ageYears: number): GerminationStatus {
  if (ageYears <= FRESH_MAX_AGE_YEARS) return 'fresh';
  if (ageYears <= AGING_MAX_AGE_YEARS) return 'aging';

  return 'stale';
}

/** Piecewise-linear decline: gentle through the shelf life, steeper after it. */
export function getGerminationRate(ageYears: number): number {
  const safeAge = Math.max(0, ageYears);
  const earlyYears = Math.min(safeAge, AGING_MAX_AGE_YEARS);
  const lateYears = Math.max(0, safeAge - AGING_MAX_AGE_YEARS);
  const rate =
    BASE_RATE_PERCENT - earlyYears * EARLY_DECLINE_PER_YEAR - lateYears * LATE_DECLINE_PER_YEAR;

  return Math.max(FLOOR_RATE_PERCENT, Math.round(rate));
}

export function formatSeedAge(ageYears: number): string {
  if (ageYears <= 0) return 'New this year';
  if (ageYears === 1) return '1 yr old';

  return `${ageYears} yrs old`;
}

const STATUS_ADVICE: Record<GerminationStatus, string> = {
  fresh: 'sow at the packet rate',
  aging: 'sow a little thicker than usual',
  stale: 'germination may be low, sow extra thickly',
};

export function getGerminationEstimate(
  packet: SeedPacket,
  currentYear?: number,
): GerminationEstimate {
  const ageYears = getSeedAge(packet.purchaseYear, currentYear);
  const status = getGerminationStatus(ageYears);

  return {
    ageYears,
    ratePercent: getGerminationRate(ageYears),
    status,
    label: `${formatSeedAge(ageYears)} — ${STATUS_ADVICE[status]}`,
  };
}

/**
 * Domain types shared by the browser client and the Node server.
 *
 * This package is the single source of truth for the shapes that travel over
 * the API. It is deliberately free of framework imports — no React, no Express —
 * so both sides can depend on it without dragging the other's runtime in.
 *
 * The React prop contracts (`SeedVaultViewProps` and friends) stay in
 * `client/src/types.ts` because they are a client concern.
 */

export interface SeedPacket {
  id: string;
  category: string;
  variety: string;
  brand: string;
  purchaseYear: number;
  notes: string;
}

export interface GardenBed {
  id: string;
  name: string;
  rows: number;
  columns: number;
  /** `rows` x `columns` grid where each cell holds a planted variety name or `null` when empty. */
  layout: (string | null)[][];
  /** Category grown in this bed last season, used for crop-rotation checks. */
  lastYearCategory: string;
}

export interface HarvestLog {
  id: string;
  /** ISO calendar date, `yyyy-mm-dd`. */
  date: string;
  variety: string;
  weightLbs: number;
  count: number;
}

export type ViewId = 'planner' | 'vault' | 'harvest';

/** Canonical category list backing every category dropdown in the app. */
export const SEED_CATEGORIES: readonly string[] = [
  'Nightshade',
  'Cucurbit',
  'Brassica',
  'Allium',
  'Legume',
  'Root',
  'Leafy Green',
  'Herb',
];

/** localStorage keys, namespaced under `hpt.` to avoid collisions. */
export const STORAGE_KEYS = {
  seeds: 'hpt.seeds',
  beds: 'hpt.beds',
  harvests: 'hpt.harvests',
} as const;

/** The three collections the API exposes. */
export const COLLECTION_NAMES = ['seeds', 'beds', 'harvests'] as const;

export type CollectionName = (typeof COLLECTION_NAMES)[number];

/** Everything the app persists, as one document. Shape of the import payload. */
export interface GardenSnapshot {
  seeds: SeedPacket[];
  beds: GardenBed[];
  harvests: HarvestLog[];
}

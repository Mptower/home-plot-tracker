/**
 * Shared domain types and prop contracts for The Home Plot Tracker.
 *
 * Every feature view consumes state that is owned by `App` and persisted through
 * `useLocalStorage`, so all mutations flow through the setters defined here.
 */
import type { Dispatch, SetStateAction } from 'react';

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

export interface SeedVaultViewProps {
  seeds: SeedPacket[];
  setSeeds: Dispatch<SetStateAction<SeedPacket[]>>;
}

export interface BedPlannerViewProps {
  beds: GardenBed[];
  setBeds: Dispatch<SetStateAction<GardenBed[]>>;
  seeds: SeedPacket[];
}

export interface HarvestLogViewProps {
  harvests: HarvestLog[];
  setHarvests: Dispatch<SetStateAction<HarvestLog[]>>;
  seeds: SeedPacket[];
}

export interface SidebarProps {
  activeView: ViewId;
  onChange: (view: ViewId) => void;
}

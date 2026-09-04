/**
 * Client-side type surface for The Home Plot Tracker.
 *
 * The domain shapes now live in `@hpt/shared` so the Node server validates and
 * stores exactly what the browser sends. They are re-exported here unchanged so
 * every view keeps importing from `../types` as before.
 *
 * What stays local to the client are the React prop contracts: state is owned by
 * `App` and passed down, so all mutations flow through the setters defined here.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { GardenBed, HarvestLog, SeedPacket, ViewId } from '@hpt/shared';
import type { GardenStatus } from './hooks/useGardenData';

export type {
  BedAtRisk,
  CollectionName,
  ForecastPrecision,
  FrostSeverity,
  FrostWatch,
  GardenBed,
  GardenSnapshot,
  HarvestLog,
  HomeAssistantBody,
  SeedPacket,
  Tenderness,
  ViewId,
} from '@hpt/shared';

export { COLLECTION_NAMES, SEED_CATEGORIES, STORAGE_KEYS } from '@hpt/shared';

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
  /** Live state of the connection to the garden server, shown in the footer. */
  status: GardenStatus;
  onRetry: () => void;
}

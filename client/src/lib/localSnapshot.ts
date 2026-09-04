/**
 * The garden that may already be sitting in this browser.
 *
 * Before the server existed, everything lived in `localStorage` under the keys
 * in `STORAGE_KEYS`. Someone has a real season's worth of records in there, so
 * the first run against an empty server offers to move them across.
 *
 * Two rules:
 *
 * 1. **Nothing is deleted.** The browser copy stays exactly where it is after a
 *    successful import. It costs a few kilobytes and it is the only fallback if
 *    the server is ever lost before its first backup.
 * 2. **Nothing is imported without being asked.** This reads and reports; the
 *    decision belongs to the user.
 */
import { STORAGE_KEYS } from '../types';
import type { GardenBed, GardenSnapshot, HarvestLog, SeedPacket } from '../types';

/** Records that the offer was accepted, so it is made exactly once. */
export const MIGRATION_KEY = 'hpt.serverImport';

export interface LocalGarden {
  snapshot: GardenSnapshot;
  counts: { seeds: number; beds: number; harvests: number };
  /** Records across all three collections; zero means there is nothing to offer. */
  total: number;
}

export interface MigrationRecord {
  at: string;
  counts: { seeds: number; beds: number; harvests: number };
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Storage can throw outright when cookies are blocked.
    return null;
  }
}

/** Parses one key, treating anything unreadable as simply absent. */
function readArray(key: string): unknown[] {
  const store = storage();
  if (!store) return [];

  try {
    const raw = store.getItem(key);
    if (raw === null) return [];

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * What this browser is holding, or `null` when there is nothing worth offering.
 *
 * The items are passed through untouched rather than coerced into shape. The
 * server validates every field and names what it rejects, and a silent repair
 * here would be a guess at what the user meant.
 */
export function readLocalGarden(): LocalGarden | null {
  const seeds = readArray(STORAGE_KEYS.seeds) as SeedPacket[];
  const beds = readArray(STORAGE_KEYS.beds) as GardenBed[];
  const harvests = readArray(STORAGE_KEYS.harvests) as HarvestLog[];

  const counts = { seeds: seeds.length, beds: beds.length, harvests: harvests.length };
  const total = counts.seeds + counts.beds + counts.harvests;

  if (total === 0) return null;

  return { snapshot: { seeds, beds, harvests }, counts, total };
}

/** Whether this browser's copy has already been handed to a server. */
export function readMigrationRecord(): MigrationRecord | null {
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(MIGRATION_KEY);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed === 'object' && parsed !== null && 'at' in parsed) {
      return parsed as MigrationRecord;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Marks the copy as migrated. Called only after the server has confirmed the
 * import, so a failure part-way through leaves the offer standing.
 */
export function recordMigration(counts: LocalGarden['counts']): void {
  const store = storage();
  if (!store) return;

  try {
    store.setItem(
      MIGRATION_KEY,
      JSON.stringify({ at: new Date().toISOString(), counts } satisfies MigrationRecord),
    );
  } catch {
    // A full or read-only store means the offer may be made again. Harmless:
    // the offer only ever appears against an empty server.
  }
}

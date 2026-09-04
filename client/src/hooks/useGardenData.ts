/**
 * The garden's state, backed by the API instead of `localStorage`.
 *
 * This is the whole of phase 3's storage layer. It keeps the `(data, setData)`
 * contract the views already have — `setSeeds` is still a plain
 * `Dispatch<SetStateAction<SeedPacket[]>>` — so no view component knows a
 * network appeared underneath it.
 *
 * What the network forces this layer to deal with:
 *
 * - **Latency.** Every edit lands in local state immediately and is written
 *   behind the user's back. The UI never waits for a round trip.
 * - **Failure.** A failed save keeps the edit. The value stays on screen, stays
 *   queued, and retries on the next edit, on reconnect, or when she asks. The
 *   one thing that must never happen is a harvest entry disappearing because
 *   the wifi dropped between the shed and the house.
 * - **Other devices.** Collections are versioned; a write declares the version
 *   it was based on and the server answers `409` rather than letting a stale
 *   phone tab erase what the laptop just saved. A 409 is routine here: it
 *   triggers an item-level three-way merge and a retry, and only genuinely
 *   divergent items — the same record edited differently in both places — are
 *   put to the user.
 * - **Ordering.** Writes for one collection are serialised. Rapid edits
 *   collapse: whatever is current when the previous request finishes is what
 *   gets sent, so twenty clicks are not twenty queued requests.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ApiError, fetchCollection, importGarden, saveCollection } from '../lib/apiClient';
import type { ImportOutcome, Versioned } from '../lib/apiClient';
import { deepEqual, mergeCollections } from '../lib/merge';
import type { Identified, MergeConflict, MergeSide } from '../lib/merge';
import type {
  CollectionName,
  GardenBed,
  GardenSnapshot,
  HarvestLog,
  SeedPacket,
} from '../types';

/**
 * A save retries after a merge, and each retry can find a newer version again.
 * Six rounds is far past anything two people in one house can produce, and puts
 * a floor under a pathological loop.
 */
const MAX_SAVE_ATTEMPTS = 6;

export type LoadPhase = 'loading' | 'ready' | 'failed';

export interface CollectionStatus {
  phase: LoadPhase;
  loadError: ApiError | null;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  saveError: ApiError | null;
  conflicts: MergeConflict[];
  lastSavedAt: number | null;
}

const INITIAL_STATUS: CollectionStatus = {
  phase: 'loading',
  loadError: null,
  isSaving: false,
  hasUnsavedChanges: false,
  saveError: null,
  conflicts: [],
  lastSavedAt: null,
};

/** A conflict, tagged with the collection it came from, for the UI. */
export interface DeviceConflict extends MergeConflict {
  collection: CollectionName;
  /** What each choice does, phrased for a person rather than for a merge tool. */
  keepMineLabel: string;
  keepTheirsLabel: string;
  explanation: string;
}

interface CollectionSync<T extends Identified> {
  items: T[];
  setItems: Dispatch<SetStateAction<T[]>>;
  status: CollectionStatus;
  reload: () => Promise<void>;
  retrySave: () => void;
  resolve: (id: string, side: MergeSide) => void;
  resolveAll: (side: MergeSide) => void;
  /** Adds a set of records to whatever the server already holds. */
  mergeIn: (incoming: T[], remote?: Versioned<T> | null) => void;
  refreshIfIdle: () => Promise<void>;
}

interface PendingConflict<T> {
  /** The collection as it was when this device last agreed with the server. */
  base: T[];
  remote: Versioned<T>;
  resolutions: Record<string, MergeSide>;
}

function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  return new ApiError('Something went wrong while saving.', { kind: 'server', cause: error });
}

function useCollectionSync<T extends Identified>(
  collection: CollectionName,
  describe: (item: T) => string,
): CollectionSync<T> {
  const [items, setItemsState] = useState<T[]>([]);
  const [status, setStatus] = useState<CollectionStatus>(INITIAL_STATUS);

  const alive = useRef(true);
  /** What this device wants stored. The source of truth for functional updates. */
  const desired = useRef<T[]>([]);
  /** What the server last confirmed. The base of every three-way merge. */
  const base = useRef<T[]>([]);
  const version = useRef<string | null>(null);
  /** Bumped by every local edit; compared to say whether anything is unsaved. */
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const inFlight = useRef(false);
  const ready = useRef(false);
  const pendingConflict = useRef<PendingConflict<T> | null>(null);

  const patch = useCallback((next: Partial<CollectionStatus>) => {
    setStatus((previous) => ({ ...previous, ...next }));
  }, []);

  const load = useCallback(async () => {
    patch({ phase: 'loading', loadError: null });

    try {
      const result = await fetchCollection<T>(collection);
      if (!alive.current) return;

      desired.current = result.items;
      base.current = result.items;
      version.current = result.version;
      revision.current = 0;
      savedRevision.current = 0;
      pendingConflict.current = null;
      ready.current = true;

      setItemsState(result.items);
      patch({
        phase: 'ready',
        loadError: null,
        saveError: null,
        hasUnsavedChanges: false,
        conflicts: [],
      });
    } catch (error) {
      if (!alive.current) return;

      ready.current = false;
      patch({ phase: 'failed', loadError: asApiError(error) });
    }
  }, [collection, patch]);

  /**
   * The server's current state after a rejected precondition. The response
   * carries it, so this is normally free; the fetch is the fallback for a
   * server that answered without a body.
   */
  const currentRemote = useCallback(
    async (error: ApiError): Promise<Versioned<T>> => {
      if (error.remote) {
        // The endpoint we asked only ever returns this collection's items.
        return { items: error.remote.items as T[], version: error.remote.version };
      }

      return fetchCollection<T>(collection);
    },
    [collection],
  );

  const flush = useCallback(async () => {
    if (!ready.current || inFlight.current || pendingConflict.current) return;
    if (savedRevision.current === revision.current) return;

    inFlight.current = true;
    patch({ isSaving: true });

    try {
      let attempts = 0;

      while (savedRevision.current !== revision.current) {
        attempts += 1;

        if (attempts > MAX_SAVE_ATTEMPTS) {
          throw new ApiError('Your garden is being changed somewhere else faster than this device can keep up.', {
            kind: 'stale',
          });
        }

        // Snapshot the revision *before* the request: anything typed while it is
        // in flight bumps it again, which is how the loop knows to go round.
        const attempted = revision.current;
        const payload = desired.current;

        try {
          const stored = await saveCollection<T>(collection, payload, version.current);
          if (!alive.current) return;

          savedRevision.current = attempted;
          version.current = stored.version;
          base.current = stored.items;

          const settled = revision.current === attempted;

          // Reconcile with what was actually stored, but only when nothing newer
          // is waiting — otherwise the newer value is the one that matters and
          // the next lap will save it.
          if (settled && !deepEqual(desired.current, stored.items)) {
            desired.current = stored.items;
            setItemsState(stored.items);
          }

          patch({ saveError: null, lastSavedAt: Date.now(), hasUnsavedChanges: !settled });
        } catch (error) {
          if (!(error instanceof ApiError) || error.kind !== 'stale') throw error;

          const remote = await currentRemote(error);
          if (!alive.current) return;

          const outcome = mergeCollections(base.current, desired.current, remote.items, {
            describe,
          });

          if (!outcome.ok) {
            // Stop writing and ask. `base` stays where it is so the merge can be
            // recomputed as each answer arrives.
            pendingConflict.current = { base: base.current, remote, resolutions: {} };
            patch({ conflicts: outcome.conflicts });
            return;
          }

          base.current = remote.items;
          version.current = remote.version;
          desired.current = outcome.merged;
          revision.current += 1;
          setItemsState(outcome.merged);
        }
      }
    } catch (error) {
      if (alive.current) patch({ saveError: asApiError(error) });
    } finally {
      inFlight.current = false;
      if (alive.current) patch({ isSaving: false });
    }
  }, [collection, currentRemote, describe, patch]);

  const setItems = useCallback<Dispatch<SetStateAction<T[]>>>(
    (update) => {
      const next =
        typeof update === 'function' ? (update as (previous: T[]) => T[])(desired.current) : update;

      desired.current = next;
      revision.current += 1;
      setItemsState(next);
      patch({ hasUnsavedChanges: true });

      void flush();
    },
    [flush, patch],
  );

  const applyResolutions = useCallback(
    (resolutions: Record<string, MergeSide>) => {
      const pending = pendingConflict.current;
      if (!pending) return;

      const outcome = mergeCollections(pending.base, desired.current, pending.remote.items, {
        describe,
        resolutions,
      });

      if (!outcome.ok) {
        // Some items are still unanswered; keep the ones already settled.
        pendingConflict.current = { ...pending, resolutions };
        patch({ conflicts: outcome.conflicts });
        return;
      }

      pendingConflict.current = null;
      base.current = pending.remote.items;
      version.current = pending.remote.version;
      desired.current = outcome.merged;
      revision.current += 1;

      setItemsState(outcome.merged);
      patch({ conflicts: [], hasUnsavedChanges: true });

      void flush();
    },
    [describe, flush, patch],
  );

  const resolve = useCallback(
    (id: string, side: MergeSide) => {
      const pending = pendingConflict.current;
      if (!pending) return;

      applyResolutions({ ...pending.resolutions, [id]: side });
    },
    [applyResolutions],
  );

  const resolveAll = useCallback(
    (side: MergeSide) => {
      const pending = pendingConflict.current;
      if (!pending) return;

      const resolutions = { ...pending.resolutions };
      for (const conflict of mergeConflictIds(pending, desired.current, describe)) {
        resolutions[conflict] = side;
      }

      applyResolutions(resolutions);
    },
    [applyResolutions, describe],
  );

  const retrySave = useCallback(() => {
    patch({ saveError: null });
    void flush();
  }, [flush, patch]);

  /**
   * Folds a set of records into whatever the server already holds.
   *
   * `remote` is the server state a caller already has in hand — the
   * `import_not_empty` body carries all three collections — which saves a read
   * and, more importantly, supplies the version the write must declare. It is
   * adopted only while this collection is idle; if this device has an edit of
   * its own in play, the ordinary save path reconciles it properly instead.
   */
  const mergeIn = useCallback(
    (incoming: T[], remote?: Versioned<T> | null) => {
      const idle =
        ready.current &&
        !inFlight.current &&
        !pendingConflict.current &&
        savedRevision.current === revision.current;

      if (remote && idle) {
        base.current = remote.items;
        version.current = remote.version;
        desired.current = remote.items;
      }

      // No common ancestor, so everything on both sides counts as an addition
      // and the union survives. An id that somehow exists on both keeps the
      // server's copy: it is the one another device is already looking at.
      const outcome = mergeCollections([], incoming, desired.current, {
        describe,
        prefer: 'theirs',
      });

      if (outcome.ok) setItems(outcome.merged);
    },
    [describe, setItems],
  );

  /**
   * Picks up changes made elsewhere. Skipped whenever this device has anything
   * of its own in play — an unsaved edit reconciles through the save path,
   * which merges rather than overwrites.
   */
  const refreshIfIdle = useCallback(async () => {
    if (!ready.current || inFlight.current || pendingConflict.current) return;
    if (savedRevision.current !== revision.current) return;

    try {
      const result = await fetchCollection<T>(collection);
      if (!alive.current) return;
      // Bail out if an edit started while the read was in flight.
      if (inFlight.current || pendingConflict.current) return;
      if (savedRevision.current !== revision.current) return;

      version.current = result.version;
      base.current = result.items;

      if (!deepEqual(desired.current, result.items)) {
        desired.current = result.items;
        setItemsState(result.items);
      }
    } catch {
      // A background refresh that fails changes nothing on screen.
    }
  }, [collection]);

  useEffect(() => {
    alive.current = true;
    void load();

    return () => {
      alive.current = false;
    };
  }, [load]);

  return {
    items,
    setItems,
    status,
    reload: load,
    retrySave,
    resolve,
    resolveAll,
    mergeIn,
    refreshIfIdle,
  };
}

/** Ids still awaiting an answer, recomputed from the stored conflict. */
function mergeConflictIds<T extends Identified>(
  pending: PendingConflict<T>,
  mine: readonly T[],
  describe: (item: T) => string,
): string[] {
  const outcome = mergeCollections(pending.base, mine, pending.remote.items, {
    describe,
    resolutions: pending.resolutions,
  });

  return outcome.ok ? [] : outcome.conflicts.map((conflict) => conflict.id);
}

const describeSeed = (seed: SeedPacket): string => seed.variety || 'a seed packet';
const describeBed = (bed: GardenBed): string => bed.name || 'a bed';
const describeHarvest = (harvest: HarvestLog): string =>
  `${harvest.variety || 'a harvest'} on ${harvest.date}`;

const COLLECTION_LABELS: Record<CollectionName, string> = {
  seeds: 'seed packet',
  beds: 'bed',
  harvests: 'harvest entry',
};

/** Turns a merge conflict into the two plain-English choices the user sees. */
function describeConflict(collection: CollectionName, conflict: MergeConflict): DeviceConflict {
  const noun = COLLECTION_LABELS[collection];

  switch (conflict.reason) {
    case 'edited-here-deleted-there':
      return {
        ...conflict,
        collection,
        explanation: `You changed this ${noun} here, and it was removed on another device.`,
        keepMineLabel: 'Keep it',
        keepTheirsLabel: 'Remove it',
      };
    case 'deleted-here-edited-there':
      return {
        ...conflict,
        collection,
        explanation: `You removed this ${noun} here, and it was changed on another device.`,
        keepMineLabel: 'Remove it',
        keepTheirsLabel: 'Keep it',
      };
    default:
      return {
        ...conflict,
        collection,
        explanation: `This ${noun} was changed here and on another device.`,
        keepMineLabel: "Keep this device's",
        keepTheirsLabel: "Keep the other device's",
      };
  }
}

export interface GardenStatus {
  phase: LoadPhase;
  loadError: ApiError | null;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  saveError: ApiError | null;
  lastSavedAt: number | null;
  isOnline: boolean;
  conflicts: DeviceConflict[];
}

export interface GardenData {
  seeds: SeedPacket[];
  setSeeds: Dispatch<SetStateAction<SeedPacket[]>>;
  beds: GardenBed[];
  setBeds: Dispatch<SetStateAction<GardenBed[]>>;
  harvests: HarvestLog[];
  setHarvests: Dispatch<SetStateAction<HarvestLog[]>>;
  status: GardenStatus;
  /** True once everything has loaded and the server holds nothing at all. */
  isEmpty: boolean;
  reload: () => void;
  retrySave: () => void;
  resolveConflict: (collection: CollectionName, id: string, side: MergeSide) => void;
  resolveAllConflicts: (side: MergeSide) => void;
  /** Hands a whole garden to an empty server. */
  importGarden: (snapshot: GardenSnapshot) => Promise<ImportOutcome>;
  /**
   * Adds a garden to one that already has records in it. `remote` is the server
   * state the caller already holds, which the `import_not_empty` response
   * supplies in full — passing it makes the follow-up writes correctly
   * versioned without another read.
   */
  mergeGarden: (snapshot: GardenSnapshot, remote?: GardenRemote | null) => void;
}

/** Every collection's current state, as an `import_not_empty` body carries it. */
export type GardenRemote = Record<CollectionName, Versioned<unknown>>;

export function useGardenData(): GardenData {
  const seeds = useCollectionSync<SeedPacket>('seeds', describeSeed);
  const beds = useCollectionSync<GardenBed>('beds', describeBed);
  const harvests = useCollectionSync<HarvestLog>('harvests', describeHarvest);

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  const reload = useCallback(() => {
    void seeds.reload();
    void beds.reload();
    void harvests.reload();
  }, [beds, harvests, seeds]);

  const retrySave = useCallback(() => {
    seeds.retrySave();
    beds.retrySave();
    harvests.retrySave();
  }, [beds, harvests, seeds]);

  const refreshAll = useCallback(() => {
    void seeds.refreshIfIdle();
    void beds.refreshIfIdle();
    void harvests.refreshIfIdle();
  }, [beds, harvests, seeds]);

  // Coming back online, or back to the tab, are both good moments to catch up:
  // one retries what could not be sent, the other picks up the phone's edits.
  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      retrySave();
      refreshAll();
    }

    function handleOffline() {
      setIsOnline(false);
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') refreshAll();
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshAll, retrySave]);

  const resolveConflict = useCallback(
    (collection: CollectionName, id: string, side: MergeSide) => {
      if (collection === 'seeds') seeds.resolve(id, side);
      if (collection === 'beds') beds.resolve(id, side);
      if (collection === 'harvests') harvests.resolve(id, side);
    },
    [beds, harvests, seeds],
  );

  const resolveAllConflicts = useCallback(
    (side: MergeSide) => {
      seeds.resolveAll(side);
      beds.resolveAll(side);
      harvests.resolveAll(side);
    },
    [beds, harvests, seeds],
  );

  const importSnapshot = useCallback(
    async (snapshot: GardenSnapshot): Promise<ImportOutcome> => {
      const outcome = await importGarden(snapshot);

      if (outcome.status === 'imported') {
        await Promise.all([seeds.reload(), beds.reload(), harvests.reload()]);
      }

      return outcome;
    },
    [beds, harvests, seeds],
  );

  const mergeGarden = useCallback(
    (snapshot: GardenSnapshot, remote?: GardenRemote | null) => {
      seeds.mergeIn(snapshot.seeds, (remote?.seeds as Versioned<SeedPacket>) ?? null);
      beds.mergeIn(snapshot.beds, (remote?.beds as Versioned<GardenBed>) ?? null);
      harvests.mergeIn(snapshot.harvests, (remote?.harvests as Versioned<HarvestLog>) ?? null);
    },
    [beds, harvests, seeds],
  );

  const status = useMemo<GardenStatus>(() => {
    const parts: [CollectionName, CollectionStatus][] = [
      ['seeds', seeds.status],
      ['beds', beds.status],
      ['harvests', harvests.status],
    ];

    const phase: LoadPhase = parts.some(([, part]) => part.phase === 'loading')
      ? 'loading'
      : parts.some(([, part]) => part.phase === 'failed')
        ? 'failed'
        : 'ready';

    const lastSavedAt = parts.reduce<number | null>(
      (latest, [, part]) =>
        part.lastSavedAt !== null && (latest === null || part.lastSavedAt > latest)
          ? part.lastSavedAt
          : latest,
      null,
    );

    return {
      phase,
      loadError: parts.find(([, part]) => part.loadError)?.[1].loadError ?? null,
      isSaving: parts.some(([, part]) => part.isSaving),
      hasUnsavedChanges: parts.some(([, part]) => part.hasUnsavedChanges),
      saveError: parts.find(([, part]) => part.saveError)?.[1].saveError ?? null,
      lastSavedAt,
      isOnline,
      conflicts: parts.flatMap(([name, part]) =>
        part.conflicts.map((conflict) => describeConflict(name, conflict)),
      ),
    };
  }, [beds.status, harvests.status, isOnline, seeds.status]);

  return {
    seeds: seeds.items,
    setSeeds: seeds.setItems,
    beds: beds.items,
    setBeds: beds.setItems,
    harvests: harvests.items,
    setHarvests: harvests.setItems,
    status,
    isEmpty:
      status.phase === 'ready' &&
      seeds.items.length === 0 &&
      beds.items.length === 0 &&
      harvests.items.length === 0,
    reload,
    retrySave,
    resolveConflict,
    resolveAllConflicts,
    importGarden: importSnapshot,
    mergeGarden,
  };
}

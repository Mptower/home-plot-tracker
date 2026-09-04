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

/**
 * Optimistic concurrency.
 *
 * Two devices edit the same garden: a phone in the beds and a laptop indoors.
 * Because a write replaces a whole collection, a stale tab saving over a newer
 * one would silently erase the newer records — the exact data loss this server
 * exists to prevent. So every collection carries a version, `GET` hands it back
 * as an `ETag`, and `PUT` must declare the version it is editing from.
 *
 * Success responses are unchanged: `GET` and `PUT` still return a bare array,
 * and `PUT` still accepts one. The version travels in headers only, so the
 * `(data, setData)` prop contract the views are built against survives intact.
 */

/**
 * An opaque version token, e.g. `"3"` — quoted, because it is an HTTP entity
 * tag. Clients must treat it as an opaque string: echo it back in `If-Match`,
 * compare it for equality, never parse it. The server happens to back it with a
 * monotonic counter, but that is an implementation detail and not a promise.
 */
export type VersionToken = string;

/** Header a client sends to declare the version it is editing from. */
export const IF_MATCH_HEADER = 'If-Match';

/** Header carrying the current version of a collection. */
export const ETAG_HEADER = 'ETag';

/**
 * Machine-readable discriminator in the `error` field of a concurrency failure.
 * The human-facing text is in `message`; never match on it.
 */
export type ConcurrencyErrorCode =
  /** `409` — the collection changed since the client read it. */
  | 'version_mismatch'
  /** `428` — the write carried no usable `If-Match`, so it was refused. */
  | 'precondition_required'
  /** `409` on import — the garden already holds data. */
  | 'import_not_empty';

/**
 * Body of a `409` or `428` on a collection write.
 *
 * It carries the full current collection as well as the version, so a client can
 * reconcile and retry in a single round trip rather than refetching first. The
 * `ETag` response header is set to `currentVersion` on these responses too, so
 * either source works.
 */
export interface VersionConflictBody<T = unknown> {
  error: 'version_mismatch' | 'precondition_required';
  /** Human-readable explanation. For display and logs, not for branching. */
  message: string;
  /** Current version. Send this back verbatim in `If-Match` to retry. */
  currentVersion: VersionToken;
  /** The full current collection, saving the client a refetch. */
  current: T[];
  /** Which collection this concerns. Additive; `error` remains the discriminator. */
  collection: CollectionName;
  /** The version the client declared, when it sent one. Absent on `428`. */
  expectedVersion?: VersionToken;
}

/**
 * Body of a `409` from `POST /api/import` when the garden is not empty.
 *
 * Import spans all three collections at once, so the single-collection fields
 * generalise to per-collection maps.
 */
export interface ImportConflictBody {
  error: 'import_not_empty';
  message: string;
  currentVersion: Record<CollectionName, VersionToken>;
  current: GardenSnapshot;
  /** The collections that already hold rows — the reason the import was refused. */
  nonEmpty: CollectionName[];
}

/** Response from a successful `POST /api/import`. */
export interface ImportResultBody {
  mode: 'replace';
  message: string;
  imported: Record<CollectionName, number>;
  /** Versions after the import, so the client can write again without a GET. */
  versions: Record<CollectionName, VersionToken>;
}

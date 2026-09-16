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

export type ViewId = 'planner' | 'vault' | 'harvest' | 'settings';

/**
 * The preferences she can change from inside the app.
 *
 * These three used to be add-on options, editable only from
 * **Settings → Add-ons → Configuration** — an admin area she should never have
 * to visit to decide whether her phone buzzes at 3am. They now live in the
 * app's own database, and the add-on's `options:` no longer carries them at
 * all. One source of truth per setting: two settings pages that disagree, where
 * one silently wins, is the outcome this shape exists to prevent.
 *
 * What did *not* move is the entity plumbing — `weather_entity`,
 * `notify_service` and `sensor_prefix` are still add-on options, because they
 * are set once when the add-on is installed and are not decisions a gardener
 * makes.
 */
export interface GardenSettings {
  /** Whether a frost warning reaches her phone. The banner and the sensors are unaffected. */
  frostNotifications: boolean;
  /**
   * `HH:MM`, 24-hour, in her local wall-clock time.
   *
   * Equal start and end switches quiet hours off entirely rather than silencing
   * the whole day — see `inQuietHours` in `server/src/ha/notifier.ts`.
   */
  quietHoursStart: string;
  quietHoursEnd: string;
}

/**
 * Canonical category list backing every category dropdown in the app.
 *
 * These are **crop families**, not supermarket aisles, because the crop-rotation
 * warning depends on them being families — families are what share soil-borne
 * disease and pests. It is also why melons are `Cucurbit` rather than `Fruit`,
 * and why a ground cherry is a `Nightshade`.
 *
 * Each entry is additionally chosen so that every plant in it takes a frost the
 * same way, which is what lets `CATEGORY_TENDERNESS` in
 * `server/src/ha/tenderness.ts` stay one value per family. `Fruit` holds only
 * hardy perennial fruit for exactly that reason: a category containing both a
 * strawberry and a watermelon could not have a single honest answer.
 *
 * Adding one here has three obligations, and the build will catch you on the
 * first: `CATEGORY_TENDERNESS`, `client/src/lib/categoryTheme.ts`, and
 * `shared/src/plants.ts` so the catalogue can actually assign it.
 */
export const SEED_CATEGORIES: readonly string[] = [
  'Nightshade',
  'Cucurbit',
  'Brassica',
  'Allium',
  'Legume',
  'Root',
  'Leafy Green',
  'Herb',
  'Fruit',
  'Flower',
  'Other',
];

/** localStorage keys, namespaced under `hpt.` to avoid collisions. */
export const STORAGE_KEYS = {
  seeds: 'hpt.seeds',
  beds: 'hpt.beds',
  harvests: 'hpt.harvests',
  /**
   * Which category corrections she has waved away.
   *
   * Unlike the three above this is a preference, not a record: it holds no
   * garden data, it is never synced to the server, and losing it costs her
   * nothing worse than being offered a correction she has already declined.
   * Per-device on purpose — dismissing a nudge on her phone is not a statement
   * about what the tablet in the shed should show.
   */
  dismissedCategoryFixes: 'hpt.dismissedCategoryFixes',
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

/**
 * Backup and restore.
 *
 * Her whole garden lives in one SQLite file inside an add-on `/data` directory
 * that Supervisor deletes on uninstall, with no confirmation step. These shapes
 * are how she gets a copy out of it and back in without needing anybody else.
 *
 * The two constants that describe the file — its `format` string and the highest
 * `formatVersion` this build understands — are exported from here as runtime
 * values, so the server, the browser and the file itself cannot disagree about
 * what a backup is called.
 *
 * They were briefly duplicated on each side of the fence instead, guarded by a
 * parity test, because `server/src` could not take a runtime value from this
 * package. That is no longer true: the add-on image now stages `@hpt/shared`
 * and links it as a `file:` dependency, and `server/test/shared-imports.test.ts`
 * is what keeps that staging honest. One definition is better than two that
 * happen to match on the day they are written.
 */

/** Identifies a file as ours, so a wrong file can be refused by name. */
export const BACKUP_FORMAT = 'home-plot-tracker.garden';

/**
 * The highest file format this build understands.
 *
 * Bump only when an older build would **misread** a newer file. Adding another
 * optional field is not that: unknown top-level keys are tolerated on the way
 * in, precisely so a future version can add one without stranding a file in an
 * older install that could otherwise have restored it.
 */
export const BACKUP_FORMAT_VERSION = 1;

/**
 * One exported garden, as a file.
 *
 * Written pretty-printed, because a backup format you cannot eyeball is a
 * backup format you cannot trust. Everything except the three collections is
 * optional, which is not laxity — it is what makes a bare
 * `{ seeds, beds, harvests }` snapshot, the shape the maintainer's
 * `export-garden.mjs` has been writing before every rollout, a valid file that
 * restores with no conversion. The collections stay required because an omitted
 * key must never be indistinguishable from "wipe this collection".
 */
export interface GardenBackupDocument {
  /** Always `home-plot-tracker.garden`. Absent in a bare snapshot. */
  format?: string;
  /**
   * Version of the **file format**, bumped only when an older build could
   * misread a newer file.
   *
   * Named `formatVersion` rather than `schemaVersion` because `/api/health`
   * already reports a `schemaVersion` and means something entirely different by
   * it — the SQLite migration number. Two unrelated integers under one name,
   * both visible while somebody is debugging her install, is a support
   * conversation that goes wrong.
   */
  formatVersion?: number;
  /** ISO 8601. Absent in a bare snapshot, and never invented for one. */
  exportedAt?: string;
  /**
   * A human-facing summary, so opening the file in Notepad answers "what is in
   * here?" without counting. **Advisory only** — a restore recomputes from the
   * arrays and never trusts this.
   */
  counts?: Record<CollectionName, number>;
  seeds: SeedPacket[];
  beds: GardenBed[];
  harvests: HarvestLog[];
  /**
   * Her notification preferences. Safe to include: two `HH:MM` strings and a
   * boolean, no credentials of any kind. Absent means a restore leaves whatever
   * is already configured alone.
   */
  settings?: GardenSettings;
}

/** A stored copy of the garden as it was immediately before a restore. */
export interface SafetyCopySummary {
  id: number;
  takenAt: string;
  /** Why it was taken. `pre-restore` is the only reason today. */
  reason: string;
  counts: Record<CollectionName, number>;
}

/**
 * Response from a successful `POST /api/restore`.
 *
 * `restored` is counted out of the database **after the transaction committed**,
 * never echoed from the file that was parsed. Repeating what you were handed
 * proves nothing, and a restore that silently half-worked looks exactly like one
 * that worked — right up until she goes looking for a harvest that is not there.
 */
export interface RestoreResultBody {
  mode: 'replace';
  message: string;
  /** What is actually in the garden now, read back per collection. */
  restored: Record<CollectionName, number>;
  /** What was there before, from the safety copy taken on the way past. */
  replaced: Record<CollectionName, number>;
  /** Whether the file carried settings and they were applied. */
  settingsRestored: boolean;
  /** Versions after the restore, so a client can write again without a GET. */
  versions: Record<CollectionName, VersionToken>;
  /** The undo. Always present: a restore never runs without taking one. */
  safetyCopy: SafetyCopySummary;
}

/** Answers `GET /api/backup/status`, for the Settings panel. */
export interface BackupStatusBody {
  /**
   * When a copy was last successfully downloaded, or `null` if never.
   *
   * Recorded on the server rather than per browser: a per-device memory would
   * tell her laptop "never" after she saved a copy from her phone.
   */
  lastExportAt: string | null;
  /** What is in the garden right now, so the panel can say what a copy contains. */
  counts: Record<CollectionName, number>;
  /** Newest first. */
  safetyCopies: SafetyCopySummary[];
}

/**
 * Home Assistant.
 *
 * The app is deployed as an HA add-on, so it can read her weather forecast, warn
 * about frost against what is actually planted, publish harvest totals back as
 * sensors and notify her phone. None of that may become load-bearing: the app
 * has to run identically with no Home Assistant at all, which is how it is
 * developed and how the tests run.
 *
 * What is shared is the *shape* of the answer, plus the crop-family tenderness
 * map below. The bands, the forecast reading and the assessment itself are
 * server-side, along with everything that talks to Supervisor, because
 * `SUPERVISOR_TOKEN` must never reach the browser.
 */
export type {
  BedAtRisk,
  ForecastPrecision,
  FrostSeverity,
  FrostWatch,
  HomeAssistantBody,
  HomeAssistantUnavailableReason,
  IntegrationStatusBody,
  Tenderness,
} from './homeAssistant.js';

/**
 * The plant catalogue, so nobody has to know botanical families to file a seed
 * packet.
 *
 * Unlike the types above this line these are runtime values, and both the
 * client and the server import them: the picker uses them to suggest a plant,
 * and the frost engine uses them to work out what a bed square is when there is
 * no seed packet to ask. That is only safe because the add-on image ships this
 * package — see the header of `plants.ts`.
 */
export type { PlantCatalogueEntry, PlantMatch, PlantMatchConfidence } from './plants.js';
export {
  PLANT_CATALOGUE,
  categoryForVariety,
  matchPlant,
  normalizePlantName,
  plantLookupKeys,
  searchPlants,
} from './plants.js';

/**
 * Cold tolerance per crop family.
 *
 * The single copy. The frost warnings come from here by way of
 * `server/src/ha/tenderness.ts`, which re-exports it, and the seed vault uses
 * it to explain *why* a miscategorised packet matters — that this one is filed
 * as something the frost engine would otherwise treat as hardy. There is no
 * second copy to drift.
 *
 * `moreTender` is the ordering over those answers, and lives beside the map for
 * the same reason: one map, one direction of travel.
 */
export {
  CATEGORY_TENDERNESS,
  isKnownTendernessCategory,
  moreTender,
  tendernessOf,
} from './tenderness.js';

/**
 * The words a frost warning is made of.
 *
 * Also the single copy, and for the same reason. Her phone and the banner at
 * the top of the app describe the same cold night, and they had drifted into
 * two voices — the phone saying "Cover your Cherry Tomato in Tomato bed" while
 * the app said "Your Cherry Tomato in Tomato bed are tender". Both now compose
 * from here, so the next wording change lands on both at once.
 *
 * Runtime values, imported by both sides, which is only safe because the add-on
 * image ships this package — see the header of `plants.ts`.
 *
 * `ColdestHour` and `coldestHour` are exported alongside them because the hour
 * is the one argument a caller supplies itself, and the one a caller got wrong:
 * it must be a bare `5am`, never the clause `frostSentences` builds out of it.
 */
export type { ColdestHour, FrostSentences, FrostVoiceOptions } from './frostVoice.js';
export {
  coldestHour,
  frostHeadline,
  frostSentences,
  isColdestHour,
  joinNames,
} from './frostVoice.js';

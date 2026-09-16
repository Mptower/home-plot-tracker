/**
 * The backup document: what an export writes, and how it is written.
 *
 * Two jobs. `buildDocument` reads the whole garden into one object, and
 * `prettyJson` renders it in a shape a person can actually read in Notepad.
 *
 * ## Why this file renders its own JSON
 *
 * `res.json` emits one compact line. For a machine that is fine; for a backup it
 * is not. A backup format you cannot eyeball is a backup format you cannot
 * trust, and "is my garden in this file?" has to be answerable by opening it.
 *
 * But plain `JSON.stringify(doc, null, 2)` overcorrects: a bed's layout is an
 * array of arrays of nulls and variety names, and at two-space indent a 12x12
 * bed becomes 144 lines reading `null,`. The grid — the thing a human wants to
 * see — is destroyed by the formatting meant to reveal it.
 *
 * So the rule here is one sentence: **an array whose elements are all scalars is
 * written on one line; everything else is indented.** A bed layout comes out as
 * one line per row, which looks like the bed. Records come out as indented
 * blocks. Nothing else changes.
 *
 * Every scalar is still rendered by `JSON.stringify`, so escaping — quotes,
 * newlines, control characters, lone surrogates — is the platform's problem and
 * not this file's. `backup-export.test.ts` proves the round trip over exactly
 * those cases.
 *
 * This also matters for a reason beyond eyeballing: if a browser refuses to
 * download the file, the fallback is copy-and-paste out of a textarea, and that
 * only survives if what is on screen is valid JSON.
 */
import type { CollectionName, GardenBackupDocument } from '@hpt/shared';
import type { Database } from '../db/open.ts';
import { withTransaction } from '../db/open.ts';
import { listBeds, listHarvests, listSeeds } from '../db/collections.ts';
import { readSettings } from '../db/settings.ts';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from './format.ts';

export { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, PRE_RESTORE } from './format.ts';

type Scalar = string | number | boolean | null;

function isScalar(value: unknown): value is Scalar {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/**
 * A scalar exactly as `JSON.stringify` would write it.
 *
 * `undefined` becomes `null`, which is what `JSON.stringify` does inside an
 * array. Non-finite numbers become `null` for the same reason. Neither occurs in
 * a validated garden; both are handled so this cannot diverge from the parser
 * that has to read it back.
 */
function scalar(value: unknown): string {
  return JSON.stringify(value ?? null) ?? 'null';
}

function render(value: unknown, indent: string): string {
  if (value === undefined || isScalar(value)) return scalar(value);

  const next = `${indent}  `;

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';

    // The whole point: a bed's row of varieties and nulls stays one line.
    if (value.every((entry) => entry === undefined || isScalar(entry))) {
      return `[${value.map(scalar).join(', ')}]`;
    }

    const entries = value.map((entry) => `${next}${render(entry, next)}`);

    return `[\n${entries.join(',\n')}\n${indent}]`;
  }

  // `JSON.stringify` drops object keys whose value is `undefined`; so does this.
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, entry]) => entry !== undefined,
  );

  if (entries.length === 0) return '{}';

  const lines = entries.map(
    ([key, entry]) => `${next}${JSON.stringify(key)}: ${render(entry, next)}`,
  );

  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/** The document as a file: pretty-printed, with a trailing newline. */
export function prettyJson(value: unknown): string {
  return `${render(value, '')}\n`;
}

export type GardenCounts = Record<CollectionName, number>;

/**
 * Everything the app persists, as one document. **Assumes a transaction is
 * already open** — `buildDocument` is the version that opens one.
 *
 * The split exists because `withTransaction` issues `BEGIN IMMEDIATE`, which
 * SQLite refuses inside an open transaction. A restore has to capture its
 * safety copy inside the same transaction that overwrites the garden, so it
 * needs this half; everything else wants the wrapper.
 *
 * ## What is deliberately not in here
 *
 * - **`SUPERVISOR_TOKEN` and everything in `ha/`.** Never in the database, and
 *   catastrophic in a file she might email to someone.
 * - **The add-on options** `weather_entity`, `notify_service`, `sensor_prefix`.
 *   Install-time plumbing for one particular Home Assistant, not her garden.
 * - **The `ha_state` table.** The frost notifier's memory of what it has already
 *   sent. Restoring it would either re-suppress a warning she needs or re-fire
 *   one she has already acted on.
 * - **The collection version counters.** They describe this server's write
 *   history, not her garden. Restoring them would hand a stale tab a
 *   precondition that matches again — see `restore.ts`.
 *
 * `settings` *is* included: a boolean and two `HH:MM` strings, no credentials.
 * Losing her quiet hours along with her garden would be a second, avoidable
 * loss.
 */
export function readDocument(db: Database, exportedAt: string): GardenBackupDocument {
  const seeds = listSeeds(db);
  const beds = listBeds(db);
  const harvests = listHarvests(db);

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt,
    // Advisory and human-facing only. A restore recomputes from the arrays
    // below and never trusts this, so a hand-edited file cannot lie its way
    // past validation by adjusting a number at the top.
    counts: { seeds: seeds.length, beds: beds.length, harvests: harvests.length },
    seeds,
    beds,
    harvests,
    settings: readSettings(db),
  } satisfies GardenBackupDocument;
}

/**
 * The whole garden as one document, read atomically.
 *
 * The transaction matters: three separate reads could straddle a write from her
 * phone, and an export that caught seeds before an edit and harvests after it
 * would be a file that never described a real garden.
 */
export function buildDocument(db: Database, exportedAt: string): GardenBackupDocument {
  return withTransaction(db, () => readDocument(db, exportedAt));
}

/** Counts of what is in the garden right now. Assumes an open transaction. */
export function readCounts(db: Database): GardenCounts {
  return {
    seeds: listSeeds(db).length,
    beds: listBeds(db).length,
    harvests: listHarvests(db).length,
  };
}

/** Counts of what is in the garden right now, read atomically. */
export function currentCounts(db: Database): GardenCounts {
  return withTransaction(db, () => readCounts(db));
}

/** `home-plot-tracker-2026-09-14.json`, from an ISO timestamp. */
export function backupFilename(exportedAt: string): string {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(exportedAt)?.[1] ?? 'export';

  return `home-plot-tracker-${day}.json`;
}

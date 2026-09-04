/**
 * Per-collection version counters, and the guarded write built on them.
 *
 * The hazard this exists for: `PUT /api/seeds` replaces the whole collection.
 * If a laptop tab loaded the harvests at 9am, a phone added two at 2pm, and the
 * laptop then saved, the laptop's stale array would overwrite the phone's work
 * with no error and no trace. Versions turn that into a 409.
 *
 * The critical property is that **the check and the write share one
 * transaction**. Checking the version in one statement and writing in another
 * would leave a window where two requests both read version 3, both decide they
 * are current, and both write — which is the bug, reintroduced with extra steps.
 */
import type { CollectionName } from '@hpt/shared';
import type { Database } from './open.ts';
import { withTransaction } from './open.ts';

/**
 * Reads a collection's version.
 *
 * Throws on an unknown collection rather than returning 0: every collection is
 * seeded by migration 2, so a miss means the name is wrong or the database is
 * older than the code, and quietly reporting "version 0" would hand out a
 * precondition that can never match.
 */
export function readVersion(db: Database, collection: CollectionName): number {
  const row = db
    .prepare('SELECT version FROM collection_versions WHERE collection = ?')
    .get(collection) as { version?: number } | undefined;

  if (row?.version === undefined) {
    throw new Error(`No version row for collection ${JSON.stringify(collection)}`);
  }

  return Number(row.version);
}

export function readAllVersions(db: Database): Record<CollectionName, number> {
  const rows = db
    .prepare('SELECT collection, version FROM collection_versions')
    .all() as { collection: string; version: number }[];

  const versions = {} as Record<CollectionName, number>;

  for (const row of rows) {
    versions[row.collection as CollectionName] = Number(row.version);
  }

  return versions;
}

/**
 * Increments and returns a collection's new version.
 *
 * Caller must already be inside a transaction — this is a step in a write, not
 * a write of its own.
 */
export function bumpVersion(db: Database, collection: CollectionName): number {
  const row = db
    .prepare(
      `UPDATE collection_versions
          SET version = version + 1, updated_at = datetime('now')
        WHERE collection = ?
      RETURNING version`,
    )
    .get(collection) as { version?: number } | undefined;

  if (row?.version === undefined) {
    throw new Error(`No version row to bump for collection ${JSON.stringify(collection)}`);
  }

  return Number(row.version);
}

export type GuardedWrite<T> =
  | { ok: true; version: number; items: T[] }
  | { ok: false; currentVersion: number; current: T[] };

/**
 * Replaces a collection, but only if it is still at `expectedVersion`.
 *
 * Everything — the version check, the replace, the bump and the read-back —
 * happens inside a single `BEGIN IMMEDIATE` transaction. SQLite allows one
 * writer at a time, so a second request attempting this waits for the first to
 * commit and then reads the *bumped* version, which is what makes "exactly one
 * of two concurrent writers wins" true rather than merely likely.
 *
 * A conflict is returned, not thrown: it is an ordinary outcome of two devices
 * being used at once, and the caller needs the current state to send back.
 */
export function replaceIfCurrent<T>(
  db: Database,
  collection: CollectionName,
  expectedVersion: number,
  items: readonly T[],
  replace: (db: Database, items: readonly T[]) => void,
  read: (db: Database) => T[],
): GuardedWrite<T> {
  return withTransaction(db, (): GuardedWrite<T> => {
    const currentVersion = readVersion(db, collection);

    if (currentVersion !== expectedVersion) {
      // Read the current state inside the same transaction, so what the client
      // is told to reconcile against is the state that beat it, not whatever
      // happens to be there by the time we serialise the response.
      return { ok: false, currentVersion, current: read(db) };
    }

    replace(db, items);

    const version = bumpVersion(db, collection);

    return { ok: true, version, items: read(db) };
  });
}


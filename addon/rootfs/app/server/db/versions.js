import { withTransaction } from "./open.js";
/**
 * Reads a collection's version.
 *
 * Throws on an unknown collection rather than returning 0: every collection is
 * seeded by migration 2, so a miss means the name is wrong or the database is
 * older than the code, and quietly reporting "version 0" would hand out a
 * precondition that can never match.
 */
export function readVersion(db, collection) {
    const row = db
        .prepare('SELECT version FROM collection_versions WHERE collection = ?')
        .get(collection);
    if (row?.version === undefined) {
        throw new Error(`No version row for collection ${JSON.stringify(collection)}`);
    }
    return Number(row.version);
}
export function readAllVersions(db) {
    const rows = db
        .prepare('SELECT collection, version FROM collection_versions')
        .all();
    const versions = {};
    for (const row of rows) {
        versions[row.collection] = Number(row.version);
    }
    return versions;
}
/**
 * Increments and returns a collection's new version.
 *
 * Caller must already be inside a transaction — this is a step in a write, not
 * a write of its own.
 */
export function bumpVersion(db, collection) {
    const row = db
        .prepare(`UPDATE collection_versions
          SET version = version + 1, updated_at = datetime('now')
        WHERE collection = ?
      RETURNING version`)
        .get(collection);
    if (row?.version === undefined) {
        throw new Error(`No version row to bump for collection ${JSON.stringify(collection)}`);
    }
    return Number(row.version);
}
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
export function replaceIfCurrent(db, collection, expectedVersion, items, replace, read) {
    return withTransaction(db, () => {
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
//# sourceMappingURL=versions.js.map
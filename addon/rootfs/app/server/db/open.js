/**
 * SQLite access, built on Node's own `node:sqlite`.
 *
 * Using the built-in module rather than `better-sqlite3` is deliberate: there is
 * no native addon to compile, so the LXC needs no build toolchain and nothing
 * has to be rebuilt when Node is upgraded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
/**
 * Opens (and creates, if needed) the database file with the pragmas this app
 * relies on.
 *
 * - **WAL** so a reader in the garden on a phone never blocks a writer indoors.
 * - **foreign_keys** so any relational table added later is enforced rather
 *   than advisory. SQLite defaults this off, per connection.
 * - **busy_timeout** so a concurrent writer waits instead of failing instantly.
 */
export function openDatabase(databasePath) {
    if (databasePath !== ':memory:') {
        fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    const db = new DatabaseSync(databasePath);
    // An in-memory database has no journal to write, so it reports "memory" here.
    // That is expected and not an error.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    return db;
}
/** The journal mode actually in force — `wal` for a file, `memory` for `:memory:`. */
export function journalMode(db) {
    const row = db.prepare('PRAGMA journal_mode').get();
    return String(row?.journal_mode ?? '');
}
export function foreignKeysEnabled(db) {
    const row = db.prepare('PRAGMA foreign_keys').get();
    return Number(row?.foreign_keys ?? 0) === 1;
}
/**
 * Runs `work` inside a single transaction, rolling the whole thing back if it
 * throws. Every collection replace goes through here so a rejected row can never
 * leave a half-deleted collection behind.
 */
export function withTransaction(db, work) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = work();
        db.exec('COMMIT');
        return result;
    }
    catch (error) {
        try {
            db.exec('ROLLBACK');
        }
        catch {
            // The transaction was already aborted by SQLite; the original error wins.
        }
        throw error;
    }
}
//# sourceMappingURL=open.js.map
import { DEFAULT_MIGRATION_CONTEXT, MIGRATIONS } from "./migrations.js";
const CREATE_LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL
  )
`;
function assertUniqueVersions(migrations) {
    const seen = new Set();
    for (const migration of migrations) {
        if (!Number.isInteger(migration.version) || migration.version < 1) {
            throw new Error(`Migration "${migration.name}" has a non-positive-integer version`);
        }
        if (seen.has(migration.version)) {
            throw new Error(`Duplicate migration version ${migration.version}`);
        }
        seen.add(migration.version);
    }
}
export function appliedVersions(db) {
    db.exec(CREATE_LEDGER);
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    return rows.map((row) => Number(row.version));
}
/**
 * Applies whatever is missing, in order, each in its own transaction.
 *
 * `context` carries the handful of values a migration cannot get from the
 * database — today just the settings seed. It defaults to a fresh garden's
 * values, which is what the tests and any non-add-on deployment want; the
 * add-on's real options are supplied by `index.ts`.
 */
export function runMigrations(db, migrations = MIGRATIONS, context = DEFAULT_MIGRATION_CONTEXT) {
    assertUniqueVersions(migrations);
    const already = new Set(appliedVersions(db));
    const ordered = [...migrations].sort((a, b) => a.version - b.version);
    const report = { applied: [], skipped: [], currentVersion: 0 };
    for (const migration of ordered) {
        if (already.has(migration.version)) {
            report.skipped.push(migration.version);
            continue;
        }
        // DDL is transactional in SQLite, so a migration either lands whole or not
        // at all — including its ledger row.
        db.exec('BEGIN IMMEDIATE');
        try {
            migration.up(db, context);
            db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(migration.version, migration.name, new Date().toISOString());
            db.exec('COMMIT');
        }
        catch (error) {
            try {
                db.exec('ROLLBACK');
            }
            catch {
                // Already rolled back by SQLite.
            }
            throw new Error(`Migration ${migration.version} (${migration.name}) failed and was rolled back`, { cause: error });
        }
        report.applied.push(migration.version);
    }
    report.currentVersion = ordered.length === 0 ? 0 : Math.max(...ordered.map((m) => m.version));
    return report;
}
//# sourceMappingURL=migrate.js.map
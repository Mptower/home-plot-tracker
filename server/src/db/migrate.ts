/**
 * The migration runner. Runs automatically on boot, and is safe to run again on
 * an already-current database — it applies whatever is missing and nothing else.
 */
import type { Database } from './open.ts';
import { MIGRATIONS } from './migrations.ts';
import type { Migration } from './migrations.ts';

export interface MigrationReport {
  /** Versions applied by this call, in order. Empty when already up to date. */
  applied: number[];
  /** Versions that were already recorded before this call. */
  skipped: number[];
  /** Highest version now recorded. */
  currentVersion: number;
}

const CREATE_LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL
  )
`;

function assertUniqueVersions(migrations: readonly Migration[]): void {
  const seen = new Set<number>();

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

export function appliedVersions(db: Database): number[] {
  db.exec(CREATE_LEDGER);

  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
    version: number;
  }[];

  return rows.map((row) => Number(row.version));
}

export function runMigrations(
  db: Database,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationReport {
  assertUniqueVersions(migrations);

  const already = new Set(appliedVersions(db));
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const report: MigrationReport = { applied: [], skipped: [], currentVersion: 0 };

  for (const migration of ordered) {
    if (already.has(migration.version)) {
      report.skipped.push(migration.version);
      continue;
    }

    // DDL is transactional in SQLite, so a migration either lands whole or not
    // at all — including its ledger row.
    db.exec('BEGIN IMMEDIATE');

    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Already rolled back by SQLite.
      }

      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed and was rolled back`,
        { cause: error },
      );
    }

    report.applied.push(migration.version);
  }

  report.currentVersion = ordered.length === 0 ? 0 : Math.max(...ordered.map((m) => m.version));

  return report;
}

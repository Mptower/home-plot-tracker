import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, journalMode, foreignKeysEnabled } from '../src/db/open.ts';
import { appliedVersions, runMigrations } from '../src/db/migrate.ts';
import { MIGRATIONS } from '../src/db/migrations.ts';
import type { Migration } from '../src/db/migrations.ts';
import { tempDir } from './helpers.ts';

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];

  return rows.map((row) => row.name);
}

// Derived rather than hardcoded, so adding migration 3 does not fail four tests
// that were never about migration 3.
const ALL_VERSIONS = MIGRATIONS.map((migration) => migration.version);
const LATEST_VERSION = ALL_VERSIONS.at(-1) ?? 0;
const NEXT_VERSION = LATEST_VERSION + 1;

test('migrations build the whole schema from an empty database', () => {
  const db = openDatabase(':memory:');

  assert.deepEqual(tableNames(db), [], 'a fresh database starts with no tables');

  const report = runMigrations(db);

  assert.deepEqual(report.applied, ALL_VERSIONS);
  assert.deepEqual(report.skipped, []);
  assert.equal(report.currentVersion, LATEST_VERSION);

  const names = tableNames(db);
  for (const expected of [
    'beds',
    'collection_versions',
    'harvests',
    'schema_migrations',
    'seeds',
    'settings',
  ]) {
    assert.ok(names.includes(expected), `expected a ${expected} table, got ${names.join(', ')}`);
  }

  db.close();
});

test('running migrations again is a no-op', () => {
  const db = openDatabase(':memory:');

  runMigrations(db);
  const second = runMigrations(db);

  assert.deepEqual(second.applied, [], 'nothing should be applied the second time');
  assert.deepEqual(second.skipped, ALL_VERSIONS);
  assert.deepEqual(appliedVersions(db), ALL_VERSIONS);

  // A third run, to be sure the ledger is not being appended to.
  runMigrations(db);
  assert.deepEqual(appliedVersions(db), ALL_VERSIONS);

  db.close();
});

test('migrations survive data already being present', () => {
  const db = openDatabase(':memory:');
  runMigrations(db);

  db.prepare(
    `INSERT INTO seeds (id, category, variety, brand, purchase_year, notes, position)
     VALUES ('a', 'Herb', 'Basil', 'Brand', 2025, '', 0)`,
  ).run();

  runMigrations(db);

  const rows = db.prepare('SELECT COUNT(*) AS total FROM seeds').get() as { total: number };
  assert.equal(Number(rows.total), 1, 'a re-run must not touch existing rows');

  db.close();
});

test('a new migration is applied to an existing database without re-running old ones', () => {
  const db = openDatabase(':memory:');
  runMigrations(db);

  // A throwaway table nothing else uses. It must not collide with a real one —
  // a name already created by MIGRATIONS would make this pass whether or not
  // the extra migration ever ran.
  const withPlantings: Migration[] = [
    ...MIGRATIONS,
    {
      version: NEXT_VERSION,
      name: 'add_plantings',
      up(migrating) {
        migrating.exec('CREATE TABLE IF NOT EXISTS plantings (key TEXT PRIMARY KEY, value TEXT)');
      },
    },
  ];

  assert.ok(!tableNames(db).includes('plantings'), 'the throwaway table must not already exist');

  const report = runMigrations(db, withPlantings);

  assert.deepEqual(report.applied, [NEXT_VERSION]);
  assert.deepEqual(report.skipped, ALL_VERSIONS);
  assert.equal(report.currentVersion, NEXT_VERSION);
  assert.ok(tableNames(db).includes('plantings'));

  db.close();
});

test('a failing migration rolls back and is not recorded', () => {
  const db = openDatabase(':memory:');

  const broken: Migration[] = [
    {
      version: 1,
      name: 'half_broken',
      up(migrating) {
        migrating.exec('CREATE TABLE first_table (id TEXT PRIMARY KEY)');
        migrating.exec('THIS IS NOT SQL');
      },
    },
  ];

  assert.throws(() => runMigrations(db, broken), /Migration 1 \(half_broken\) failed/);
  assert.deepEqual(appliedVersions(db), [], 'a failed migration must not be recorded');
  assert.ok(
    !tableNames(db).includes('first_table'),
    'the successful half of a failed migration must be rolled back',
  );

  db.close();
});

test('duplicate migration versions are rejected outright', () => {
  const db = openDatabase(':memory:');

  const duplicated: Migration[] = [
    { version: 1, name: 'one', up: () => {} },
    { version: 1, name: 'one_again', up: () => {} },
  ];

  assert.throws(() => runMigrations(db, duplicated), /Duplicate migration version 1/);

  db.close();
});

test('a file-backed database is created, uses WAL, and enforces foreign keys', () => {
  const dir = tempDir();
  const databasePath = path.join(dir, 'nested', 'garden.db');

  assert.ok(!fs.existsSync(databasePath), 'the file should not exist yet');

  const db = openDatabase(databasePath);
  runMigrations(db);

  assert.ok(fs.existsSync(databasePath), 'opening the database creates the file');
  assert.equal(journalMode(db), 'wal');
  assert.equal(foreignKeysEnabled(db), true);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

test('deleting the database file and reopening recreates the schema cleanly', () => {
  const dir = tempDir();
  const databasePath = path.join(dir, 'garden.db');

  const first = openDatabase(databasePath);
  runMigrations(first);
  first
    .prepare(
      `INSERT INTO seeds (id, category, variety, brand, purchase_year, notes, position)
       VALUES ('a', 'Herb', 'Basil', 'Brand', 2025, '', 0)`,
    )
    .run();
  first.close();

  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  assert.ok(!fs.existsSync(databasePath));

  const second = openDatabase(databasePath);
  const report = runMigrations(second);

  assert.deepEqual(
    report.applied,
    ALL_VERSIONS,
    'a deleted database migrates from scratch again',
  );
  const count = second.prepare('SELECT COUNT(*) AS total FROM seeds').get() as { total: number };
  assert.equal(Number(count.total), 0, 'and comes back empty');

  second.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

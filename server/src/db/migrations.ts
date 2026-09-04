/**
 * Numbered, append-only schema migrations.
 *
 * Rules for adding one:
 *
 * 1. Append a new entry with the next version number. Never edit or renumber an
 *    applied migration — the runner records versions, not checksums, so an
 *    edited migration silently never runs again on an existing database.
 * 2. Keep each `up` idempotent (`IF NOT EXISTS`) so a half-applied database from
 *    a crash can still be brought forward.
 * 3. Nothing about the runner needs to change to add a table: a `settings` table
 *    for preferences, or a `plantings` table if beds ever grow history, would
 *    just be versions 2 and 3.
 */
import type { Database } from './open.ts';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up(db) {
      // `position` preserves the client's array order through a round trip: the
      // API replaces whole collections, and the views render them in order.
      db.exec(`
        CREATE TABLE IF NOT EXISTS seeds (
          id            TEXT    PRIMARY KEY,
          category      TEXT    NOT NULL,
          variety       TEXT    NOT NULL,
          brand         TEXT    NOT NULL,
          purchase_year INTEGER NOT NULL,
          notes         TEXT    NOT NULL,
          position      INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS beds (
          id                 TEXT    PRIMARY KEY,
          name               TEXT    NOT NULL,
          "rows"             INTEGER NOT NULL,
          "columns"          INTEGER NOT NULL,
          -- A JSON array-of-arrays of variety names and nulls, exactly
          -- "rows" x "columns". Stored as text: it is only ever read and written
          -- whole, so there is nothing to gain from shredding it into cells.
          layout             TEXT    NOT NULL,
          last_year_category TEXT    NOT NULL,
          position           INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS harvests (
          id          TEXT    PRIMARY KEY,
          -- ISO yyyy-mm-dd. Kept as text so it sorts and compares lexically.
          date        TEXT    NOT NULL,
          variety     TEXT    NOT NULL,
          weight_lbs  REAL    NOT NULL,
          count       INTEGER NOT NULL,
          position    INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_seeds_position    ON seeds (position);
        CREATE INDEX IF NOT EXISTS idx_beds_position     ON beds (position);
        CREATE INDEX IF NOT EXISTS idx_harvests_position ON harvests (position);
        CREATE INDEX IF NOT EXISTS idx_harvests_date     ON harvests (date);
      `);
    },
  },
];

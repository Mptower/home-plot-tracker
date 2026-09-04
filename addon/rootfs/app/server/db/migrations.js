export const MIGRATIONS = [
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
//# sourceMappingURL=migrations.js.map
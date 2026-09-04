import { DEFAULT_SETTINGS, seedSettings } from "./settings.js";
/** What a migration run assumes when the caller says nothing — a fresh garden. */
export const DEFAULT_MIGRATION_CONTEXT = {
    settingsSeed: DEFAULT_SETTINGS,
};
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
    {
        version: 2,
        name: 'collection_versions',
        up(db) {
            // Optimistic concurrency. A write replaces a whole collection, so a stale
            // tab saving over a newer one would silently erase records — a phone in
            // the garden and a laptop indoors is exactly the case this app has. Each
            // collection gets a counter that every successful write bumps; a client
            // must declare the version it read, and a mismatch is a 409 rather than a
            // silent overwrite.
            //
            // A dedicated table rather than a column on each row: the unit of change
            // is the collection, not the record. Storing it per row would mean picking
            // a winner among them on read, which is the same thing said less clearly.
            db.exec(`
        CREATE TABLE IF NOT EXISTS collection_versions (
          collection TEXT    PRIMARY KEY,
          version    INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `);
            // Seeded rather than created lazily so a read never has to write, and so
            // "collection I have never heard of" stays distinguishable from
            // "collection nobody has written yet".
            const seed = db.prepare('INSERT OR IGNORE INTO collection_versions (collection, version) VALUES (?, 0)');
            for (const collection of ['seeds', 'beds', 'harvests']) {
                seed.run(collection);
            }
        },
    },
    {
        version: 3,
        name: 'ha_state',
        up(db) {
            // Somewhere durable for the Home Assistant integration to remember what it
            // has already done. Exactly one thing needs this today: which cold snaps
            // have already been notified about.
            //
            // It has to survive a restart, and it has to live in DATA_DIR. An add-on
            // restarts on every update, every Home Assistant reboot and every time she
            // changes an option — and if the record of "I already warned her about
            // Saturday night" were in memory, each of those would send the same
            // warning again. A frost alert she has already read and acted on,
            // arriving a second and third time, is precisely the nuisance that trains
            // someone to swipe warnings away without reading them.
            //
            // A key/value table rather than columns: the shape of what is worth
            // remembering here will change, and none of it is queried by anything but
            // key.
            db.exec(`
        CREATE TABLE IF NOT EXISTS ha_state (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
        },
    },
    {
        version: 4,
        name: 'settings',
        up(db, context) {
            // Frost notifications and quiet hours move here from the add-on's
            // options. They are the only three settings a gardener has any reason to
            // change, and reaching them meant Settings -> Add-ons -> Configuration —
            // an admin area, behind two clicks she has no reason to know about, that
            // restarts the container to apply an answer to "should this wake me?".
            //
            // This is a move and not a copy. `addon/config.yaml` no longer carries
            // these keys at all, because two settings pages that disagree — one of
            // them silently winning — is a worse outcome than either place alone.
            //
            // Columns rather than the key/value shape `ha_state` uses: this set is
            // fixed, typed and user-facing, so a column each is what makes a typo a
            // migration error instead of a silently ignored row. `CHECK (id = 1)`
            // makes "singleton" a property of the schema rather than a convention
            // every reader has to remember.
            db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          id                  INTEGER PRIMARY KEY CHECK (id = 1),
          frost_notifications INTEGER NOT NULL,
          quiet_hours_start   TEXT    NOT NULL,
          quiet_hours_end     TEXT    NOT NULL,
          updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `);
            // Seeded from whatever the add-on's options currently say, so an upgrade
            // is invisible: notifications off and 21:00-07:00 stay off and 21:00-07:00.
            // Resetting her to the defaults here would turn a settings page she did
            // not ask for into her phone going off at 3am, which is the one outcome
            // this whole feature exists to give her control over.
            seedSettings(db, context.settingsSeed);
        },
    },
];
//# sourceMappingURL=migrations.js.map
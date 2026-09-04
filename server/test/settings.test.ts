/**
 * The settings singleton: storage, seeding, and the upgrade path.
 *
 * The tests that matter most here are the ones about the *upgrade*. A fresh
 * install getting the defaults is easy and uninteresting. The case worth
 * pinning down is the one that only happens once, on somebody else's machine,
 * where getting it wrong means her phone starts buzzing at 3am because a
 * preference she set months ago was quietly reset by an update she was told was
 * about a settings page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../src/db/open.ts';
import type { Database } from '../src/db/open.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { MIGRATIONS } from '../src/db/migrations.ts';
import { DEFAULT_SETTINGS, readSettings, seedSettings, writeSettings } from '../src/db/settings.ts';
import { readLegacyNotificationSettings } from '../src/ha/options.ts';
import { tempDir } from './helpers.ts';

/** Her live 0.2.0 configuration, verbatim. */
const HERS = {
  frost_notifications: false,
  quiet_hours_start: '21:00',
  quiet_hours_end: '07:00',
  weather_entity: 'weather.forecast_home',
  notify_service: 'notify.mobile_app_julie_s_phone',
  sensor_prefix: 'garden',
};

function optionsFile(contents: string): { optionsPath: string; dir: string } {
  const dir = tempDir('hpt-settings-');
  const optionsPath = path.join(dir, 'options.json');

  fs.writeFileSync(optionsPath, contents, 'utf8');

  return { optionsPath, dir };
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

function migrated(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

test('migration 4 creates the settings row, and it is a singleton by schema', () => {
  const db = migrated();

  const rows = db.prepare('SELECT id FROM settings').all() as { id: number }[];
  assert.deepEqual(
    rows.map((row) => row.id),
    [1],
    'exactly one row, with the id the CHECK constraint allows',
  );

  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO settings (id, frost_notifications, quiet_hours_start, quiet_hours_end)
           VALUES (2, 1, '21:00', '07:00')`,
        )
        .run(),
    /CHECK constraint failed/,
    'a second row must be impossible, not merely discouraged',
  );

  db.close();
});

test('a fresh install gets the defaults', () => {
  const db = migrated();

  assert.deepEqual(readSettings(db), DEFAULT_SETTINGS);

  db.close();
});

test('an upgrade seeds her existing add-on options rather than the defaults', () => {
  const db = openDatabase(':memory:');

  // Notifications off is the value that matters: it differs from the default,
  // so a migration that ignored the seed would look correct in every other
  // assertion and still switch her notifications back on.
  runMigrations(db, MIGRATIONS, {
    settingsSeed: { frostNotifications: false, quietHoursStart: '22:30', quietHoursEnd: '06:15' },
  });

  assert.deepEqual(readSettings(db), {
    frostNotifications: false,
    quietHoursStart: '22:30',
    quietHoursEnd: '06:15',
  });

  db.close();
});

test('re-running migrations cannot reset a preference she has since changed', () => {
  const db = openDatabase(':memory:');
  const seed = { settingsSeed: { ...DEFAULT_SETTINGS, frostNotifications: false } };

  runMigrations(db, MIGRATIONS, seed);
  writeSettings(db, {
    frostNotifications: true,
    quietHoursStart: '23:00',
    quietHoursEnd: '05:00',
  });

  // Migration 4 is already recorded, so the runner skips it — but `seedSettings`
  // is `INSERT OR IGNORE` besides, and both halves of that belt are worth
  // holding: a migration that reset a live preference would be silent.
  runMigrations(db, MIGRATIONS, seed);

  assert.deepEqual(readSettings(db), {
    frostNotifications: true,
    quietHoursStart: '23:00',
    quietHoursEnd: '05:00',
  });

  db.close();
});

test('a write is read back from the database, not echoed', () => {
  const db = migrated();

  const stored = writeSettings(db, {
    frostNotifications: false,
    quietHoursStart: '20:00',
    quietHoursEnd: '08:00',
  });

  assert.deepEqual(stored, {
    frostNotifications: false,
    quietHoursStart: '20:00',
    quietHoursEnd: '08:00',
  });
  assert.deepEqual(readSettings(db), stored, 'a fresh read must agree with what was returned');

  db.close();
});

test('equal quiet hours are stored as given, because that is how she switches them off', () => {
  const db = migrated();

  const stored = writeSettings(db, {
    frostNotifications: true,
    quietHoursStart: '07:00',
    quietHoursEnd: '07:00',
  });

  assert.equal(stored.quietHoursStart, stored.quietHoursEnd);

  db.close();
});

test('a missing settings row degrades to the defaults instead of throwing', () => {
  const db = migrated();
  const warnings: string[] = [];

  db.prepare('DELETE FROM settings').run();

  assert.deepEqual(readSettings(db, (message) => warnings.push(message)), DEFAULT_SETTINGS);
  assert.equal(warnings.length, 1, 'and says so once, so the log explains the reverted preference');

  db.close();
});

test('a corrupt quiet-hours value degrades field by field', () => {
  const db = migrated();
  const warnings: string[] = [];

  // Somebody with a SQLite browser and good intentions.
  db.prepare("UPDATE settings SET quiet_hours_start = 'half nine', frost_notifications = 0").run();

  assert.deepEqual(readSettings(db, (message) => warnings.push(message)), {
    // Kept: it is readable and hers.
    frostNotifications: false,
    // Replaced: it is not a time.
    quietHoursStart: DEFAULT_SETTINGS.quietHoursStart,
    quietHoursEnd: DEFAULT_SETTINGS.quietHoursEnd,
  });

  db.close();
});

test('reading settings from a database with no settings table does not throw', () => {
  // The state a migration failure would leave behind. The forecast poll calls
  // this on a timer, so an exception here is an unhandled rejection in a
  // process whose job is to warn somebody about frost.
  const db = openDatabase(':memory:');
  const warnings: string[] = [];

  assert.deepEqual(readSettings(db, (message) => warnings.push(message)), DEFAULT_SETTINGS);
  assert.equal(warnings.length, 1);

  db.close();
});

test('seeding twice keeps the first answer', () => {
  const db = migrated();

  db.prepare('DELETE FROM settings').run();
  seedSettings(db, { frostNotifications: false, quietHoursStart: '21:00', quietHoursEnd: '07:00' });
  seedSettings(db, { frostNotifications: true, quietHoursStart: '01:00', quietHoursEnd: '02:00' });

  assert.deepEqual(readSettings(db), {
    frostNotifications: false,
    quietHoursStart: '21:00',
    quietHoursEnd: '07:00',
  });

  db.close();
});

test('the legacy reader finds her 0.2.0 answers in options.json', () => {
  const { optionsPath, dir } = optionsFile(JSON.stringify(HERS));

  assert.deepEqual(readLegacyNotificationSettings(optionsPath), {
    frostNotifications: false,
    quietHoursStart: '21:00',
    quietHoursEnd: '07:00',
  });

  removeDir(dir);
});

test('an options file with no notification keys seeds the defaults', () => {
  // What a fresh 0.3.0 install looks like: the options schema no longer
  // declares these three at all, so Supervisor never writes them.
  const { optionsPath, dir } = optionsFile(
    JSON.stringify({
      weather_entity: 'weather.forecast_home',
      notify_service: 'notify.mobile_app_julie_s_phone',
      sensor_prefix: 'garden',
    }),
  );

  assert.deepEqual(readLegacyNotificationSettings(optionsPath), DEFAULT_SETTINGS);

  removeDir(dir);
});

test('no options file at all seeds the defaults without complaint', () => {
  const dir = tempDir('hpt-settings-');
  const warnings: string[] = [];

  assert.deepEqual(
    readLegacyNotificationSettings(path.join(dir, 'nothing.json'), (m) => warnings.push(m)),
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(warnings, [], 'the ordinary development case must be silent');

  removeDir(dir);
});

test('a malformed legacy quiet-hours value falls back rather than failing the migration', () => {
  const { optionsPath, dir } = optionsFile(
    JSON.stringify({ ...HERS, quiet_hours_start: '9pm' }),
  );
  const warnings: string[] = [];

  const seed = readLegacyNotificationSettings(optionsPath, (message) => warnings.push(message));

  assert.equal(seed.quietHoursStart, DEFAULT_SETTINGS.quietHoursStart);
  assert.equal(seed.frostNotifications, false, 'the readable fields are still hers');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /quiet_hours_start/);

  removeDir(dir);
});

test('a legacy options file that is not JSON seeds the defaults', () => {
  const { optionsPath, dir } = optionsFile('<html>not json</html>');
  const warnings: string[] = [];

  assert.deepEqual(
    readLegacyNotificationSettings(optionsPath, (message) => warnings.push(message)),
    DEFAULT_SETTINGS,
  );
  assert.equal(warnings.length, 1);

  removeDir(dir);
});

test('her real upgrade, end to end: options.json in, settings row out', () => {
  const { optionsPath, dir } = optionsFile(JSON.stringify(HERS));
  const db = openDatabase(':memory:');

  runMigrations(db, MIGRATIONS, {
    settingsSeed: readLegacyNotificationSettings(optionsPath, () => {}),
  });

  assert.deepEqual(
    readSettings(db),
    { frostNotifications: false, quietHoursStart: '21:00', quietHoursEnd: '07:00' },
    'notifications off and 21:00–07:00 must survive the upgrade untouched',
  );

  db.close();
  removeDir(dir);
});

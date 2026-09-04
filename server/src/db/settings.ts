/**
 * Read/write for the `settings` singleton.
 *
 * These three preferences used to be add-on options, which meant changing them
 * required the Home Assistant **Settings → Add-ons → Configuration** tab and a
 * container restart. They live here instead so the app can own them, and so a
 * change takes effect on the next forecast poll rather than on the next boot.
 *
 * Two properties this module is careful about:
 *
 * **A read never throws.** `readSettings` is called from inside the forecast
 * poll, on a timer, and an exception there would take an unhandled rejection
 * into a process that exists to warn someone about frost. A missing or corrupt
 * row degrades to the defaults with a warning, exactly as `haState.ts` degrades
 * to "I don't remember" — the worst case of falling back is a preference
 * reverting visibly, and the worst case of throwing is a dead integration.
 *
 * **The row is a singleton by schema, not by convention.** Migration 4 declares
 * `CHECK (id = 1)`, so there is no "which row wins" question to answer here or
 * anywhere else.
 */
import type { GardenSettings } from '@hpt/shared';
import type { Database } from './open.ts';

/**
 * What a garden starts with when nothing else says otherwise.
 *
 * Deliberately server-side constants rather than an export from `@hpt/shared`:
 * every server import from that package is an `import type`, erased at compile
 * time, because the add-on image ships no `shared/` at all. A runtime value
 * imported from there would resolve in development and crash the add-on on
 * boot. See the note at the top of `shared/src/homeAssistant.ts`.
 */
export const DEFAULT_SETTINGS: GardenSettings = {
  frostNotifications: true,
  quietHoursStart: '21:00',
  quietHoursEnd: '07:00',
};

/** `HH:MM`, 24-hour. The one shape a stored quiet-hours bound may take. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface SettingsRow {
  frost_notifications?: number;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

function readTime(value: unknown, fallback: string): string {
  return typeof value === 'string' && TIME_OF_DAY.test(value) ? value : fallback;
}

/**
 * The stored settings, or the defaults for every reason there might not be any.
 *
 * `warn` is injected so the tests can assert on the degraded path without
 * printing to the suite's output.
 */
export function readSettings(
  db: Database,
  warn: (message: string) => void = console.warn,
): GardenSettings {
  let row: SettingsRow | undefined;

  try {
    row = db
      .prepare(
        'SELECT frost_notifications, quiet_hours_start, quiet_hours_end FROM settings WHERE id = 1',
      )
      .get() as SettingsRow | undefined;
  } catch (error) {
    warn(
      `Could not read the settings row (${(error as Error).message}). Using the defaults.`,
    );
    return { ...DEFAULT_SETTINGS };
  }

  if (!row) {
    warn('There is no settings row to read. Using the defaults.');
    return { ...DEFAULT_SETTINGS };
  }

  return {
    frostNotifications: Number(row.frost_notifications ?? 0) === 1,
    quietHoursStart: readTime(row.quiet_hours_start, DEFAULT_SETTINGS.quietHoursStart),
    quietHoursEnd: readTime(row.quiet_hours_end, DEFAULT_SETTINGS.quietHoursEnd),
  };
}

/**
 * Replaces the settings and returns what was actually stored.
 *
 * Read back rather than echoed, so the caller's response is proof of what is in
 * the database rather than a restatement of what was asked for. `INSERT … ON
 * CONFLICT` rather than a bare `UPDATE` so a database whose row somehow went
 * missing heals on the next save instead of silently accepting writes that go
 * nowhere.
 */
export function writeSettings(db: Database, settings: GardenSettings): GardenSettings {
  db.prepare(
    `INSERT INTO settings (id, frost_notifications, quiet_hours_start, quiet_hours_end, updated_at)
     VALUES (1, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       frost_notifications = excluded.frost_notifications,
       quiet_hours_start   = excluded.quiet_hours_start,
       quiet_hours_end     = excluded.quiet_hours_end,
       updated_at          = excluded.updated_at`,
  ).run(
    settings.frostNotifications ? 1 : 0,
    settings.quietHoursStart,
    settings.quietHoursEnd,
  );

  return readSettings(db);
}

/**
 * Creates the row if it is not already there. Used by migration 4.
 *
 * `INSERT OR IGNORE`, so re-running migrations on a database where she has
 * since changed a preference cannot reset it — the migration runner will not
 * call this twice, but idempotence is the rule every migration in this
 * repository is written to.
 */
export function seedSettings(db: Database, settings: GardenSettings): void {
  db.prepare(
    `INSERT OR IGNORE INTO settings (id, frost_notifications, quiet_hours_start, quiet_hours_end)
     VALUES (1, ?, ?, ?)`,
  ).run(settings.frostNotifications ? 1 : 0, settings.quietHoursStart, settings.quietHoursEnd);
}

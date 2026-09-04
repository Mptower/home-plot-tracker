/**
 * What a garden starts with when nothing else says otherwise.
 *
 * Deliberately server-side constants rather than an export from `@hpt/shared`:
 * every server import from that package is an `import type`, erased at compile
 * time, because the add-on image ships no `shared/` at all. A runtime value
 * imported from there would resolve in development and crash the add-on on
 * boot. See the note at the top of `shared/src/homeAssistant.ts`.
 */
export const DEFAULT_SETTINGS = {
    frostNotifications: true,
    quietHoursStart: '21:00',
    quietHoursEnd: '07:00',
};
/** `HH:MM`, 24-hour. The one shape a stored quiet-hours bound may take. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;
function readTime(value, fallback) {
    return typeof value === 'string' && TIME_OF_DAY.test(value) ? value : fallback;
}
/**
 * The stored settings, or the defaults for every reason there might not be any.
 *
 * `warn` is injected so the tests can assert on the degraded path without
 * printing to the suite's output.
 */
export function readSettings(db, warn = console.warn) {
    let row;
    try {
        row = db
            .prepare('SELECT frost_notifications, quiet_hours_start, quiet_hours_end FROM settings WHERE id = 1')
            .get();
    }
    catch (error) {
        warn(`Could not read the settings row (${error.message}). Using the defaults.`);
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
export function writeSettings(db, settings) {
    db.prepare(`INSERT INTO settings (id, frost_notifications, quiet_hours_start, quiet_hours_end, updated_at)
     VALUES (1, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       frost_notifications = excluded.frost_notifications,
       quiet_hours_start   = excluded.quiet_hours_start,
       quiet_hours_end     = excluded.quiet_hours_end,
       updated_at          = excluded.updated_at`).run(settings.frostNotifications ? 1 : 0, settings.quietHoursStart, settings.quietHoursEnd);
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
export function seedSettings(db, settings) {
    db.prepare(`INSERT OR IGNORE INTO settings (id, frost_notifications, quiet_hours_start, quiet_hours_end)
     VALUES (1, ?, ?, ?)`).run(settings.frostNotifications ? 1 : 0, settings.quietHoursStart, settings.quietHoursEnd);
}
//# sourceMappingURL=settings.js.map
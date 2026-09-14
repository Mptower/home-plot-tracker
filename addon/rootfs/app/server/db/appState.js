export function readAppState(db, key, fallback) {
    try {
        const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key);
        if (!row)
            return fallback;
        return JSON.parse(row.value);
    }
    catch {
        return fallback;
    }
}
export function writeAppState(db, key, value) {
    db.prepare(`INSERT INTO app_state (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, JSON.stringify(value));
}
/** When a copy of the garden was last successfully downloaded. */
export const LAST_EXPORT_KEY = 'lastExportAt';
/**
 * ISO timestamp of the last successful export, or `null` if there has never
 * been one.
 *
 * Anything that is not a non-empty string reads as "never" rather than being
 * passed through, so a hand-edited row cannot put `false` or `0` in front of
 * her where a date belongs.
 */
export function readLastExportAt(db) {
    const value = readAppState(db, LAST_EXPORT_KEY, null);
    return typeof value === 'string' && value !== '' ? value : null;
}
export function writeLastExportAt(db, at) {
    writeAppState(db, LAST_EXPORT_KEY, at);
}
//# sourceMappingURL=appState.js.map
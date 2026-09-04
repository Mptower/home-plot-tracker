export function readHaState(db, key, fallback) {
    try {
        const row = db.prepare('SELECT value FROM ha_state WHERE key = ?').get(key);
        if (!row)
            return fallback;
        return JSON.parse(row.value);
    }
    catch {
        return fallback;
    }
}
export function writeHaState(db, key, value) {
    db.prepare(`INSERT INTO ha_state (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, JSON.stringify(value));
}
//# sourceMappingURL=haState.js.map
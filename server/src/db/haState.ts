/**
 * Read/write for the `ha_state` key/value table.
 *
 * The only writer today is the frost notifier, which records what it has
 * already sent so an add-on restart cannot re-send it. Values are JSON so the
 * shape of a record can grow without another migration.
 *
 * Every read is defensive. This table holds the memory of the notification
 * system, not the garden, and a corrupt or unreadable row must degrade to
 * "I don't remember" rather than take the server down on boot. The worst case
 * of forgetting is one duplicate notification; the worst case of throwing is a
 * garden app that will not start.
 */
import type { Database } from './open.ts';

export function readHaState<T>(db: Database, key: string, fallback: T): T {
  try {
    const row = db.prepare('SELECT value FROM ha_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;

    if (!row) return fallback;

    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function writeHaState(db: Database, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO ha_state (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value));
}

/**
 * Read/write for the `app_state` key/value table.
 *
 * Application bookkeeping that is neither garden data nor a user preference.
 * One key today: when a copy of the garden was last saved to a file.
 *
 * Separate from `ha_state` on purpose. That table is the Home Assistant
 * integration's memory — what the notifier has already sent — and it is read on
 * a timer by code that must not be surprised. Keeping the two apart costs six
 * lines of schema and means neither has to be reasoned about in terms of the
 * other.
 *
 * Every read is defensive, for the same reason `haState.ts` and `settings.ts`
 * are: nothing in here is worth taking a garden server down for. The worst case
 * of forgetting when the last export happened is that the app says "you have
 * never saved a copy" and she saves another one.
 */
import type { Database } from './open.ts';

export function readAppState<T>(db: Database, key: string, fallback: T): T {
  try {
    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;

    if (!row) return fallback;

    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function writeAppState(db: Database, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value));
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
export function readLastExportAt(db: Database): string | null {
  const value = readAppState<unknown>(db, LAST_EXPORT_KEY, null);

  return typeof value === 'string' && value !== '' ? value : null;
}

export function writeLastExportAt(db: Database, at: string): void {
  writeAppState(db, LAST_EXPORT_KEY, at);
}

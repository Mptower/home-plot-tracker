/**
 * The two facts that describe a backup file, kept apart from everything that
 * touches the database so the validator can read them without importing the
 * storage layer.
 *
 * Both are duplicated in `client/src/lib/backup.ts`. That duplication is not an
 * oversight — `server/src` may only take *types* from `@hpt/shared`, because the
 * add-on image ships `server/dist/src` and `client/dist` and no `shared/` at
 * all. A runtime import from that package passes every test on a developer
 * machine and then crashes her add-on on boot with a module-not-found. So each
 * side declares its own copy and `client/test/backup-parity.test.ts` fails if
 * they ever disagree.
 */

/**
 * Identifies a file as ours.
 *
 * Its whole purpose is to let a wrong file be refused **by name** — "this is not
 * a Home Plot Tracker backup" — instead of as a wall of missing-field errors
 * that leaves her unsure whether she picked the wrong file or her garden is
 * corrupt.
 */
export const BACKUP_FORMAT = 'home-plot-tracker.garden';

/**
 * The highest file format this build understands.
 *
 * Bump only when an older build would **misread** a newer file. Adding another
 * optional field is not that: unknown top-level keys are tolerated on the way
 * in, precisely so a future version can add one without stranding a file in an
 * older install that could otherwise have restored it.
 *
 * Deliberately *not* the SQLite migration number that `/api/health` reports as
 * `schemaVersion`. They count different things and have already diverged; two
 * unrelated integers under one name, both on screen while somebody debugs her
 * install, is a support conversation that goes wrong.
 */
export const BACKUP_FORMAT_VERSION = 1;

/** Why a safety copy was taken. One value today. */
export const PRE_RESTORE = 'pre-restore';

import { withTransaction } from "../db/open.js";
import { listBeds, listHarvests, listSeeds } from "../db/collections.js";
import { readSettings } from "../db/settings.js";
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from "./format.js";
export { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, PRE_RESTORE } from "./format.js";
function isScalar(value) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
/**
 * A scalar exactly as `JSON.stringify` would write it.
 *
 * `undefined` becomes `null`, which is what `JSON.stringify` does inside an
 * array. Non-finite numbers become `null` for the same reason. Neither occurs in
 * a validated garden; both are handled so this cannot diverge from the parser
 * that has to read it back.
 */
function scalar(value) {
    return JSON.stringify(value ?? null) ?? 'null';
}
function render(value, indent) {
    if (value === undefined || isScalar(value))
        return scalar(value);
    const next = `${indent}  `;
    if (Array.isArray(value)) {
        if (value.length === 0)
            return '[]';
        // The whole point: a bed's row of varieties and nulls stays one line.
        if (value.every((entry) => entry === undefined || isScalar(entry))) {
            return `[${value.map(scalar).join(', ')}]`;
        }
        const entries = value.map((entry) => `${next}${render(entry, next)}`);
        return `[\n${entries.join(',\n')}\n${indent}]`;
    }
    // `JSON.stringify` drops object keys whose value is `undefined`; so does this.
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    if (entries.length === 0)
        return '{}';
    const lines = entries.map(([key, entry]) => `${next}${JSON.stringify(key)}: ${render(entry, next)}`);
    return `{\n${lines.join(',\n')}\n${indent}}`;
}
/** The document as a file: pretty-printed, with a trailing newline. */
export function prettyJson(value) {
    return `${render(value, '')}\n`;
}
/**
 * Everything the app persists, as one document. **Assumes a transaction is
 * already open** — `buildDocument` is the version that opens one.
 *
 * The split exists because `withTransaction` issues `BEGIN IMMEDIATE`, which
 * SQLite refuses inside an open transaction. A restore has to capture its
 * safety copy inside the same transaction that overwrites the garden, so it
 * needs this half; everything else wants the wrapper.
 *
 * ## What is deliberately not in here
 *
 * - **`SUPERVISOR_TOKEN` and everything in `ha/`.** Never in the database, and
 *   catastrophic in a file she might email to someone.
 * - **The add-on options** `weather_entity`, `notify_service`, `sensor_prefix`.
 *   Install-time plumbing for one particular Home Assistant, not her garden.
 * - **The `ha_state` table.** The frost notifier's memory of what it has already
 *   sent. Restoring it would either re-suppress a warning she needs or re-fire
 *   one she has already acted on.
 * - **The collection version counters.** They describe this server's write
 *   history, not her garden. Restoring them would hand a stale tab a
 *   precondition that matches again — see `restore.ts`.
 *
 * `settings` *is* included: a boolean and two `HH:MM` strings, no credentials.
 * Losing her quiet hours along with her garden would be a second, avoidable
 * loss.
 */
export function readDocument(db, exportedAt) {
    const seeds = listSeeds(db);
    const beds = listBeds(db);
    const harvests = listHarvests(db);
    return {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        exportedAt,
        // Advisory and human-facing only. A restore recomputes from the arrays
        // below and never trusts this, so a hand-edited file cannot lie its way
        // past validation by adjusting a number at the top.
        counts: { seeds: seeds.length, beds: beds.length, harvests: harvests.length },
        seeds,
        beds,
        harvests,
        settings: readSettings(db),
    };
}
/**
 * The whole garden as one document, read atomically.
 *
 * The transaction matters: three separate reads could straddle a write from her
 * phone, and an export that caught seeds before an edit and harvests after it
 * would be a file that never described a real garden.
 */
export function buildDocument(db, exportedAt) {
    return withTransaction(db, () => readDocument(db, exportedAt));
}
/** Counts of what is in the garden right now. Assumes an open transaction. */
export function readCounts(db) {
    return {
        seeds: listSeeds(db).length,
        beds: listBeds(db).length,
        harvests: listHarvests(db).length,
    };
}
/** Counts of what is in the garden right now, read atomically. */
export function currentCounts(db) {
    return withTransaction(db, () => readCounts(db));
}
/** `home-plot-tracker-2026-09-14.json`, from an ISO timestamp. */
export function backupFilename(exportedAt) {
    const day = /^(\d{4}-\d{2}-\d{2})/.exec(exportedAt)?.[1] ?? 'export';
    return `home-plot-tracker-${day}.json`;
}
//# sourceMappingURL=document.js.map
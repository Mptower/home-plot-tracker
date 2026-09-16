import { withTransaction } from "../db/open.js";
import { listBeds, listHarvests, listSeeds, replaceBeds, replaceHarvests, replaceSeeds, } from "../db/collections.js";
import { bumpVersion, readAllVersions } from "../db/versions.js";
import { writeSettings } from "../db/settings.js";
import { insertSafetyCopy } from "../db/snapshots.js";
import { PRE_RESTORE, prettyJson, readCounts, readDocument } from "./document.js";
const COLLECTIONS = ['seeds', 'beds', 'harvests'];
/**
 * Replaces the garden, having first recorded what was there.
 *
 * One `BEGIN IMMEDIATE` covers the safety copy, all three replaces, the
 * settings write and every version bump. SQLite allows a single writer, so a
 * concurrent `PUT /api/seeds` either completes before this starts or waits and
 * then fails its version check. There is no interleaving to reason about and no
 * state in which half a restore is visible: if anything throws, the whole thing
 * rolls back and her garden is exactly as it was, including no safety copy —
 * which is correct, because nothing needed saving from.
 */
export function applyRestore(db, input, now) {
    return withTransaction(db, () => {
        // Captured first, inside the transaction, in the same shape `GET /api/export`
        // emits — so it can be handed back to her as a file with no conversion. A
        // copy that only lives in this database would not survive the uninstall it
        // is partly there to protect against.
        const previous = readDocument(db, now);
        const safetyCopy = insertSafetyCopy(db, {
            takenAt: now,
            reason: PRE_RESTORE,
            counts: readCounts(db),
            document: prettyJson(previous),
        });
        replaceSeeds(db, input.snapshot.seeds);
        replaceBeds(db, input.snapshot.beds);
        replaceHarvests(db, input.snapshot.harvests);
        if (input.settings)
            writeSettings(db, input.settings);
        // Unconditional, including for a collection whose contents did not change.
        // See the note at the top of this file: this is what voids every ETag a
        // second device is holding.
        for (const collection of COLLECTIONS)
            bumpVersion(db, collection);
        return {
            counts: {
                seeds: listSeeds(db).length,
                beds: listBeds(db).length,
                harvests: listHarvests(db).length,
            },
            versions: readAllVersions(db),
            safetyCopy,
            settingsRestored: input.settings !== null,
        };
    });
}
//# sourceMappingURL=restore.js.map
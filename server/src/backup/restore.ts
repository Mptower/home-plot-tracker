/**
 * Applying a backup.
 *
 * ## Replace, not merge
 *
 * A restore replaces the garden. It does not merge.
 *
 * The argument for merging is superficially kind — "surely we should not throw
 * away anything?" — and it is wrong, for a reason that only shows up in the
 * situation restores actually happen in. Merging a file into a live garden
 * produces a third state that exists in neither, and the records most likely to
 * collide are harvests: rows with no natural key, recorded repeatedly for the
 * same crop. A merge that half-matches them leaves her with a season she cannot
 * audit and no way to tell which rows are real. She reaches for a backup when
 * she is already upset; handing back a garden that matches neither the file nor
 * what she had is not a kindness.
 *
 * Replace is also the only thing that can be *described* before it happens.
 * "This will replace your garden with 3 seeds, 2 beds and 14 harvests" is a
 * sentence she can check against the file. There is no equivalent sentence for
 * a merge that does not require her to predict the outcome of a matching
 * algorithm.
 *
 * What makes replace safe is not softening it — it is that it is reversible.
 * Every restore writes a safety copy of the garden as it was, inside the same
 * transaction, and that copy is both listed in the app and downloadable as a
 * file. The dangerous moment is not "replace", it is "replace with no way back".
 *
 * ## Why the version counters are bumped unconditionally
 *
 * This is the subtle part, and the whole reason the ETag machinery has to be
 * reasoned about here rather than left to work itself out.
 *
 * She uses a phone and a laptop. Suppose the laptop has a tab open holding
 * `harvests` at version 4, and she restores an old backup from the phone. If
 * the restored harvests happened to be byte-identical to what was there, a
 * "only bump if something changed" optimisation would leave harvests at version
 * 4 — and the laptop's next save would carry `If-Match: "4"`, match, and be
 * accepted. Her stale pre-restore harvests would go back in, silently, with no
 * conflict and no error. The restore would have been undone by a tab nobody
 * touched.
 *
 * So every collection's version is bumped on every restore, whether or not its
 * contents changed. The bump is not a description of the data; it is an
 * assertion that every previously-issued ETag is now void. After a restore the
 * laptop's save gets a 409 carrying the restored rows, and
 * `client/src/lib/merge.ts` reconciles: rows the restore removed and the laptop
 * never edited stay removed, rows only the restore touched keep the restored
 * value, and a row she genuinely edited on the laptop that the restore deleted
 * becomes an explicit `edited-here-deleted-there` conflict she is asked about.
 * A stale tab can contribute her unsaved edits; it cannot reinstate the garden
 * it was holding. `server/test/backup-restore.test.ts` and
 * `client/test/backup-merge.test.ts` pin all four of those outcomes.
 *
 * The honest limit: there is no push channel. An idle second tab is not told a
 * restore happened. It keeps showing the old garden until it refreshes on focus
 * or she writes something. It displays stale data — it cannot save stale data.
 *
 * ## Why `ha_state` is left alone
 *
 * Traced rather than assumed, because the obvious worry is that restoring
 * tender crops into a night whose frost warning already went out would be
 * silently suppressed. It is not. In `ha/notifier.ts`, `decideNotification`
 * returns `nothing_at_risk` *before* it ever loads the notifier's state, and
 * `recordNotification` only runs after a message is actually sent — so a night
 * evaluated against a garden with nothing tender in it leaves no record behind
 * to suppress anything. Suppression additionally requires the new severity to
 * be no higher than the recorded one, so a restore that raises the stakes
 * re-notifies anyway.
 *
 * The one residual case: if a warning for tonight already went out at some
 * severity and a restore then changes what is planted, she will not get a
 * second warning for that same night at the same or a milder severity. She has
 * already been told it will freeze tonight; the updated variety list arrives on
 * escalation or with tomorrow's warning. That is mild, and strictly better than
 * the alternative of clearing the table and re-alarming her about a night she
 * has already covered her beds for.
 */
import type { CollectionName, GardenSettings, GardenSnapshot } from '@hpt/shared';
import type { Database } from '../db/open.ts';
import { withTransaction } from '../db/open.ts';
import {
  listBeds,
  listHarvests,
  listSeeds,
  replaceBeds,
  replaceHarvests,
  replaceSeeds,
} from '../db/collections.ts';
import { bumpVersion, readAllVersions } from '../db/versions.ts';
import { writeSettings } from '../db/settings.ts';
import { insertSafetyCopy } from '../db/snapshots.ts';
import type { SafetyCopyRecord } from '../db/snapshots.ts';
import { PRE_RESTORE, prettyJson, readCounts, readDocument } from './document.ts';
import type { GardenCounts } from './document.ts';

const COLLECTIONS: readonly CollectionName[] = ['seeds', 'beds', 'harvests'];

export interface RestoreOutcome {
  /**
   * What is in the database **after** the transaction committed, counted by
   * reading it back — never echoed from the file. A restore that reported the
   * file's own numbers would say "14 harvests restored" just as convincingly
   * when it had written nothing at all.
   */
  counts: GardenCounts;
  versions: Record<CollectionName, number>;
  safetyCopy: SafetyCopyRecord;
  settingsRestored: boolean;
}

export interface RestoreInput {
  snapshot: GardenSnapshot;
  settings: GardenSettings | null;
}

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
export function applyRestore(db: Database, input: RestoreInput, now: string): RestoreOutcome {
  return withTransaction(db, (): RestoreOutcome => {
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

    if (input.settings) writeSettings(db, input.settings);

    // Unconditional, including for a collection whose contents did not change.
    // See the note at the top of this file: this is what voids every ETag a
    // second device is holding.
    for (const collection of COLLECTIONS) bumpVersion(db, collection);

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

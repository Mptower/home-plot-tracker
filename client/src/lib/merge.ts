/**
 * Three-way merge for a whole-collection API.
 *
 * The API replaces collections wholesale, which is the right shape for one
 * user's few dozen rows but loses data the moment two devices are in play: the
 * laptop reads at 9am, the phone adds two harvests at 2pm, and the laptop's
 * save replaces the collection with its stale array. The server answers such a
 * write with a 409 rather than accepting it; this is what the client does next.
 *
 * Merging happens per item, keyed by id, against three inputs:
 *
 * - **base** — the collection as it was when this device last read it.
 * - **mine** — what this device wants it to be.
 * - **theirs** — what the server holds now.
 *
 * The rule is that a change is only ever applied by the side that made it. If
 * one side left an item exactly as it found it, the other side's version wins,
 * because "unchanged" carries no intent. Only when both sides changed the same
 * item in different ways is there nothing to infer, and those are handed back as
 * conflicts for the user to settle rather than resolved by coin toss.
 */

export interface Identified {
  id: string;
}

export type MergeConflictReason =
  | 'edited-on-both'
  | 'added-on-both'
  | 'edited-here-deleted-there'
  | 'deleted-here-edited-there';

export interface MergeConflict {
  id: string;
  reason: MergeConflictReason;
  /** Something the user will recognise, e.g. a variety name. */
  label: string;
}

export type MergeSide = 'mine' | 'theirs';
export type MergePreference = 'ask' | MergeSide;

export interface MergeOptions<T> {
  /** Names an item in a conflict message. */
  describe: (item: T) => string;
  /**
   * The user's answer for individual divergent items, keyed by id. Answers are
   * per item rather than per collection: she may well want the weight her phone
   * recorded and the note she typed on the laptop.
   */
  resolutions?: Readonly<Record<string, MergeSide>>;
  /**
   * Fallback for anything `resolutions` does not cover. `ask` reports those
   * items instead of guessing. Either side settles only the divergent items —
   * everything the two sides agree on is still merged, so choosing a side never
   * throws away the other device's unrelated work.
   */
  prefer?: MergePreference;
}

export type MergeResult<T> =
  | { ok: true; merged: T[] }
  | { ok: false; conflicts: MergeConflict[] };

/** Structural equality. Values here are plain JSON, so this stays small. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);

  if (leftKeys.length !== Object.keys(right).length) return false;

  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]),
  );
}

function indexById<T extends Identified>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function mergeCollections<T extends Identified>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  options: MergeOptions<T>,
): MergeResult<T> {
  const prefer = options.prefer ?? 'ask';
  const baseById = indexById(base);
  const mineById = indexById(mine);
  const theirsById = indexById(theirs);

  const kept = new Map<string, T>();
  const conflicts: MergeConflict[] = [];

  function settle(id: string, reason: MergeConflictReason, mineSide: T | undefined, theirSide: T | undefined) {
    const answer = options.resolutions?.[id] ?? prefer;

    if (answer === 'ask') {
      const label = options.describe((mineSide ?? theirSide) as T);
      conflicts.push({ id, reason, label });
      return;
    }

    const winner = answer === 'mine' ? mineSide : theirSide;
    // A missing winner means that side deleted the item, so it stays deleted.
    if (winner) kept.set(id, winner);
  }

  const ids = new Set<string>([...baseById.keys(), ...mineById.keys(), ...theirsById.keys()]);

  for (const id of ids) {
    const original = baseById.get(id);
    const ours = mineById.get(id);
    const theirsItem = theirsById.get(id);

    if (ours && theirsItem) {
      if (deepEqual(ours, theirsItem)) {
        kept.set(id, ours);
      } else if (original && deepEqual(original, ours)) {
        kept.set(id, theirsItem); // Only they touched it.
      } else if (original && deepEqual(original, theirsItem)) {
        kept.set(id, ours); // Only we touched it.
      } else {
        settle(id, original ? 'edited-on-both' : 'added-on-both', ours, theirsItem);
      }
      continue;
    }

    if (ours && !theirsItem) {
      if (!original) {
        kept.set(id, ours); // We added it; they have not seen it yet.
      } else if (deepEqual(original, ours)) {
        continue; // They deleted something we never edited: honour the delete.
      } else {
        settle(id, 'edited-here-deleted-there', ours, undefined);
      }
      continue;
    }

    if (!ours && theirsItem) {
      if (!original) {
        kept.set(id, theirsItem); // They added it.
      } else if (deepEqual(original, theirsItem)) {
        continue; // We deleted something they never edited: honour our delete.
      } else {
        settle(id, 'deleted-here-edited-there', undefined, theirsItem);
      }
      continue;
    }

    // In base and gone from both sides: deleted twice, nothing to keep.
  }

  if (conflicts.length > 0) return { ok: false, conflicts };

  /*
   * Order follows this device's array, because that is the order on screen.
   * Items only the other device has are spliced in after whatever preceded them
   * there, which puts a harvest it prepended at the top of the feed and a bed it
   * appended at the end, exactly as each view expects.
   */
  const merged: T[] = [];

  for (const item of mine) {
    const survivor = kept.get(item.id);
    if (survivor) merged.push(survivor);
  }

  theirs.forEach((item, index) => {
    if (mineById.has(item.id)) return;

    const survivor = kept.get(item.id);
    if (!survivor) return;

    let insertAt = 0;

    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const anchor = merged.findIndex((candidate) => candidate.id === theirs[previous].id);
      if (anchor !== -1) {
        insertAt = anchor + 1;
        break;
      }
    }

    merged.splice(insertAt, 0, survivor);
  });

  return { ok: true, merged };
}

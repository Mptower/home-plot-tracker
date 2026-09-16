/**
 * The safety copies taken on the way into a restore.
 *
 * A restore replaces the whole garden, which is the correct meaning of the word
 * and also the single most destructive thing this app can be asked to do. The
 * mitigation is not to make it less destructive — a merge during recovery
 * duplicates harvests and resurrects rows she deleted — but to make it
 * reversible. Every restore records the garden as it was immediately before,
 * inside the same transaction that overwrites it, so "I restored the wrong
 * file" has an answer.
 *
 * The copy is stored as the same document `GET /api/export` emits. That is what
 * lets it be handed to her as a file with no conversion, and it matters:
 * Supervisor deletes `/data` on uninstall, so a copy that only exists in this
 * database does not survive the disaster it was taken for.
 */
import type { Database } from './open.ts';

/**
 * How many to keep.
 *
 * Enough to undo a restore, then undo the undo, then still have the original —
 * which is the realistic shape of someone recovering under stress. Not
 * unbounded, because each row holds a whole garden and `/data` is a Home
 * Assistant box's disk.
 */
export const MAX_SAFETY_COPIES = 5;

export interface SafetyCopyCounts {
  seeds: number;
  beds: number;
  harvests: number;
}

/**
 * A stored copy, without its payload. What the Settings panel lists.
 *
 * Named `Record` rather than `Summary` so it does not collide with the wire
 * type of the same shape in `@hpt/shared`, which the routes import beside this.
 */
export interface SafetyCopyRecord {
  id: number;
  takenAt: string;
  reason: string;
  counts: SafetyCopyCounts;
}

export interface StoredSafetyCopy extends SafetyCopyRecord {
  /** The pre-restore garden, already rendered as an export document. */
  document: string;
}

function toSummary(row: Record<string, unknown>): SafetyCopyRecord {
  return {
    id: Number(row.id),
    takenAt: String(row.taken_at),
    reason: String(row.reason),
    counts: {
      seeds: Number(row.seed_count),
      beds: Number(row.bed_count),
      harvests: Number(row.harvest_count),
    },
  };
}

/**
 * Records a copy and prunes the oldest away.
 *
 * Caller must already be inside the restore's transaction: a copy that commits
 * separately from the overwrite it protects could exist without the overwrite,
 * or — far worse — the overwrite could exist without it.
 */
export function insertSafetyCopy(
  db: Database,
  copy: { takenAt: string; reason: string; counts: SafetyCopyCounts; document: string },
): SafetyCopyRecord {
  const row = db
    .prepare(
      `INSERT INTO garden_snapshots
         (taken_at, reason, seed_count, bed_count, harvest_count, document)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id, taken_at, reason, seed_count, bed_count, harvest_count`,
    )
    .get(
      copy.takenAt,
      copy.reason,
      copy.counts.seeds,
      copy.counts.beds,
      copy.counts.harvests,
      copy.document,
    ) as Record<string, unknown>;

  // Pruned by id rather than by `taken_at`: ids are monotonic and unique, so two
  // copies taken inside the same second cannot confuse "which is older".
  db.prepare(
    `DELETE FROM garden_snapshots
      WHERE id NOT IN (SELECT id FROM garden_snapshots ORDER BY id DESC LIMIT ?)`,
  ).run(MAX_SAFETY_COPIES);

  return toSummary(row);
}

/** Newest first, because that is the one she almost certainly wants. */
export function listSafetyCopies(db: Database): SafetyCopyRecord[] {
  const rows = db
    .prepare(
      `SELECT id, taken_at, reason, seed_count, bed_count, harvest_count
         FROM garden_snapshots ORDER BY id DESC`,
    )
    .all() as Record<string, unknown>[];

  return rows.map(toSummary);
}

export function readSafetyCopy(db: Database, id: number): StoredSafetyCopy | null {
  const row = db
    .prepare(
      `SELECT id, taken_at, reason, seed_count, bed_count, harvest_count, document
         FROM garden_snapshots WHERE id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!row) return null;

  return { ...toSummary(row), document: String(row.document) };
}

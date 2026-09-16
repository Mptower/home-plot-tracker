/**
 * How many to keep.
 *
 * Enough to undo a restore, then undo the undo, then still have the original —
 * which is the realistic shape of someone recovering under stress. Not
 * unbounded, because each row holds a whole garden and `/data` is a Home
 * Assistant box's disk.
 */
export const MAX_SAFETY_COPIES = 5;
function toSummary(row) {
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
export function insertSafetyCopy(db, copy) {
    const row = db
        .prepare(`INSERT INTO garden_snapshots
         (taken_at, reason, seed_count, bed_count, harvest_count, document)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id, taken_at, reason, seed_count, bed_count, harvest_count`)
        .get(copy.takenAt, copy.reason, copy.counts.seeds, copy.counts.beds, copy.counts.harvests, copy.document);
    // Pruned by id rather than by `taken_at`: ids are monotonic and unique, so two
    // copies taken inside the same second cannot confuse "which is older".
    db.prepare(`DELETE FROM garden_snapshots
      WHERE id NOT IN (SELECT id FROM garden_snapshots ORDER BY id DESC LIMIT ?)`).run(MAX_SAFETY_COPIES);
    return toSummary(row);
}
/** Newest first, because that is the one she almost certainly wants. */
export function listSafetyCopies(db) {
    const rows = db
        .prepare(`SELECT id, taken_at, reason, seed_count, bed_count, harvest_count
         FROM garden_snapshots ORDER BY id DESC`)
        .all();
    return rows.map(toSummary);
}
export function readSafetyCopy(db, id) {
    const row = db
        .prepare(`SELECT id, taken_at, reason, seed_count, bed_count, harvest_count, document
         FROM garden_snapshots WHERE id = ?`)
        .get(id);
    if (!row)
        return null;
    return { ...toSummary(row), document: String(row.document) };
}
//# sourceMappingURL=snapshots.js.map
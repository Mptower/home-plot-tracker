/**
 * Read and replace whole collections.
 *
 * There is no per-item CRUD on purpose. The client owns each collection as a
 * single array behind a `(data, setData)` pair, so the storage layer speaks the
 * same language: hand it the array you want persisted and it makes the table
 * match. Single user, three small collections — the simplicity is worth far more
 * than the bytes a diff would save.
 */
import type { GardenBed, HarvestLog, SeedPacket } from '@hpt/shared';
import type { Database } from './open.ts';

function readLayout(id: string, raw: unknown): (string | null)[][] {
  try {
    return JSON.parse(String(raw)) as (string | null)[][];
  } catch (error) {
    throw new Error(`Bed ${id} has a corrupt layout column`, { cause: error });
  }
}

export function listSeeds(db: Database): SeedPacket[] {
  const rows = db
    .prepare(
      'SELECT id, category, variety, brand, purchase_year, notes FROM seeds ORDER BY position',
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    category: String(row.category),
    variety: String(row.variety),
    brand: String(row.brand),
    purchaseYear: Number(row.purchase_year),
    notes: String(row.notes),
  }));
}

export function replaceSeeds(db: Database, seeds: readonly SeedPacket[]): void {
  db.exec('DELETE FROM seeds');

  const insert = db.prepare(
    `INSERT INTO seeds (id, category, variety, brand, purchase_year, notes, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  seeds.forEach((seed, position) => {
    insert.run(
      seed.id,
      seed.category,
      seed.variety,
      seed.brand,
      seed.purchaseYear,
      seed.notes,
      position,
    );
  });
}

export function listBeds(db: Database): GardenBed[] {
  const rows = db
    .prepare(
      `SELECT id, name, "rows", "columns", layout, last_year_category
       FROM beds ORDER BY position`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    rows: Number(row.rows),
    columns: Number(row.columns),
    layout: readLayout(String(row.id), row.layout),
    lastYearCategory: String(row.last_year_category),
  }));
}

export function replaceBeds(db: Database, beds: readonly GardenBed[]): void {
  db.exec('DELETE FROM beds');

  const insert = db.prepare(
    `INSERT INTO beds (id, name, "rows", "columns", layout, last_year_category, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  beds.forEach((bed, position) => {
    insert.run(
      bed.id,
      bed.name,
      bed.rows,
      bed.columns,
      JSON.stringify(bed.layout),
      bed.lastYearCategory,
      position,
    );
  });
}

export function listHarvests(db: Database): HarvestLog[] {
  const rows = db
    .prepare('SELECT id, date, variety, weight_lbs, "count" FROM harvests ORDER BY position')
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    date: String(row.date),
    variety: String(row.variety),
    weightLbs: Number(row.weight_lbs),
    count: Number(row.count),
  }));
}

export function replaceHarvests(db: Database, harvests: readonly HarvestLog[]): void {
  db.exec('DELETE FROM harvests');

  const insert = db.prepare(
    `INSERT INTO harvests (id, date, variety, weight_lbs, "count", position)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  harvests.forEach((harvest, position) => {
    insert.run(
      harvest.id,
      harvest.date,
      harvest.variety,
      harvest.weightLbs,
      harvest.count,
      position,
    );
  });
}

/**
 * Pure helpers behind the Bed Planner: variety -> category resolution, the
 * category colour scale, immutable layout edits and crop-rotation conflict
 * detection. Nothing here touches React or storage so it stays easy to reason
 * about and to test.
 */
import type { GardenBed, SeedPacket } from '../types';

/** Sentinel for "no crop family recorded for last season". */
export const NO_CATEGORY = '';

/** Smallest and largest bed dimension the planner will accept. */
export const MIN_BED_DIMENSION = 1;
export const MAX_BED_DIMENSION = 12;

export interface CategoryStyle {
  /** Border, fill, text and hover classes for a planted grid cell. */
  cell: string;
  /** Solid dot used in the legend. */
  swatch: string;
  /** Pill treatment for category labels in lists and filters. */
  chip: string;
}

/**
 * Full class strings are written out literally so Tailwind's scanner keeps
 * them in the build — never assemble these from fragments.
 */
const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  Nightshade: {
    cell: 'border-rose-300 bg-rose-100 text-rose-900 hover:bg-rose-200',
    swatch: 'bg-rose-400',
    chip: 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-300',
  },
  Cucurbit: {
    cell: 'border-yellow-300 bg-yellow-100 text-yellow-900 hover:bg-yellow-200',
    swatch: 'bg-yellow-400',
    chip: 'bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-300',
  },
  Brassica: {
    cell: 'border-teal-300 bg-teal-100 text-teal-900 hover:bg-teal-200',
    swatch: 'bg-teal-400',
    chip: 'bg-teal-100 text-teal-800 ring-1 ring-inset ring-teal-300',
  },
  Allium: {
    cell: 'border-violet-300 bg-violet-100 text-violet-900 hover:bg-violet-200',
    swatch: 'bg-violet-400',
    chip: 'bg-violet-100 text-violet-800 ring-1 ring-inset ring-violet-300',
  },
  Legume: {
    cell: 'border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200',
    swatch: 'bg-emerald-400',
    chip: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300',
  },
  Root: {
    cell: 'border-orange-300 bg-orange-100 text-orange-900 hover:bg-orange-200',
    swatch: 'bg-orange-400',
    chip: 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-300',
  },
  'Leafy Green': {
    cell: 'border-green-300 bg-green-100 text-green-900 hover:bg-green-200',
    swatch: 'bg-green-400',
    chip: 'bg-green-100 text-green-800 ring-1 ring-inset ring-green-300',
  },
  Herb: {
    cell: 'border-sky-300 bg-sky-100 text-sky-900 hover:bg-sky-200',
    swatch: 'bg-sky-400',
    chip: 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-300',
  },
};

/** Used for plantings whose variety is no longer in the vault. */
export const UNKNOWN_CATEGORY_STYLE: CategoryStyle = {
  cell: 'border-stone-300 bg-stone-100 text-stone-700 hover:bg-stone-200',
  swatch: 'bg-stone-400',
  chip: 'bg-stone-100 text-stone-700 ring-1 ring-inset ring-stone-300',
};

export function getCategoryStyle(category: string | null): CategoryStyle {
  if (!category) return UNKNOWN_CATEGORY_STYLE;
  return CATEGORY_STYLES[category] ?? UNKNOWN_CATEGORY_STYLE;
}

/** Label shown when a planted variety has no matching packet in the vault. */
export const UNKNOWN_CATEGORY_LABEL = 'Uncatalogued';

export function categoryLabel(category: string | null): string {
  return category ?? UNKNOWN_CATEGORY_LABEL;
}

/** Every category in this app pluralises with a plain `s`. */
export function pluralizeCategory(category: string): string {
  return `${category}s`;
}

export type CategoryLookup = (variety: string | null) => string | null;

/** Indexes the vault by variety name so cell colouring is a map hit, not a scan. */
export function buildCategoryLookup(seeds: SeedPacket[]): CategoryLookup {
  const byVariety = new Map<string, string>();
  for (const seed of seeds) {
    byVariety.set(seed.variety, seed.category);
  }

  return (variety) => (variety ? byVariety.get(variety) ?? null : null);
}

export function clampDimension(value: number): number {
  if (!Number.isFinite(value)) return MIN_BED_DIMENSION;
  return Math.min(MAX_BED_DIMENSION, Math.max(MIN_BED_DIMENSION, Math.round(value)));
}

export function createEmptyLayout(rows: number, columns: number): (string | null)[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => null),
  );
}

/**
 * Reshapes a layout to exactly `rows` x `columns`, keeping any plantings that
 * still fit. Guards the grid against hand-edited or truncated stored state.
 */
export function normalizeLayout(
  layout: (string | null)[][],
  rows: number,
  columns: number,
): (string | null)[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => layout[row]?.[column] ?? null),
  );
}

/** Returns a new beds array with a single cell of a single bed replaced. */
export function plantCell(
  beds: GardenBed[],
  bedId: string,
  row: number,
  column: number,
  variety: string | null,
): GardenBed[] {
  return beds.map((bed) => {
    if (bed.id !== bedId) return bed;

    const layout = normalizeLayout(bed.layout, bed.rows, bed.columns).map(
      (layoutRow, rowIndex) =>
        rowIndex === row
          ? layoutRow.map((cell, columnIndex) => (columnIndex === column ? variety : cell))
          : layoutRow,
    );

    return { ...bed, layout };
  });
}

export interface ConflictCell {
  row: number;
  column: number;
  variety: string;
}

export function cellKey(row: number, column: number): string {
  return `${row}-${column}`;
}

/**
 * A square conflicts when the family planted in it is the same family the bed
 * grew last season. Advisory only — planting is never blocked.
 */
export function findRotationConflicts(bed: GardenBed, categoryOf: CategoryLookup): ConflictCell[] {
  if (!bed.lastYearCategory) return [];

  const conflicts: ConflictCell[] = [];
  const layout = normalizeLayout(bed.layout, bed.rows, bed.columns);

  layout.forEach((layoutRow, row) => {
    layoutRow.forEach((variety, column) => {
      if (variety && categoryOf(variety) === bed.lastYearCategory) {
        conflicts.push({ row, column, variety });
      }
    });
  });

  return conflicts;
}

/** Stable signature of the current conflict set, used to re-arm the warning. */
export function conflictSignature(bed: GardenBed | null, conflicts: ConflictCell[]): string {
  if (!bed) return '';
  return `${bed.id}:${conflicts.map((conflict) => cellKey(conflict.row, conflict.column)).join(',')}`;
}

export function countPlanted(bed: GardenBed): number {
  return normalizeLayout(bed.layout, bed.rows, bed.columns).reduce(
    (total, row) => total + row.filter((cell) => cell !== null).length,
    0,
  );
}

export interface PlantingTally {
  variety: string;
  category: string | null;
  count: number;
}

/** What is currently in the bed, most-planted first, then alphabetical. */
export function tallyPlantings(bed: GardenBed, categoryOf: CategoryLookup): PlantingTally[] {
  const counts = new Map<string, number>();

  for (const row of normalizeLayout(bed.layout, bed.rows, bed.columns)) {
    for (const variety of row) {
      if (variety) counts.set(variety, (counts.get(variety) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([variety, count]) => ({ variety, category: categoryOf(variety), count }))
    .sort((a, b) => b.count - a.count || a.variety.localeCompare(b.variety));
}

/** Distinct categories present in a bed, ordered for a stable legend. */
export function legendCategories(tallies: PlantingTally[]): (string | null)[] {
  const seen = new Set<string>();
  const categories: (string | null)[] = [];

  for (const tally of tallies) {
    const key = tally.category ?? UNKNOWN_CATEGORY_LABEL;
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(tally.category);
  }

  return categories;
}

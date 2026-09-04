/**
 * The single source of truth for crop-family colour across the app, so a
 * category reads the same in a Seed Vault badge, a Bed Planner square, a legend
 * dot and a picker chip.
 *
 * Three hues are deliberately absent from this palette because they carry
 * meaning elsewhere and would be ambiguous sitting next to a category:
 * emerald (primary chrome and the active/hover state of a bed square), amber
 * (crop-rotation warnings) and rose (a stale seed packet).
 *
 * Every class string below is written out in full. Tailwind scans source text
 * literally, so a fragment like `bg-${hue}-100` is never emitted into the
 * stylesheet and the colour silently disappears from a production build.
 */

export interface CategoryStyle {
  /** Border, fill, text and hover classes for a planted grid cell. */
  cell: string;
  /** Solid dot used in legends. */
  swatch: string;
  /** Pill treatment for category labels in lists and filters. */
  chip: string;
  /** Lighter pill used on Seed Vault cards. */
  badge: string;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  Nightshade: {
    cell: 'border-purple-300 bg-purple-100 text-purple-900 hover:bg-purple-200',
    swatch: 'bg-purple-400',
    chip: 'bg-purple-100 text-purple-800 ring-1 ring-inset ring-purple-300',
    badge: 'bg-purple-50 text-purple-700 ring-purple-200',
  },
  Cucurbit: {
    cell: 'border-lime-300 bg-lime-100 text-lime-900 hover:bg-lime-200',
    swatch: 'bg-lime-400',
    chip: 'bg-lime-100 text-lime-800 ring-1 ring-inset ring-lime-300',
    badge: 'bg-lime-50 text-lime-700 ring-lime-200',
  },
  Brassica: {
    cell: 'border-teal-300 bg-teal-100 text-teal-900 hover:bg-teal-200',
    swatch: 'bg-teal-400',
    chip: 'bg-teal-100 text-teal-800 ring-1 ring-inset ring-teal-300',
    badge: 'bg-teal-50 text-teal-700 ring-teal-200',
  },
  Allium: {
    cell: 'border-violet-300 bg-violet-100 text-violet-900 hover:bg-violet-200',
    swatch: 'bg-violet-400',
    chip: 'bg-violet-100 text-violet-800 ring-1 ring-inset ring-violet-300',
    badge: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  Legume: {
    cell: 'border-cyan-300 bg-cyan-100 text-cyan-900 hover:bg-cyan-200',
    swatch: 'bg-cyan-400',
    chip: 'bg-cyan-100 text-cyan-800 ring-1 ring-inset ring-cyan-300',
    badge: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  },
  Root: {
    cell: 'border-orange-300 bg-orange-100 text-orange-900 hover:bg-orange-200',
    swatch: 'bg-orange-400',
    chip: 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-300',
    badge: 'bg-orange-50 text-orange-700 ring-orange-200',
  },
  'Leafy Green': {
    cell: 'border-green-300 bg-green-100 text-green-900 hover:bg-green-200',
    swatch: 'bg-green-400',
    chip: 'bg-green-100 text-green-800 ring-1 ring-inset ring-green-300',
    badge: 'bg-green-50 text-green-700 ring-green-200',
  },
  Herb: {
    cell: 'border-sky-300 bg-sky-100 text-sky-900 hover:bg-sky-200',
    swatch: 'bg-sky-400',
    chip: 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-300',
    badge: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
};

/** Used for plantings whose variety is no longer in the vault. */
export const UNKNOWN_CATEGORY_STYLE: CategoryStyle = {
  cell: 'border-stone-300 bg-stone-100 text-stone-700 hover:bg-stone-200',
  swatch: 'bg-stone-400',
  chip: 'bg-stone-100 text-stone-700 ring-1 ring-inset ring-stone-300',
  badge: 'bg-stone-100 text-stone-600 ring-stone-200',
};

export function getCategoryStyle(category: string | null): CategoryStyle {
  if (!category) return UNKNOWN_CATEGORY_STYLE;
  return CATEGORY_STYLES[category] ?? UNKNOWN_CATEGORY_STYLE;
}

export function getCategoryBadgeClasses(category: string): string {
  return getCategoryStyle(category).badge;
}

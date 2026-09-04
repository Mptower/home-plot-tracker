import type { GerminationStatus } from '../../lib/germination';

export interface StatusTheme {
  /** Accent applied to the whole card, used to flag stale packets while scanning. */
  card: string;
  /** Fill of the germination bar. */
  bar: string;
  /** Colour of the germination percentage. */
  value: string;
  /** Pill used for the age/advice line. */
  pill: string;
  shortLabel: string;
}

export const STATUS_THEME: Record<GerminationStatus, StatusTheme> = {
  fresh: {
    card: 'border-stone-200',
    bar: 'bg-emerald-500',
    value: 'text-emerald-700',
    pill: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    shortLabel: 'Fresh',
  },
  aging: {
    card: 'border-stone-200',
    bar: 'bg-amber-500',
    value: 'text-amber-700',
    pill: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    shortLabel: 'Aging',
  },
  stale: {
    card: 'border-stone-200 border-l-4 border-l-rose-500',
    bar: 'bg-rose-500',
    value: 'text-rose-700',
    pill: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
    shortLabel: 'Replace',
  },
};

/**
 * Soft, garden-ish tints so categories are distinguishable at a glance without
 * competing with the emerald/amber/stone chrome the rest of the app uses.
 */
const CATEGORY_BADGE: Record<string, string> = {
  Nightshade: 'bg-rose-50 text-rose-700 ring-rose-200',
  Cucurbit: 'bg-lime-50 text-lime-700 ring-lime-200',
  Brassica: 'bg-teal-50 text-teal-700 ring-teal-200',
  Allium: 'bg-violet-50 text-violet-700 ring-violet-200',
  Legume: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Root: 'bg-orange-50 text-orange-700 ring-orange-200',
  'Leafy Green': 'bg-green-50 text-green-700 ring-green-200',
  Herb: 'bg-sky-50 text-sky-700 ring-sky-200',
};

const FALLBACK_CATEGORY_BADGE = 'bg-stone-100 text-stone-600 ring-stone-200';

export function getCategoryBadgeClasses(category: string): string {
  return CATEGORY_BADGE[category] ?? FALLBACK_CATEGORY_BADGE;
}

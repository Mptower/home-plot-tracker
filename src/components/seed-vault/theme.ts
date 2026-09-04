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

/** Category colour is shared with the Bed Planner so a family reads the same everywhere. */
export { getCategoryBadgeClasses } from '../../lib/categoryTheme';

import { useId } from 'react';
import { Calendar, Scale, Search } from 'lucide-react';
import type { HarvestDay } from '../../lib/harvest';
import { formatItems, formatWeight } from '../../lib/harvest';
import { HarvestRow } from './HarvestRow';

export interface HarvestFeedProps {
  days: HarvestDay[];
  query: string;
  onQueryChange: (value: string) => void;
  onDelete: (id: string) => void;
  /** Entries before the search filter is applied, used to pick the empty state. */
  totalEntries: number;
  /** Entries left after filtering. */
  matchCount: number;
}

/** Chronological feed, newest picking day first, grouped under sticky headers. */
export function HarvestFeed({
  days,
  query,
  onQueryChange,
  onDelete,
  totalEntries,
  matchCount,
}: HarvestFeedProps) {
  const searchId = useId();
  const hasEntries = totalEntries > 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-stone-900">Harvest history</h3>
          <p className="text-sm text-stone-500">
            {hasEntries
              ? `${matchCount} ${matchCount === 1 ? 'entry' : 'entries'} across ${days.length} ${
                  days.length === 1 ? 'day' : 'days'
                }`
              : 'Nothing picked yet this season.'}
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <label className="sr-only" htmlFor={searchId}>
            Search harvests by variety
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
            aria-hidden="true"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search variety"
            disabled={!hasEntries}
            className="w-full rounded-xl border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm text-stone-900 shadow-sm transition-colors placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-not-allowed disabled:bg-stone-100"
          />
        </div>
      </div>

      {days.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            {hasEntries ? (
              <Search className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Scale className="h-6 w-6" aria-hidden="true" />
            )}
          </span>
          <h4 className="mt-4 text-base font-semibold text-stone-900">
            {hasEntries ? `No harvests match “${query.trim()}”` : 'No harvests logged yet'}
          </h4>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            {hasEntries
              ? 'Try a shorter search, or clear it to see the whole season.'
              : 'Weigh your first pick and add it with the form — totals and daily subtotals build themselves from there.'}
          </p>
          {hasEntries && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <article
              key={day.date}
              className="rounded-2xl border border-stone-200 bg-white shadow-sm"
            >
              <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-t-2xl border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
                <h4 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-stone-900">
                  <Calendar className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span className="truncate">{day.label}</span>
                </h4>
                <p className="shrink-0 text-xs font-semibold tabular-nums text-stone-500">
                  {formatWeight(day.totalWeightLbs)} · {formatItems(day.totalCount)}
                </p>
              </header>

              <ul className="divide-y divide-stone-100">
                {day.entries.map((entry) => (
                  <HarvestRow key={entry.id} entry={entry} onDelete={onDelete} />
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

import { TrendingUp } from 'lucide-react';
import type { HarvestTotals } from '../../lib/harvest';
import { formatCount, formatWeight, formatWeightValue } from '../../lib/harvest';

export interface HarvestSummaryProps {
  totals: HarvestTotals;
  /** Reflects the active search so the strip explains what it is measuring. */
  isFiltered: boolean;
}

/** How many varieties get a bar before the list is truncated. */
const BAR_LIMIT = 4;

/** Season strip: headline totals plus a pure-CSS weight breakdown by variety. */
export function HarvestSummary({ totals, isFiltered }: HarvestSummaryProps) {
  const leaderWeight = totals.topVariety?.totalWeightLbs ?? 0;
  const bars = totals.varietyTotals.filter((total) => total.totalWeightLbs > 0).slice(0, BAR_LIMIT);

  const stats = [
    { id: 'weight', label: 'Total lbs', value: formatWeightValue(totals.totalWeightLbs) },
    { id: 'count', label: 'Items picked', value: formatCount(totals.totalCount) },
    { id: 'days', label: 'Logged days', value: formatCount(totals.dayCount) },
    { id: 'top', label: 'Top variety', value: totals.topVariety?.variety ?? '—' },
  ];

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <TrendingUp className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-stone-900">
            {isFiltered ? 'Matching harvests' : 'Season so far'}
          </h3>
          <p className="text-sm text-stone-500">
            {isFiltered
              ? 'Totals cover the varieties matching your search.'
              : 'Everything you have weighed and counted this year.'}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2.5">
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {stat.label}
            </dt>
            <dd className="mt-1 truncate text-lg font-bold tabular-nums text-emerald-700">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {bars.length > 0 && (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Weight by variety
          </h4>
          <ul className="mt-3 space-y-2.5">
            {bars.map((total) => {
              const width = leaderWeight > 0 ? (total.totalWeightLbs / leaderWeight) * 100 : 0;

              return (
                <li key={total.variety}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-stone-700">
                      {total.variety}
                    </span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-stone-500">
                      {formatWeight(total.totalWeightLbs)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${width}%` }}
                      aria-hidden="true"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

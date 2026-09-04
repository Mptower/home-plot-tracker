import { Leaf, RefreshCw, Ruler } from 'lucide-react';
import type { GardenBed } from '../../types';
import type { PlantingTally } from '../../lib/rotation';
import { categoryLabel, getCategoryStyle, legendCategories } from '../../lib/rotation';

export interface BedContextPanelProps {
  bed: GardenBed;
  tallies: PlantingTally[];
  plantedCount: number;
  conflictCount: number;
}

/** At-a-glance detail for the selected bed, shown beside the grid. */
export function BedContextPanel({
  bed,
  tallies,
  plantedCount,
  conflictCount,
}: BedContextPanelProps) {
  const totalSquares = bed.rows * bed.columns;
  const filledPercent = totalSquares === 0 ? 0 : Math.round((plantedCount / totalSquares) * 100);
  const categories = legendCategories(tallies);
  const lastYearStyle = getCategoryStyle(bed.lastYearCategory || null);

  return (
    <aside className="space-y-4" aria-label={`Details for ${bed.name}`}>
      <section className="rounded-2xl border border-panel-edge bg-panel p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          <Ruler className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Bed details
        </h3>

        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-stone-500">Dimensions</dt>
            <dd className="font-semibold tabular-nums text-stone-900">
              {bed.rows} × {bed.columns}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-stone-500">Squares planted</dt>
            <dd className="font-semibold tabular-nums text-emerald-700">
              {plantedCount}/{totalSquares}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-stone-500">Rotation flags</dt>
            <dd
              className={`font-semibold tabular-nums ${conflictCount > 0 ? 'text-amber-700' : 'text-stone-900'}`}
            >
              {conflictCount}
            </dd>
          </div>
        </dl>

        <div
          className="mt-4 h-2 w-full overflow-hidden rounded-full bg-panel-sunken"
          role="progressbar"
          aria-valuenow={filledPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Share of squares planted"
        >
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${filledPercent}%` }} />
        </div>
        <p className="mt-2 text-xs text-stone-500">{filledPercent}% of this bed is planted.</p>
      </section>

      <section className="rounded-2xl border border-panel-edge bg-panel p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          <RefreshCw className="h-4 w-4 text-amber-600" aria-hidden="true" />
          Last year here
        </h3>
        {bed.lastYearCategory ? (
          <p className="mt-3 text-sm text-stone-600">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${lastYearStyle.chip}`}
            >
              {bed.lastYearCategory}
            </span>{' '}
            grew in this bed last season.
          </p>
        ) : (
          <p className="mt-3 text-sm text-stone-500">
            Nothing recorded — this bed is treated as new ground, so no rotation flags apply.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-panel-edge bg-panel p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          <Leaf className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Planted right now
        </h3>

        {tallies.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            Nothing in the ground yet. Pick a square to drop in a variety from the vault.
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-2">
              {tallies.map((tally) => {
                const style = getCategoryStyle(tally.category);
                const isConflict = tally.category !== null && tally.category === bed.lastYearCategory;

                return (
                  <li key={tally.variety} className="flex items-center gap-3">
                    <span
                      className={`h-3 w-3 shrink-0 rounded-full ${style.swatch}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-stone-900">
                        {tally.variety}
                      </span>
                      <span
                        className={`block truncate text-xs ${isConflict ? 'text-amber-700' : 'text-stone-500'}`}
                      >
                        {categoryLabel(tally.category)}
                        {isConflict ? ' · same family as last year' : ''}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-panel-sunken px-2 py-0.5 text-xs font-semibold tabular-nums text-stone-700">
                      {tally.count}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 border-t border-panel-edge pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Legend
              </h4>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {categories.map((category) => (
                  <li key={categoryLabel(category)}>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${getCategoryStyle(category).chip}`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${getCategoryStyle(category).swatch}`}
                        aria-hidden="true"
                      />
                      {categoryLabel(category)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>
    </aside>
  );
}

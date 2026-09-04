import { useId } from 'react';
import { Search, X } from 'lucide-react';

/** Sentinel value for the "show every category" filter chip. */
export const ALL_CATEGORIES = 'All';

export interface SeedFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  /** Categories actually present in the vault, in display order. */
  categories: string[];
}

export function SeedFilters({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  categories,
}: SeedFiltersProps) {
  const searchId = useId();
  const chips = [ALL_CATEGORIES, ...categories];

  return (
    <section
      aria-label="Filter seed packets"
      className="rounded-2xl border border-panel-edge bg-panel p-4 shadow-sm sm:p-5"
    >
      <label htmlFor={searchId} className="sr-only">
        Search packets by variety, brand or notes
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
          aria-hidden="true"
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search variety, brand or notes…"
          className="w-full rounded-xl border border-panel-edge bg-panel-sunken py-2.5 pl-9 pr-10 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:bg-panel focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        />
        {query !== '' && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-panel-sunken hover:text-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((chip) => {
          const isActive = chip === category;

          return (
            <button
              key={chip}
              type="button"
              onClick={() => onCategoryChange(chip)}
              aria-pressed={isActive}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
                  : 'bg-panel-sunken text-stone-600 hover:bg-panel-edge hover:text-stone-900'
              }`}
            >
              {chip}
            </button>
          );
        })}
      </div>
    </section>
  );
}

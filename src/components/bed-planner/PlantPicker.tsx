import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AlertTriangle, Check, Search, Sprout, Trash2, X } from 'lucide-react';
import type { SeedPacket } from '../../types';
import { SEED_CATEGORIES } from '../../types';
import { getCategoryStyle } from '../../lib/rotation';

export interface PlantPickerProps {
  bedName: string;
  row: number;
  column: number;
  currentVariety: string | null;
  lastYearCategory: string;
  seeds: SeedPacket[];
  onAssign: (variety: string | null) => void;
  onClose: () => void;
}

interface CategoryGroup {
  category: string;
  packets: SeedPacket[];
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input, [href], select, textarea, [tabindex]:not([tabindex="-1"])';

const ALL_CATEGORIES = '__all__';

function orderCategories(categories: string[]): string[] {
  const canonical = SEED_CATEGORIES.filter((category) => categories.includes(category));
  const extras = categories.filter((category) => !SEED_CATEGORIES.includes(category)).sort();
  return [...canonical, ...extras];
}

/** Modal for assigning (or clearing) the variety in a single square. */
export function PlantPicker({
  bedName,
  row,
  column,
  currentVariety,
  lastYearCategory,
  seeds,
  onAssign,
  onClose,
}: PlantPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();

    return () => previouslyFocused?.focus();
  }, []);

  const availableCategories = useMemo(
    () => orderCategories([...new Set(seeds.map((seed) => seed.category))]),
    [seeds],
  );

  const groups = useMemo<CategoryGroup[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = seeds.filter((seed) => {
      const matchesCategory = categoryFilter === ALL_CATEGORIES || seed.category === categoryFilter;
      const matchesQuery =
        needle === '' ||
        seed.variety.toLowerCase().includes(needle) ||
        seed.category.toLowerCase().includes(needle) ||
        seed.brand.toLowerCase().includes(needle);

      return matchesCategory && matchesQuery;
    });

    const byCategory = new Map<string, SeedPacket[]>();
    for (const seed of matches) {
      const bucket = byCategory.get(seed.category);
      if (bucket) bucket.push(seed);
      else byCategory.set(seed.category, [seed]);
    }

    return orderCategories([...byCategory.keys()]).map((category) => ({
      category,
      packets: [...(byCategory.get(category) ?? [])].sort((a, b) =>
        a.variety.localeCompare(b.variety),
      ),
    }));
  }, [seeds, query, categoryFilter]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !panelRef.current) return;

    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-stone-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plant-picker-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-stone-200 bg-white shadow-xl sm:rounded-3xl"
      >
        <div className="flex items-start gap-3 border-b border-stone-200 px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Sprout className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="plant-picker-title" className="text-base font-semibold text-stone-900">
              Plant row {row + 1}, column {column + 1}
            </h3>
            <p className="mt-0.5 truncate text-xs text-stone-500">
              {bedName} · {currentVariety ? `Currently ${currentVariety}` : 'Currently empty'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close plant picker"
            className="shrink-0 rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3 border-b border-stone-200 px-5 py-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search varieties, brands or families"
              aria-label="Search varieties"
              className="w-full rounded-xl border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              label="All"
              isActive={categoryFilter === ALL_CATEGORIES}
              onClick={() => setCategoryFilter(ALL_CATEGORIES)}
            />
            {availableCategories.map((category) => (
              <FilterChip
                key={category}
                label={category}
                isActive={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
              />
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {groups.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">
              {seeds.length === 0
                ? 'No varieties in the vault yet. Add a packet in the Seed Vault to plant it here.'
                : 'No varieties match that search.'}
            </p>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => {
                const style = getCategoryStyle(group.category);
                const isLastYear = group.category === lastYearCategory;

                return (
                  <section key={group.category}>
                    <h4 className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      <span className={`h-2.5 w-2.5 rounded-full ${style.swatch}`} aria-hidden="true" />
                      {group.category}
                      {isLastYear && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-800">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          Grown here last year
                        </span>
                      )}
                    </h4>

                    <ul className="mt-2 space-y-1.5">
                      {group.packets.map((packet) => {
                        const isCurrent = packet.variety === currentVariety;

                        return (
                          <li key={packet.id}>
                            <button
                              type="button"
                              onClick={() => onAssign(packet.variety)}
                              className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                                isCurrent
                                  ? 'border-emerald-500 bg-emerald-50'
                                  : 'border-stone-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60'
                              }`}
                            >
                              <span className={`h-8 w-8 shrink-0 rounded-lg ${style.swatch}`} aria-hidden="true" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-stone-900">
                                  {packet.variety}
                                </span>
                                <span className="block truncate text-xs text-stone-500">
                                  {packet.brand} · {packet.purchaseYear}
                                </span>
                              </span>
                              {isCurrent && (
                                <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-stone-200 px-5 py-4">
          <button
            type="button"
            onClick={() => onAssign(null)}
            disabled={currentVariety === null}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-stone-300 disabled:hover:bg-white disabled:hover:text-stone-700"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Clear this square
          </button>
        </div>
      </div>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function FilterChip({ label, isActive, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
        isActive
          ? 'bg-emerald-600 text-white'
          : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900'
      }`}
    >
      {label}
    </button>
  );
}

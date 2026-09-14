import { useMemo, useState } from 'react';
import { AlertTriangle, PackageOpen, Plus, SearchX, Sprout, X } from 'lucide-react';
import type { SeedPacket, SeedVaultViewProps } from '../types';
import { getGerminationEstimate } from '../lib/germination';
import {
  applyCategoryFix,
  findCategoryFixes,
  readDismissals,
  writeDismissals,
} from '../lib/categoryFix';
import type { CategoryFix } from '../lib/categoryFix';
import { ViewHeader } from './ViewHeader';
import { ViewSummaryCard } from './ViewSummaryCard';
import { AddSeedForm } from './seed-vault/AddSeedForm';
import { CategoryFixBanner } from './seed-vault/CategoryFixBanner';
import { SeedCard } from './seed-vault/SeedCard';
import { SeedEmptyState } from './seed-vault/SeedEmptyState';
import { ALL_CATEGORIES, SeedFilters } from './seed-vault/SeedFilters';

function matchesQuery(packet: SeedPacket, needle: string): boolean {
  return [packet.variety, packet.brand, packet.notes].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

/** `localStorage` when there is one. There is not, during SSR or in a test. */
function browserStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

export function SeedVaultView({ seeds, setSeeds }: SeedVaultViewProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [isFormOpen, setIsFormOpen] = useState(false);
  // Read once on mount. Dismissals are a per-device preference, so there is
  // nothing to keep in step with the server and nothing to re-read.
  const [dismissedFixes, setDismissedFixes] = useState<Set<string>>(() =>
    readDismissals(browserStorage()),
  );

  const categoryFixes = useMemo(
    () => findCategoryFixes(seeds, dismissedFixes),
    [seeds, dismissedFixes],
  );

  const categories = useMemo(
    () => Array.from(new Set(seeds.map((seed) => seed.category))).sort((a, b) => a.localeCompare(b)),
    [seeds],
  );

  const staleCount = useMemo(
    () => seeds.filter((seed) => getGerminationEstimate(seed).status === 'stale').length,
    [seeds],
  );

  const visibleSeeds = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return seeds.filter((seed) => {
      if (category !== ALL_CATEGORIES && seed.category !== category) return false;
      return needle === '' || matchesQuery(seed, needle);
    });
  }, [seeds, query, category]);

  const stats = useMemo(
    () => [
      { id: 'packets', label: 'Packets', value: String(seeds.length) },
      { id: 'categories', label: 'Categories', value: String(categories.length) },
      { id: 'replace', label: 'Need replacing', value: String(staleCount) },
    ],
    [seeds.length, categories.length, staleCount],
  );

  const isFiltered = query.trim() !== '' || category !== ALL_CATEGORIES;

  function handleAdd(packet: SeedPacket) {
    setSeeds((previous) => [packet, ...previous]);
    // Clear the filters so the packet that was just saved is never hidden.
    setQuery('');
    setCategory(ALL_CATEGORIES);
    setIsFormOpen(false);
  }

  function handleDelete(id: string) {
    setSeeds((previous) => previous.filter((seed) => seed.id !== id));
  }

  function resetFilters() {
    setQuery('');
    setCategory(ALL_CATEGORIES);
  }

  /**
   * Accepting a correction is an ordinary edit.
   *
   * It goes through the same `setSeeds` every other change goes through, so it
   * syncs, and so undoing it is just editing the packet back — there is no
   * special "corrected" state anywhere for her to get stuck in.
   */
  function handleApplyFix(fix: CategoryFix) {
    setSeeds((previous) => applyCategoryFix(previous, fix));
  }

  function handleDismissFix(fix: CategoryFix) {
    setDismissedFixes((previous) => {
      const next = new Set(previous).add(fix.key);
      writeDismissals(browserStorage(), next);

      return next;
    });
  }

  return (
    <div className="space-y-6">
      <ViewHeader
        icon={Sprout}
        title="Seed Vault"
        description="Every packet on the shelf, with brand, purchase year and sowing notes."
      />

      <ViewSummaryCard
        icon={PackageOpen}
        headline="Your vault is stocked"
        body={
          staleCount > 0
            ? `Germination is estimated from each packet's purchase year, so packets that have been on the shelf too long stand out. ${staleCount} ${
                staleCount === 1 ? 'packet is' : 'packets are'
              } past the three-year mark and should be tested or replaced.`
            : 'Germination is estimated from each packet\u2019s purchase year, so packets that have been on the shelf too long stand out. Nothing in the vault is past the three-year mark right now.'
        }
        stats={stats}
      />

      <CategoryFixBanner
        fixes={categoryFixes}
        onApply={handleApplyFix}
        onDismiss={handleDismissFix}
      />

      {staleCount > 0 && (
        <p className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium leading-relaxed text-rose-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>
            {staleCount} {staleCount === 1 ? 'packet is' : 'packets are'} more than three years old.
            Run a paper-towel germination test before committing a full row, or sow extra thickly.
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          {visibleSeeds.length} of {seeds.length} {seeds.length === 1 ? 'packet' : 'packets'}
        </h3>
        <button
          type="button"
          onClick={() => setIsFormOpen((open) => !open)}
          aria-expanded={isFormOpen}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        >
          {isFormOpen ? (
            <X className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          {isFormOpen ? 'Close form' : 'Add Seed Packet'}
        </button>
      </div>

      {isFormOpen && <AddSeedForm onAdd={handleAdd} onCancel={() => setIsFormOpen(false)} seeds={seeds} />}

      {seeds.length > 0 && (
        <SeedFilters
          query={query}
          onQueryChange={setQuery}
          category={category}
          onCategoryChange={setCategory}
          categories={categories}
        />
      )}

      {seeds.length === 0 ? (
        <SeedEmptyState
          icon={Sprout}
          title="The vault is empty"
          body="Add the first packet from your shoebox and the vault will start tracking how well it should still germinate."
          actionLabel="Add your first packet"
          onAction={() => setIsFormOpen(true)}
        />
      ) : visibleSeeds.length === 0 ? (
        <SeedEmptyState
          icon={SearchX}
          title="No packets match"
          body="Nothing in the vault matches that search and category combination. Widen the filters to see the rest of the shelf."
          actionLabel="Clear filters"
          onAction={resetFilters}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibleSeeds.map((packet) => (
            <li key={packet.id}>
              <SeedCard packet={packet} onDelete={handleDelete} />
            </li>
          ))}
        </ul>
      )}

      {isFiltered && visibleSeeds.length > 0 && (
        <p className="text-xs text-stone-500">
          Filtered view — {seeds.length - visibleSeeds.length} packet
          {seeds.length - visibleSeeds.length === 1 ? '' : 's'} hidden.{' '}
          <button
            type="button"
            onClick={resetFilters}
            className="font-semibold text-emerald-700 underline decoration-emerald-300 underline-offset-2 transition-colors hover:text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            Show every packet
          </button>
        </p>
      )}
    </div>
  );
}

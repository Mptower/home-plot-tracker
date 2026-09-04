import { useCallback, useMemo, useState } from 'react';
import { Scale, TrendingUp } from 'lucide-react';
import type { HarvestLogViewProps } from '../types';
import { createId } from '../lib/id';
import type { HarvestDraft } from '../lib/harvest';
import {
  collectVarietyOptions,
  filterHarvests,
  formatCount,
  formatWeightValue,
  groupHarvestsByDay,
  summarizeHarvests,
} from '../lib/harvest';
import { ViewHeader } from './ViewHeader';
import { ViewSummaryCard } from './ViewSummaryCard';
import { HarvestFeed } from './harvest-log/HarvestFeed';
import { HarvestForm } from './harvest-log/HarvestForm';
import { HarvestSummary } from './harvest-log/HarvestSummary';

export function HarvestLogView({ harvests, setHarvests, seeds }: HarvestLogViewProps) {
  const [query, setQuery] = useState('');

  const varieties = useMemo(() => collectVarietyOptions(seeds, harvests), [seeds, harvests]);
  const matches = useMemo(() => filterHarvests(harvests, query), [harvests, query]);
  const days = useMemo(() => groupHarvestsByDay(matches), [matches]);
  const matchTotals = useMemo(() => summarizeHarvests(matches), [matches]);
  const seasonTotals = useMemo(() => summarizeHarvests(harvests), [harvests]);

  const stats = useMemo(
    () => [
      { id: 'entries', label: 'Entries', value: formatCount(harvests.length) },
      {
        id: 'varieties',
        label: 'Varieties',
        value: formatCount(seasonTotals.varietyTotals.length),
      },
      {
        id: 'best-day',
        label: 'Best day (lbs)',
        value: formatWeightValue(seasonTotals.bestDayWeightLbs),
      },
    ],
    [harvests.length, seasonTotals],
  );

  const handleAdd = useCallback(
    (draft: HarvestDraft) => {
      // Prepending keeps a fresh entry at the top of its day group, because
      // grouping preserves the stored array order within each day.
      setHarvests((current) => [{ id: createId('harvest'), ...draft }, ...current]);
    },
    [setHarvests],
  );

  const handleDelete = useCallback(
    (id: string) => {
      setHarvests((current) => current.filter((entry) => entry.id !== id));
    },
    [setHarvests],
  );

  return (
    <div className="space-y-6">
      <ViewHeader
        icon={Scale}
        title="Harvest Log"
        description="Weigh and count every pick to see which varieties actually earn their space."
      />
      <ViewSummaryCard
        icon={TrendingUp}
        headline="The season is adding up"
        body={`Log a pick on the left and it lands in the feed under the day you harvested it. Varieties suggest themselves from the ${seeds.length} packets in your vault, and anything you type by hand is remembered too.`}
        stats={stats}
      />

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="lg:sticky lg:top-8">
          <HarvestForm varieties={varieties} onSubmit={handleAdd} />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <HarvestSummary totals={matchTotals} isFiltered={query.trim().length > 0} />
          <HarvestFeed
            days={days}
            query={query}
            onQueryChange={setQuery}
            onDelete={handleDelete}
            totalEntries={harvests.length}
            matchCount={matches.length}
          />
        </div>
      </div>
    </div>
  );
}

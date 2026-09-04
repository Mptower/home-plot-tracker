import { useMemo } from 'react';
import { Scale, TrendingUp } from 'lucide-react';
import type { HarvestLogViewProps } from '../types';
import { ViewHeader } from './ViewHeader';
import { ViewSummaryCard } from './ViewSummaryCard';

export function HarvestLogView({ harvests, seeds }: HarvestLogViewProps) {
  const stats = useMemo(() => {
    const totalWeight = harvests.reduce((total, entry) => total + entry.weightLbs, 0);
    const totalCount = harvests.reduce((total, entry) => total + entry.count, 0);

    return [
      { id: 'entries', label: 'Entries', value: String(harvests.length) },
      { id: 'weight', label: 'Total lbs', value: totalWeight.toFixed(1) },
      { id: 'count', label: 'Items picked', value: String(totalCount) },
    ];
  }, [harvests]);

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
        body={`Every entry ties back to a variety in the vault, so totals roll up across all ${seeds.length} packets you are growing.`}
        stats={stats}
      />
    </div>
  );
}

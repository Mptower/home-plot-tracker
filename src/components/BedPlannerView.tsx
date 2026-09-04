import { useMemo } from 'react';
import { LayoutGrid, Shovel } from 'lucide-react';
import type { BedPlannerViewProps } from '../types';
import { ViewHeader } from './ViewHeader';
import { ViewSummaryCard } from './ViewSummaryCard';

export function BedPlannerView({ beds, seeds }: BedPlannerViewProps) {
  const stats = useMemo(() => {
    const squares = beds.reduce((total, bed) => total + bed.rows * bed.columns, 0);
    const planted = beds.reduce(
      (total, bed) =>
        total + bed.layout.reduce((rowTotal, row) => rowTotal + row.filter(Boolean).length, 0),
      0,
    );

    return [
      { id: 'beds', label: 'Beds', value: String(beds.length) },
      { id: 'squares', label: 'Squares', value: String(squares) },
      { id: 'planted', label: 'Planted', value: `${planted}/${squares}` },
    ];
  }, [beds]);

  return (
    <div className="space-y-6">
      <ViewHeader
        icon={LayoutGrid}
        title="Bed Planner"
        description="Lay out each bed square by square and keep crop rotation honest."
      />
      <ViewSummaryCard
        icon={Shovel}
        headline="The plot is mapped"
        body={`Each bed remembers last season's family, so rotation conflicts surface as you plant. ${seeds.length} varieties from the vault are ready to drop into a square.`}
        stats={stats}
      />
    </div>
  );
}

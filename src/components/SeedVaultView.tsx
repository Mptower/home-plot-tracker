import { useMemo } from 'react';
import { PackageOpen, Sprout } from 'lucide-react';
import type { SeedVaultViewProps } from '../types';
import { ViewHeader } from './ViewHeader';
import { ViewSummaryCard } from './ViewSummaryCard';

export function SeedVaultView({ seeds }: SeedVaultViewProps) {
  const stats = useMemo(() => {
    const categories = new Set(seeds.map((seed) => seed.category));
    const newestYear = seeds.reduce((year, seed) => Math.max(year, seed.purchaseYear), 0);

    return [
      { id: 'packets', label: 'Packets', value: String(seeds.length) },
      { id: 'categories', label: 'Categories', value: String(categories.size) },
      { id: 'newest', label: 'Newest year', value: newestYear > 0 ? String(newestYear) : '—' },
    ];
  }, [seeds]);

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
        body="Packets are grouped by category so you can see at a glance what is ready to sow and what is getting old enough to warrant a germination test."
        stats={stats}
      />
    </div>
  );
}

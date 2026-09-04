import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { BedPlannerView } from './components/BedPlannerView';
import { SeedVaultView } from './components/SeedVaultView';
import { HarvestLogView } from './components/HarvestLogView';
import { useLocalStorage } from './hooks/useLocalStorage';
import { DEFAULT_BEDS, DEFAULT_HARVESTS, DEFAULT_SEEDS } from './lib/seedData';
import { STORAGE_KEYS } from './types';
import type { GardenBed, HarvestLog, SeedPacket, ViewId } from './types';

export default function App() {
  const [seeds, setSeeds] = useLocalStorage<SeedPacket[]>(STORAGE_KEYS.seeds, DEFAULT_SEEDS);
  const [beds, setBeds] = useLocalStorage<GardenBed[]>(STORAGE_KEYS.beds, DEFAULT_BEDS);
  const [harvests, setHarvests] = useLocalStorage<HarvestLog[]>(
    STORAGE_KEYS.harvests,
    DEFAULT_HARVESTS,
  );
  const [activeView, setActiveView] = useState<ViewId>('planner');

  return (
    <div className="flex min-h-screen text-stone-900">
      <Sidebar activeView={activeView} onChange={setActiveView} />

      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-7xl">
          {activeView === 'planner' && (
            <BedPlannerView beds={beds} setBeds={setBeds} seeds={seeds} />
          )}
          {activeView === 'vault' && <SeedVaultView seeds={seeds} setSeeds={setSeeds} />}
          {activeView === 'harvest' && (
            <HarvestLogView harvests={harvests} setHarvests={setHarvests} seeds={seeds} />
          )}
        </div>
      </main>
    </div>
  );
}

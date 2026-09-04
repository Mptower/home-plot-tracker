/**
 * The app shell.
 *
 * State still lives here and still flows down as `(data, setData)` pairs — the
 * views cannot tell that it is now backed by the API rather than by
 * `localStorage`. What is new is everything a network makes possible: a load
 * that can be pending or fail, a save that can be in flight, and a garden that
 * another device may have changed since this page opened.
 */
import { useCallback, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { BedPlannerView } from './components/BedPlannerView';
import { SeedVaultView } from './components/SeedVaultView';
import { HarvestLogView } from './components/HarvestLogView';
import { ConflictChooser } from './components/ConflictChooser';
import { FirstRunCard } from './components/FirstRunCard';
import type { FirstRunPhase } from './components/FirstRunCard';
import { GardenLoading } from './components/GardenLoading';
import { GardenUnavailable } from './components/GardenUnavailable';
import { SyncBanner } from './components/SyncBanner';
import { FrostBanner } from './components/FrostBanner';
import { useGardenData } from './hooks/useGardenData';
import { ApiError } from './lib/apiClient';
import type { ApiIssue } from './lib/apiClient';
import { readLocalGarden, readMigrationRecord, recordMigration } from './lib/localSnapshot';
import { DEFAULT_BEDS, DEFAULT_HARVESTS, DEFAULT_SEEDS } from './lib/seedData';
import type { GardenSnapshot, ViewId } from './types';

interface FirstRunState {
  phase: FirstRunPhase;
  message: string | null;
  issues: ApiIssue[];
}

const FIRST_RUN_IDLE: FirstRunState = { phase: 'offer', message: null, issues: [] };

/** What the app used to open with. Now offered rather than assumed. */
const SAMPLE_GARDEN: GardenSnapshot = {
  seeds: DEFAULT_SEEDS,
  beds: DEFAULT_BEDS,
  harvests: DEFAULT_HARVESTS,
};

export default function App() {
  const garden = useGardenData();
  const [activeView, setActiveView] = useState<ViewId>('planner');

  // Read once, on the first render: whether this browser still holds a garden
  // from before the server existed, and whether it has already been handed over.
  const [localGarden] = useState(() => (readMigrationRecord() ? null : readLocalGarden()));
  const [firstRun, setFirstRun] = useState<FirstRunState>(FIRST_RUN_IDLE);
  const [offerDismissed, setOfferDismissed] = useState(false);

  const {
    importGarden,
    mergeGarden,
    reload,
    retrySave,
    resolveAllConflicts,
    resolveConflict,
    status,
  } = garden;

  const handleImport = useCallback(async () => {
    const snapshot = localGarden?.snapshot ?? SAMPLE_GARDEN;

    setFirstRun({ phase: 'working', message: null, issues: [] });

    try {
      const outcome = await importGarden(snapshot);

      if (outcome.status === 'imported') {
        // Recorded only with the server's confirmation in hand. The browser copy
        // itself is deliberately left exactly where it is.
        if (localGarden) recordMigration(localGarden.counts);
        setFirstRun(FIRST_RUN_IDLE);
        setOfferDismissed(true);
        return;
      }

      // The server is not empty, so `import` — which is all-or-nothing into an
      // empty garden — cannot be used. Retrying would fail identically forever,
      // because the guard is emptiness rather than a version. So the browser
      // copy is folded in alongside what is already there instead, using the
      // state and versions that same response handed back.
      if (localGarden) {
        mergeGarden(localGarden.snapshot, outcome.current);
        recordMigration(localGarden.counts);
        setFirstRun({ phase: 'merged', message: outcome.message, issues: [] });
        return;
      }

      // Nothing of hers to move — this was only the sample garden offer, and
      // the garden stopped being empty while she was deciding. Quietly step
      // aside and show what is actually there.
      setFirstRun(FIRST_RUN_IDLE);
      setOfferDismissed(true);
      reload();
    } catch (error) {
      const failure =
        error instanceof ApiError
          ? error
          : new ApiError('The garden server could not be reached.', { kind: 'network' });

      setFirstRun({ phase: 'failed', message: failure.message, issues: failure.issues });
    }
  }, [importGarden, localGarden, mergeGarden, reload]);

  const handleDismissOffer = useCallback(() => {
    setFirstRun(FIRST_RUN_IDLE);
    setOfferDismissed(true);
  }, []);

  const showFirstRun =
    !offerDismissed &&
    status.phase === 'ready' &&
    (garden.isEmpty || firstRun.phase === 'merged' || firstRun.phase === 'failed');

  return (
    <div className="flex min-h-screen text-stone-900">
      <Sidebar activeView={activeView} onChange={setActiveView} status={status} onRetry={retrySave} />

      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-7xl space-y-6">
          {status.phase === 'loading' && <GardenLoading />}

          {status.phase === 'failed' && (
            <GardenUnavailable error={status.loadError} onRetry={reload} />
          )}

          {status.phase === 'ready' && (
            <>
              <FrostBanner />

              <SyncBanner status={status} onRetry={retrySave} />

              <ConflictChooser
                conflicts={status.conflicts}
                onResolve={resolveConflict}
                onResolveAll={resolveAllConflicts}
              />

              {showFirstRun && (
                <FirstRunCard
                  local={localGarden}
                  phase={firstRun.phase}
                  message={firstRun.message}
                  issues={firstRun.issues}
                  onImport={() => void handleImport()}
                  onDismiss={handleDismissOffer}
                />
              )}

              {activeView === 'planner' && (
                <BedPlannerView beds={garden.beds} setBeds={garden.setBeds} seeds={garden.seeds} />
              )}
              {activeView === 'vault' && (
                <SeedVaultView seeds={garden.seeds} setSeeds={garden.setSeeds} />
              )}
              {activeView === 'harvest' && (
                <HarvestLogView
                  harvests={garden.harvests}
                  setHarvests={garden.setHarvests}
                  seeds={garden.seeds}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

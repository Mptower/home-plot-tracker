import { useEffect, useState } from 'react';
import { Leaf } from 'lucide-react';

/**
 * The wait while the garden loads.
 *
 * Two deliberate choices. It only appears after a short delay, because on a
 * local network the data arrives in a few milliseconds and a skeleton that
 * flashes up and vanishes is worse than no skeleton at all. And it is built
 * from the same panel surfaces as the real views, so what appears is the shape
 * of the page settling in rather than a spinner on an empty screen.
 */
const APPEAR_AFTER_MS = 250;

function useAfterDelay(delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return elapsed;
}

export function GardenLoading() {
  const visible = useAfterDelay(APPEAR_AFTER_MS);

  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading your garden…</span>

      {visible && (
        <div className="space-y-6 motion-safe:animate-pulse">
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <Leaf className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="space-y-2">
              <div className="h-5 w-48 rounded-full bg-panel-sunken" />
              <div className="h-3 w-64 rounded-full bg-panel-rail" />
            </div>
          </div>

          <div className="rounded-2xl border border-panel-edge bg-panel p-6 shadow-sm sm:p-8">
            <div className="space-y-3">
              <div className="h-4 w-40 rounded-full bg-panel-sunken" />
              <div className="h-3 w-full max-w-prose rounded-full bg-panel-rail" />
              <div className="h-3 w-2/3 max-w-prose rounded-full bg-panel-rail" />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {['first', 'second', 'third'].map((key) => (
                <div
                  key={key}
                  className="h-16 rounded-2xl border border-panel-edge bg-panel-sunken"
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="h-64 rounded-2xl border border-panel-edge bg-panel shadow-sm" />
            <div className="h-64 rounded-2xl border border-panel-edge bg-panel shadow-sm" />
          </div>
        </div>
      )}
    </div>
  );
}

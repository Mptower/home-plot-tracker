import { useEffect, useState } from 'react';
import type { GardenStatus } from '../hooks/useGardenData';

export interface SyncStatusProps {
  status: GardenStatus;
  onRetry: () => void;
}

/** Full literal class strings, one per state — never assembled from parts. */
const DOTS = {
  saved: 'h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500',
  saving: 'h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 motion-safe:animate-pulse',
  waiting: 'h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500',
  trouble: 'h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500',
  quiet: 'h-2.5 w-2.5 shrink-0 rounded-full bg-stone-400',
} as const;

type DotKind = keyof typeof DOTS;

/** Re-renders the "saved 3 min ago" line without a timer per second. */
const TICK_MS = 30_000;

function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  return now;
}

function formatLastSaved(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));

  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  return `at ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

interface Summary {
  dot: DotKind;
  label: string;
  detail: string;
  canRetry: boolean;
}

function summarize(status: GardenStatus, now: number): Summary {
  if (status.phase === 'loading') {
    return { dot: 'quiet', label: 'Loading', detail: 'Fetching your garden', canRetry: false };
  }

  if (status.phase === 'failed') {
    return {
      dot: 'trouble',
      label: 'Server unavailable',
      detail: 'Nothing has loaded yet',
      canRetry: false,
    };
  }

  if (status.conflicts.length > 0) {
    return {
      dot: 'waiting',
      label: 'Needs your answer',
      detail: 'Also changed on another device',
      canRetry: false,
    };
  }

  if (status.saveError) {
    return {
      dot: 'trouble',
      label: 'Not saved yet',
      detail: 'Your changes are still here',
      canRetry: true,
    };
  }

  if (!status.isOnline) {
    return {
      dot: 'quiet',
      label: 'Offline',
      detail: status.hasUnsavedChanges ? 'Waiting to save' : 'Showing the last saved garden',
      canRetry: status.hasUnsavedChanges,
    };
  }

  if (status.isSaving || status.hasUnsavedChanges) {
    return { dot: 'saving', label: 'Saving', detail: 'Sending to the server', canRetry: false };
  }

  return {
    dot: 'saved',
    label: 'Saved',
    detail:
      status.lastSavedAt === null
        ? 'On the garden server'
        : `Saved ${formatLastSaved(status.lastSavedAt, now)}`,
    canRetry: false,
  };
}

/**
 * The sidebar's honest footer.
 *
 * It used to read "Saved locally on this device", which stopped being true the
 * moment the server took over. It now says where the data actually is, and it
 * has to stay calm: it is on screen the whole time, so a hard red for a
 * momentary hiccup would be exhausting. A dot carries the state on the narrow
 * rail, where there is no room for words.
 */
export function SyncStatus({ status, onRetry }: SyncStatusProps) {
  const now = useClock(status.lastSavedAt !== null);
  const summary = summarize(status, now);

  return (
    <div
      role="status"
      title={`${summary.label} — ${summary.detail}`}
      className="border-t border-panel-edge px-4 py-4 md:px-6"
    >
      <div className="flex items-center gap-2.5">
        <span className={DOTS[summary.dot]} aria-hidden="true" />

        <div className="hidden min-w-0 flex-1 md:block">
          <p className="truncate text-xs font-semibold text-stone-600">{summary.label}</p>
          <p className="truncate text-xs text-stone-400">{summary.detail}</p>
        </div>

        <span className="sr-only">
          {summary.label}. {summary.detail}.
        </span>
      </div>

      {summary.canRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 hidden w-full rounded-xl border border-panel-edge bg-panel px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:bg-panel-sunken hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel md:block"
        >
          Try saving again
        </button>
      )}
    </div>
  );
}

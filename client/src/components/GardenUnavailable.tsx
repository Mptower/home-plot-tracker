import { CloudOff, RefreshCw } from 'lucide-react';
import type { ApiError } from '../lib/apiClient';

export interface GardenUnavailableProps {
  error: ApiError | null;
  onRetry: () => void;
}

function reason(error: ApiError | null): string {
  if (!error) return 'The garden server did not answer.';

  switch (error.kind) {
    case 'network':
      return 'The garden server is not answering. It may be starting up, or this device may be off the network.';
    case 'server':
      return 'The garden server ran into a problem while fetching your garden.';
    case 'malformed':
      return 'The garden server answered with something this app did not understand.';
    default:
      return error.message;
  }
}

/**
 * Shown instead of the views when the garden could not be read at all.
 *
 * Nothing is lost at this point — nothing has been loaded yet — so this stays
 * calm and says what to do next, rather than presenting a failure.
 */
export function GardenUnavailable({ error, onRetry }: GardenUnavailableProps) {
  return (
    <section className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-panel-edge bg-panel px-6 py-12 text-center shadow-sm">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel-sunken text-stone-500">
        <CloudOff className="h-6 w-6" aria-hidden="true" />
      </span>

      <div>
        <h2 className="text-lg font-semibold text-stone-900">Waiting on the garden server</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-stone-500">{reason(error)}</p>
      </div>

      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Try again
      </button>
    </section>
  );
}

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { HarvestLog } from '../../types';
import { formatCount, formatWeight } from '../../lib/harvest';

export interface HarvestRowProps {
  entry: HarvestLog;
  onDelete: (id: string) => void;
}

const CHIP_CLASSES =
  'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums';

/** One logged pick, with an inline delete confirmation instead of a modal. */
export function HarvestRow({ entry, onDelete }: HarvestRowProps) {
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-panel-sunken">
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900">
        {entry.variety}
      </p>

      <div className="flex shrink-0 items-center gap-2">
        {entry.weightLbs > 0 && (
          <span className={`${CHIP_CLASSES} bg-emerald-50 text-emerald-700`}>
            {formatWeight(entry.weightLbs)}
          </span>
        )}
        {entry.count > 0 && (
          <span className={`${CHIP_CLASSES} bg-amber-50 text-amber-700`}>
            {formatCount(entry.count)} ct
          </span>
        )}
        {entry.weightLbs <= 0 && entry.count <= 0 && (
          <span className={`${CHIP_CLASSES} bg-panel-sunken text-stone-500`}>Not weighed</span>
        )}
      </div>

      {isConfirming ? (
        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onDelete(entry.id)}
            className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setIsConfirming(false)}
            className="rounded-lg border border-panel-edge px-2.5 py-1 text-xs font-semibold text-stone-600 transition-colors hover:bg-panel-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setIsConfirming(true)}
          aria-label={`Delete the ${entry.variety} harvest logged on ${entry.date}`}
          className="shrink-0 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

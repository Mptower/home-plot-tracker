import { Smartphone } from 'lucide-react';
import type { DeviceConflict } from '../hooks/useGardenData';
import type { CollectionName } from '../types';
import type { MergeSide } from '../lib/merge';

export interface ConflictChooserProps {
  conflicts: DeviceConflict[];
  onResolve: (collection: CollectionName, id: string, side: MergeSide) => void;
  onResolveAll: (side: MergeSide) => void;
}

const CHOICE_BUTTON =
  'rounded-xl border border-amber-300 bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50';

/**
 * The only moment two devices need the user.
 *
 * Everything that can be worked out has been: records added on either side are
 * kept, and a change on one side with the other untouched is applied. What is
 * left is the same record changed in two places, where picking for her would
 * mean throwing away someone's typing. Each one is settled on its own — she may
 * well want the weight from the phone and the note from the laptop.
 */
export function ConflictChooser({ conflicts, onResolve, onResolveAll }: ConflictChooserProps) {
  if (conflicts.length === 0) return null;

  return (
    <div
      role="alertdialog"
      aria-label="Changes made on another device"
      className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm sm:p-5"
    >
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-800">
          <Smartphone className="h-5 w-5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold sm:text-base">
            {conflicts.length === 1
              ? 'One thing was also changed on another device'
              : `${conflicts.length} things were also changed on another device`}
          </h3>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-amber-800">
            Everything else has been kept, from both places. These are the only ones where the same
            record was changed twice, so it needs your call. Nothing else is saved until you choose.
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {conflicts.map((conflict) => (
          <li
            key={`${conflict.collection}-${conflict.id}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-panel px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-stone-900">{conflict.label}</p>
              <p className="mt-0.5 text-xs text-stone-500">{conflict.explanation}</p>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => onResolve(conflict.collection, conflict.id, 'mine')}
                className={CHOICE_BUTTON}
              >
                {conflict.keepMineLabel}
              </button>
              <button
                type="button"
                onClick={() => onResolve(conflict.collection, conflict.id, 'theirs')}
                className={CHOICE_BUTTON}
              >
                {conflict.keepTheirsLabel}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {conflicts.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-amber-800">
          <span>For all of them:</span>
          <button type="button" onClick={() => onResolveAll('mine')} className={CHOICE_BUTTON}>
            Keep this device&rsquo;s
          </button>
          <button type="button" onClick={() => onResolveAll('theirs')} className={CHOICE_BUTTON}>
            Keep the other device&rsquo;s
          </button>
        </div>
      )}
    </div>
  );
}

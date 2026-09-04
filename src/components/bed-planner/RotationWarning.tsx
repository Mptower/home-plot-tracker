import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { pluralizeCategory } from '../../lib/rotation';

export interface RotationWarningProps {
  category: string;
  conflictCount: number;
  bedName: string;
  onDismiss: () => void;
}

/**
 * Friendly, non-blocking advice shown while the bed holds anything from last
 * season's family. Named dynamically from the bed's own `lastYearCategory`.
 */
export function RotationWarning({
  category,
  conflictCount,
  bedName,
  onDismiss,
}: RotationWarningProps) {
  const squares = conflictCount === 1 ? '1 square' : `${conflictCount} squares`;

  return (
    <div
      role="status"
      className="flex items-start gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm sm:p-5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-800">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-2 text-sm font-bold sm:text-base">
          <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>🔄 Crop Rotation Warning: {pluralizeCategory(category)} planted here last year!</span>
        </h3>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-amber-800">
          {squares} in {bedName} {conflictCount === 1 ? 'holds' : 'hold'} another {category.toLowerCase()} — look
          for the amber outlines. Consider a different family to keep the soil healthy, or plant it
          anyway if you have a plan.
        </p>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss crop rotation warning"
        className="shrink-0 rounded-lg p-1.5 text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

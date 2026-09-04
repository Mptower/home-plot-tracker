import { useState } from 'react';
import { AlertTriangle, Store, Trash2, X } from 'lucide-react';
import type { SeedPacket } from '../../types';
import { getGerminationEstimate } from '../../lib/germination';
import { getCategoryBadgeClasses, STATUS_THEME } from './theme';

export interface SeedCardProps {
  packet: SeedPacket;
  onDelete: (id: string) => void;
}

export function SeedCard({ packet, onDelete }: SeedCardProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const estimate = getGerminationEstimate(packet);
  const theme = STATUS_THEME[estimate.status];
  const isStale = estimate.status === 'stale';

  return (
    <article
      className={`flex h-full flex-col rounded-2xl border bg-panel p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md ${theme.card}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-base font-bold leading-tight text-stone-900">{packet.variety}</h4>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1">
              <Store className="h-3.5 w-3.5" aria-hidden="true" />
              {packet.brand.trim() === '' ? 'Brand unknown' : packet.brand}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">Bought {packet.purchaseYear}</span>
          </p>
        </div>

        {isConfirmingDelete ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onDelete(packet.id)}
              aria-label={`Confirm deleting ${packet.variety}`}
              className="rounded-xl bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
            >
              Confirm?
            </button>
            <button
              type="button"
              onClick={() => setIsConfirmingDelete(false)}
              aria-label={`Keep ${packet.variety}`}
              className="rounded-xl p-1.5 text-stone-400 transition-colors hover:bg-panel-sunken hover:text-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsConfirmingDelete(true)}
            aria-label={`Delete ${packet.variety}`}
            className="shrink-0 rounded-xl p-1.5 text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${getCategoryBadgeClasses(
            packet.category,
          )}`}
        >
          {packet.category}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${theme.pill}`}
        >
          {theme.shortLabel}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Est. germination
          </span>
          <span className={`text-lg font-bold tabular-nums ${theme.value}`}>
            {estimate.ratePercent}%
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-panel-sunken" aria-hidden="true">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${theme.bar}`}
            style={{ width: `${estimate.ratePercent}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-stone-500">{estimate.label}</p>
      </div>

      {isStale && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold leading-relaxed text-rose-700 ring-1 ring-inset ring-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {estimate.ageYears} yrs old — germination may be low, sow extra thickly or replace this
            packet.
          </span>
        </p>
      )}

      <p className="mt-4 text-sm leading-relaxed text-stone-600">
        {packet.notes.trim() === '' ? (
          <span className="italic text-stone-400">No sowing notes yet.</span>
        ) : (
          packet.notes
        )}
      </p>
    </article>
  );
}

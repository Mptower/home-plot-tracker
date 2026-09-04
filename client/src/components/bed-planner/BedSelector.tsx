import { useState } from 'react';
import { Map as MapIcon, Plus } from 'lucide-react';
import type { GardenBed } from '../../types';
import { countPlanted } from '../../lib/rotation';
import { AddBedForm } from './AddBedForm';
import type { NewBedDraft } from './AddBedForm';

export interface BedSelectorProps {
  beds: GardenBed[];
  selectedBedId: string | null;
  onSelect: (bedId: string) => void;
  onCreate: (draft: NewBedDraft) => void;
}

/** Bed switcher: cards on desktop, a select on phones, plus the add affordance. */
export function BedSelector({ beds, selectedBedId, onSelect, onCreate }: BedSelectorProps) {
  const [isAdding, setIsAdding] = useState(false);

  function handleCreate(draft: NewBedDraft) {
    onCreate(draft);
    setIsAdding(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Your beds</h3>
        {!isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add bed
          </button>
        )}
      </div>

      {beds.length > 0 && (
        <>
          <div className="sm:hidden">
            <label className="sr-only" htmlFor="bed-selector-mobile">
              Select a bed
            </label>
            <select
              id="bed-selector-mobile"
              value={selectedBedId ?? ''}
              onChange={(event) => onSelect(event.target.value)}
              className="w-full rounded-xl border border-panel-edge bg-panel px-3 py-2.5 text-sm font-semibold text-stone-900 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              {beds.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  {bed.name} · {bed.rows}×{bed.columns}
                </option>
              ))}
            </select>
          </div>

          <div
            role="tablist"
            aria-label="Garden beds"
            className="hidden flex-wrap gap-2 sm:flex"
          >
            {beds.map((bed) => {
              const isActive = bed.id === selectedBedId;
              const squares = bed.rows * bed.columns;

              return (
                <button
                  key={bed.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelect(bed.id)}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 ${
                    isActive
                      ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
                      : 'border-panel-edge bg-panel text-stone-700 hover:border-emerald-300 hover:bg-emerald-50'
                  }`}
                >
                  <MapIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{bed.name}</span>
                    <span
                      className={`block truncate text-xs ${isActive ? 'text-emerald-100' : 'text-stone-500'}`}
                    >
                      {bed.rows} × {bed.columns} · {countPlanted(bed)}/{squares} planted
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {isAdding && <AddBedForm onCreate={handleCreate} onCancel={() => setIsAdding(false)} />}
    </div>
  );
}

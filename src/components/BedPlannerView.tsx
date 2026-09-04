import { useMemo, useState } from 'react';
import { LayoutGrid, Shovel, Sprout, Trash2 } from 'lucide-react';
import type { BedPlannerViewProps, GardenBed } from '../types';
import { createId } from '../lib/id';
import {
  buildCategoryLookup,
  cellKey,
  conflictSignature,
  countPlanted,
  createEmptyLayout,
  findRotationConflicts,
  plantCell,
  tallyPlantings,
} from '../lib/rotation';
import { ViewHeader } from './ViewHeader';
import { ViewSummaryCard } from './ViewSummaryCard';
import { BedSelector } from './bed-planner/BedSelector';
import type { NewBedDraft } from './bed-planner/AddBedForm';
import { BedGrid } from './bed-planner/BedGrid';
import type { ActiveCell } from './bed-planner/BedGrid';
import { BedContextPanel } from './bed-planner/BedContextPanel';
import { PlantPicker } from './bed-planner/PlantPicker';
import { RotationWarning } from './bed-planner/RotationWarning';

export function BedPlannerView({ beds, setBeds, seeds }: BedPlannerViewProps) {
  const [selectedBedId, setSelectedBedId] = useState<string>(() => (beds.length > 0 ? beds[0].id : ''));
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);

  const categoryOf = useMemo(() => buildCategoryLookup(seeds), [seeds]);

  // Falls back to the first bed so a deleted or missing selection never blanks the view.
  const selectedBed =
    beds.find((bed) => bed.id === selectedBedId) ?? (beds.length > 0 ? beds[0] : null);

  const conflicts = useMemo(
    () => (selectedBed ? findRotationConflicts(selectedBed, categoryOf) : []),
    [selectedBed, categoryOf],
  );

  const conflictKeys = useMemo(
    () => new Set(conflicts.map((conflict) => cellKey(conflict.row, conflict.column))),
    [conflicts],
  );

  const tallies = useMemo(
    () => (selectedBed ? tallyPlantings(selectedBed, categoryOf) : []),
    [selectedBed, categoryOf],
  );

  const stats = useMemo(() => {
    const squares = beds.reduce((total, bed) => total + bed.rows * bed.columns, 0);
    const planted = beds.reduce((total, bed) => total + countPlanted(bed), 0);

    return [
      { id: 'beds', label: 'Beds', value: String(beds.length) },
      { id: 'squares', label: 'Squares', value: String(squares) },
      { id: 'planted', label: 'Planted', value: `${planted}/${squares}` },
    ];
  }, [beds]);

  const signature = conflictSignature(selectedBed, conflicts);
  const showWarning = conflicts.length > 0 && signature !== dismissedSignature;

  function handleSelectBed(bedId: string) {
    setSelectedBedId(bedId);
    setActiveCell(null);
    setIsConfirmingDelete(false);
  }

  function handleCreateBed(draft: NewBedDraft) {
    const bed: GardenBed = {
      id: createId('bed'),
      name: draft.name,
      rows: draft.rows,
      columns: draft.columns,
      layout: createEmptyLayout(draft.rows, draft.columns),
      lastYearCategory: draft.lastYearCategory,
    };

    setBeds((current) => [...current, bed]);
    setSelectedBedId(bed.id);
    setActiveCell(null);
    setIsConfirmingDelete(false);
  }

  function handleDeleteBed() {
    if (!selectedBed) return;

    const removedId = selectedBed.id;
    setBeds((current) => current.filter((bed) => bed.id !== removedId));

    const remaining = beds.filter((bed) => bed.id !== removedId);
    setSelectedBedId(remaining.length > 0 ? remaining[0].id : '');
    setActiveCell(null);
    setIsConfirmingDelete(false);
  }

  function handleAssign(variety: string | null) {
    if (!selectedBed || !activeCell) return;

    setBeds((current) =>
      plantCell(current, selectedBed.id, activeCell.row, activeCell.column, variety),
    );
    setActiveCell(null);
  }

  const activeVariety =
    selectedBed && activeCell ? selectedBed.layout[activeCell.row]?.[activeCell.column] ?? null : null;

  return (
    <div className="space-y-6">
      <ViewHeader
        icon={LayoutGrid}
        title="Bed Planner"
        description="Lay out each bed square by square and keep crop rotation honest."
      />

      <ViewSummaryCard
        icon={Shovel}
        headline="The plot is mapped"
        body={`Each bed remembers last season's family, so rotation conflicts surface as you plant. ${seeds.length} varieties from the vault are ready to drop into a square.`}
        stats={stats}
      />

      <BedSelector
        beds={beds}
        selectedBedId={selectedBed?.id ?? null}
        onSelect={handleSelectBed}
        onCreate={handleCreateBed}
      />

      {showWarning && selectedBed && (
        <RotationWarning
          category={selectedBed.lastYearCategory}
          conflictCount={conflicts.length}
          bedName={selectedBed.name}
          onDismiss={() => setDismissedSignature(signature)}
        />
      )}

      {selectedBed ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold text-stone-900">{selectedBed.name}</h3>
                <p className="mt-0.5 text-sm text-stone-500">
                  {selectedBed.rows} rows × {selectedBed.columns} columns · tap a square to plant it
                </p>
              </div>

              {isConfirmingDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-stone-600">Delete this bed?</span>
                  <button
                    type="button"
                    onClick={handleDeleteBed}
                    className="rounded-xl bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsConfirmingDelete(false)}
                    className="rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-stone-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete bed
                </button>
              )}
            </div>

            <div className="mt-5">
              <BedGrid
                bed={selectedBed}
                categoryOf={categoryOf}
                conflictKeys={conflictKeys}
                activeCell={activeCell}
                onSelectCell={(row, column) => setActiveCell({ row, column })}
              />
            </div>
          </section>

          <BedContextPanel
            bed={selectedBed}
            tallies={tallies}
            plantedCount={countPlanted(selectedBed)}
            conflictCount={conflicts.length}
          />
        </div>
      ) : (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center shadow-sm">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <Sprout className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 className="text-lg font-semibold text-stone-900">No beds yet</h3>
          <p className="max-w-sm text-sm text-stone-500">
            Add your first bed above to start mapping the plot square by square.
          </p>
        </section>
      )}

      {selectedBed && activeCell && (
        <PlantPicker
          bedName={selectedBed.name}
          row={activeCell.row}
          column={activeCell.column}
          currentVariety={activeVariety}
          lastYearCategory={selectedBed.lastYearCategory}
          seeds={seeds}
          onAssign={handleAssign}
          onClose={() => setActiveCell(null)}
        />
      )}
    </div>
  );
}

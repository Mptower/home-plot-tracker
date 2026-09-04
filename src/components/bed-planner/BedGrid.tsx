import type { GardenBed } from '../../types';
import type { CategoryLookup } from '../../lib/rotation';
import { cellKey, normalizeLayout } from '../../lib/rotation';
import { BedCell } from './BedCell';

export interface ActiveCell {
  row: number;
  column: number;
}

export interface BedGridProps {
  bed: GardenBed;
  categoryOf: CategoryLookup;
  conflictKeys: ReadonlySet<string>;
  activeCell: ActiveCell | null;
  onSelectCell: (row: number, column: number) => void;
}

/** Minimum width per square, in rem, so the grid scrolls instead of squashing. */
const MIN_CELL_REM = 4.5;

export function BedGrid({ bed, categoryOf, conflictKeys, activeCell, onSelectCell }: BedGridProps) {
  const layout = normalizeLayout(bed.layout, bed.rows, bed.columns);

  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${bed.columns}, minmax(0, 1fr))`,
          minWidth: `${bed.columns * MIN_CELL_REM}rem`,
        }}
      >
        {layout.map((row, rowIndex) =>
          row.map((variety, columnIndex) => (
            <BedCell
              key={cellKey(rowIndex, columnIndex)}
              row={rowIndex}
              column={columnIndex}
              variety={variety}
              category={categoryOf(variety)}
              isConflicting={conflictKeys.has(cellKey(rowIndex, columnIndex))}
              isActive={activeCell?.row === rowIndex && activeCell?.column === columnIndex}
              onSelect={onSelectCell}
            />
          )),
        )}
      </div>
    </div>
  );
}

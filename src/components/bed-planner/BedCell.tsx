import { Sprout } from 'lucide-react';
import { cellKey, getCategoryStyle } from '../../lib/rotation';

export interface BedCellProps {
  row: number;
  column: number;
  variety: string | null;
  category: string | null;
  isConflicting: boolean;
  isActive: boolean;
  onSelect: (row: number, column: number) => void;
}

function describeCell(row: number, column: number, variety: string | null): string {
  const position = `Row ${row + 1}, column ${column + 1}`;
  return variety ? `${position}, planted with ${variety}` : `${position}, empty soil`;
}

/** One square of a bed: a real button so the whole grid is keyboard navigable. */
export function BedCell({
  row,
  column,
  variety,
  category,
  isConflicting,
  isActive,
  onSelect,
}: BedCellProps) {
  const style = getCategoryStyle(category);

  const stateClasses = variety
    ? style.cell
    : 'border-dashed border-stone-300 bg-stone-50 text-stone-400 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-600';

  const ringClasses = isActive
    ? 'ring-2 ring-emerald-600 ring-offset-2 ring-offset-white'
    : isConflicting
      ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-white'
      : '';

  return (
    <button
      type="button"
      id={`bed-cell-${cellKey(row, column)}`}
      onClick={() => onSelect(row, column)}
      aria-label={describeCell(row, column, variety)}
      aria-pressed={isActive}
      title={variety ?? 'Empty square'}
      className={`flex aspect-square w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border p-1 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${stateClasses} ${ringClasses}`}
    >
      {variety ? (
        <span className="line-clamp-3 text-[10px] font-semibold leading-tight sm:text-xs">
          {variety}
        </span>
      ) : (
        <Sprout className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

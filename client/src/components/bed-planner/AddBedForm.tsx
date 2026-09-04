import { useState } from 'react';
import type { FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { SEED_CATEGORIES } from '../../types';
import {
  MAX_BED_DIMENSION,
  MIN_BED_DIMENSION,
  NO_CATEGORY,
  clampDimension,
} from '../../lib/rotation';

export interface NewBedDraft {
  name: string;
  rows: number;
  columns: number;
  lastYearCategory: string;
}

export interface AddBedFormProps {
  onCreate: (draft: NewBedDraft) => void;
  onCancel: () => void;
}

const FIELD_CLASSES =
  'w-full rounded-xl border border-panel-edge bg-panel px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500';

const LABEL_CLASSES = 'block text-xs font-semibold uppercase tracking-wide text-stone-500';

export function AddBedForm({ onCreate, onCancel }: AddBedFormProps) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState('4');
  const [columns, setColumns] = useState('6');
  const [lastYearCategory, setLastYearCategory] = useState<string>(NO_CATEGORY);
  const [error, setError] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();

    if (trimmed === '') {
      setError('Give the bed a name so you can tell it apart.');
      return;
    }

    onCreate({
      name: trimmed,
      rows: clampDimension(Number(rows)),
      columns: clampDimension(Number(columns)),
      lastYearCategory,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-panel-edge bg-panel p-5 shadow-sm"
      aria-label="Add a garden bed"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-stone-900">Add a bed</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel adding a bed"
          className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-panel-sunken hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={LABEL_CLASSES} htmlFor="new-bed-name">
            Bed name
          </label>
          <input
            id="new-bed-name"
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError('');
            }}
            placeholder="Bed 3 - Raised"
            className={`mt-1 ${FIELD_CLASSES}`}
          />
        </div>

        <div>
          <label className={LABEL_CLASSES} htmlFor="new-bed-rows">
            Rows
          </label>
          <input
            id="new-bed-rows"
            type="number"
            inputMode="numeric"
            min={MIN_BED_DIMENSION}
            max={MAX_BED_DIMENSION}
            value={rows}
            onChange={(event) => setRows(event.target.value)}
            className={`mt-1 ${FIELD_CLASSES}`}
          />
        </div>

        <div>
          <label className={LABEL_CLASSES} htmlFor="new-bed-columns">
            Columns
          </label>
          <input
            id="new-bed-columns"
            type="number"
            inputMode="numeric"
            min={MIN_BED_DIMENSION}
            max={MAX_BED_DIMENSION}
            value={columns}
            onChange={(event) => setColumns(event.target.value)}
            className={`mt-1 ${FIELD_CLASSES}`}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={LABEL_CLASSES} htmlFor="new-bed-last-year">
            Grown here last year
          </label>
          <select
            id="new-bed-last-year"
            value={lastYearCategory}
            onChange={(event) => setLastYearCategory(event.target.value)}
            className={`mt-1 ${FIELD_CLASSES}`}
          >
            <option value={NO_CATEGORY}>None / new ground</option>
            {SEED_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">
            Used to flag rotation conflicts as you plant. Dimensions are limited to{' '}
            {MIN_BED_DIMENSION}–{MAX_BED_DIMENSION}.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-rose-700">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add bed
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center rounded-2xl border border-panel-edge bg-panel px-4 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-panel-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

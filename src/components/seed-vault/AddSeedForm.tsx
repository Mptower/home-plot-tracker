import { useId, useState } from 'react';
import { Sprout, X } from 'lucide-react';
import type { FormEvent } from 'react';
import type { SeedPacket } from '../../types';
import { SEED_CATEGORIES } from '../../types';
import { createId } from '../../lib/id';

export interface AddSeedFormProps {
  onAdd: (packet: SeedPacket) => void;
  onCancel: () => void;
}

interface FormErrors {
  variety?: string;
  category?: string;
  purchaseYear?: string;
}

const EARLIEST_PURCHASE_YEAR = 1990;

const labelClasses = 'block text-xs font-semibold uppercase tracking-wide text-stone-500';
const fieldClasses =
  'mt-1.5 w-full rounded-xl border border-panel-edge bg-panel px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30';

export function AddSeedForm({ onAdd, onCancel }: AddSeedFormProps) {
  const fieldId = useId();
  const currentYear = new Date().getFullYear();
  const latestPurchaseYear = currentYear + 1;

  const [variety, setVariety] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [purchaseYear, setPurchaseYear] = useState(String(currentYear));
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  function validate(): FormErrors {
    const nextErrors: FormErrors = {};
    const parsedYear = Number(purchaseYear);

    if (variety.trim() === '') {
      nextErrors.variety = 'Give the packet a variety name so you can find it later.';
    }
    if (category === '') {
      nextErrors.category = 'Pick a category to keep rotation planning honest.';
    }
    if (
      !Number.isInteger(parsedYear) ||
      parsedYear < EARLIEST_PURCHASE_YEAR ||
      parsedYear > latestPurchaseYear
    ) {
      nextErrors.purchaseYear = `Use a year between ${EARLIEST_PURCHASE_YEAR} and ${latestPurchaseYear}.`;
    }

    return nextErrors;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) return;

    onAdd({
      id: createId('seed'),
      category,
      variety: variety.trim(),
      brand: brand.trim(),
      purchaseYear: Number(purchaseYear),
      notes: notes.trim(),
    });

    setVariety('');
    setCategory('');
    setBrand('');
    setPurchaseYear(String(currentYear));
    setNotes('');
    setErrors({});
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby={`${fieldId}-heading`}
      className="rounded-2xl border border-panel-edge bg-panel p-6 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Sprout className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 id={`${fieldId}-heading`} className="text-lg font-semibold text-stone-900">
              Add a seed packet
            </h3>
            <p className="mt-1 text-sm text-stone-600">
              Purchase year drives the germination estimate, so keep it accurate.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close the add seed packet form"
          className="rounded-xl p-1.5 text-stone-400 transition-colors hover:bg-panel-sunken hover:text-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${fieldId}-variety`} className={labelClasses}>
            Variety
          </label>
          <input
            id={`${fieldId}-variety`}
            type="text"
            value={variety}
            onChange={(event) => setVariety(event.target.value)}
            placeholder="Cherokee Purple"
            aria-required="true"
            aria-invalid={errors.variety !== undefined}
            aria-describedby={errors.variety ? `${fieldId}-variety-error` : undefined}
            className={fieldClasses}
          />
          {errors.variety && (
            <p id={`${fieldId}-variety-error`} className="mt-1.5 text-xs font-medium text-rose-600">
              {errors.variety}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${fieldId}-category`} className={labelClasses}>
            Category
          </label>
          <select
            id={`${fieldId}-category`}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-required="true"
            aria-invalid={errors.category !== undefined}
            aria-describedby={errors.category ? `${fieldId}-category-error` : undefined}
            className={fieldClasses}
          >
            <option value="">Choose a category…</option>
            {SEED_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {errors.category && (
            <p id={`${fieldId}-category-error`} className="mt-1.5 text-xs font-medium text-rose-600">
              {errors.category}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${fieldId}-brand`} className={labelClasses}>
            Brand <span className="font-medium normal-case text-stone-400">(optional)</span>
          </label>
          <input
            id={`${fieldId}-brand`}
            type="text"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            placeholder="Baker Creek"
            className={fieldClasses}
          />
        </div>

        <div>
          <label htmlFor={`${fieldId}-year`} className={labelClasses}>
            Purchase year
          </label>
          <input
            id={`${fieldId}-year`}
            type="number"
            inputMode="numeric"
            value={purchaseYear}
            min={EARLIEST_PURCHASE_YEAR}
            max={latestPurchaseYear}
            step={1}
            onChange={(event) => setPurchaseYear(event.target.value)}
            aria-invalid={errors.purchaseYear !== undefined}
            aria-describedby={errors.purchaseYear ? `${fieldId}-year-error` : undefined}
            className={fieldClasses}
          />
          {errors.purchaseYear && (
            <p id={`${fieldId}-year-error`} className="mt-1.5 text-xs font-medium text-rose-600">
              {errors.purchaseYear}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`${fieldId}-notes`} className={labelClasses}>
            Sowing notes <span className="font-medium normal-case text-stone-400">(optional)</span>
          </label>
          <textarea
            id={`${fieldId}-notes`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Start indoors six weeks before the last frost."
            className={`${fieldClasses} resize-y`}
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        >
          <Sprout className="h-4 w-4" aria-hidden="true" />
          Save packet
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-stone-600 transition-colors hover:bg-panel-sunken hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

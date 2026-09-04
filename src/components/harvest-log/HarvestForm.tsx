import { useId, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { Plus } from 'lucide-react';
import type { HarvestDraft } from '../../lib/harvest';
import { isValidIsoDate, roundWeight, todayIso } from '../../lib/harvest';

export interface HarvestFormProps {
  /** Suggestions for the variety datalist; free text is still accepted. */
  varieties: string[];
  onSubmit: (draft: HarvestDraft) => void;
}

interface FieldErrors {
  date?: string;
  variety?: string;
  weight?: string;
  count?: string;
  amount?: string;
}

const FIELD_CLASSES =
  'w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm transition-colors placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40';

const INVALID_FIELD_CLASSES = 'border-red-400 focus:border-red-500 focus:ring-red-500/40';

const LABEL_CLASSES = 'block text-sm font-semibold text-stone-700';

/** Empty means "not entered", which counts as zero rather than an error. */
function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Low-friction entry form: log a pick in four keystrokes and keep picking. */
export function HarvestForm({ varieties, onSubmit }: HarvestFormProps) {
  const fieldId = useId();
  const dateId = `${fieldId}-date`;
  const varietyId = `${fieldId}-variety`;
  const weightId = `${fieldId}-weight`;
  const countId = `${fieldId}-count`;
  const listId = `${fieldId}-varieties`;

  const [date, setDate] = useState<string>(() => todayIso());
  const [variety, setVariety] = useState('');
  const [weight, setWeight] = useState('');
  const [count, setCount] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const dateRef = useRef<HTMLInputElement>(null);
  const varietyRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const countRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: FieldErrors = {};
    const trimmedVariety = variety.trim();
    const parsedWeight = parseAmount(weight);
    const parsedCount = parseAmount(count);

    if (!date.trim()) {
      nextErrors.date = 'Pick the day you harvested.';
    } else if (!isValidIsoDate(date)) {
      nextErrors.date = 'That is not a real calendar date.';
    }

    if (!trimmedVariety) {
      nextErrors.variety = 'Name the variety you picked.';
    }

    if (parsedWeight === null) {
      nextErrors.weight = 'Weight needs to be a number.';
    } else if (parsedWeight < 0) {
      nextErrors.weight = 'Weight cannot be negative.';
    }

    if (parsedCount === null) {
      nextErrors.count = 'Count needs to be a number.';
    } else if (parsedCount < 0) {
      nextErrors.count = 'Count cannot be negative.';
    } else if (!Number.isInteger(parsedCount)) {
      nextErrors.count = 'Count has to be a whole number.';
    }

    if (
      !nextErrors.weight &&
      !nextErrors.count &&
      (parsedWeight ?? 0) <= 0 &&
      (parsedCount ?? 0) <= 0
    ) {
      nextErrors.amount = 'Add a weight or a count so the pick is worth logging.';
    }

    setErrors(nextErrors);

    const focusOrder: [keyof FieldErrors, RefObject<HTMLInputElement>][] = [
      ['date', dateRef],
      ['variety', varietyRef],
      ['weight', weightRef],
      ['count', countRef],
      ['amount', weightRef],
    ];
    const firstInvalid = focusOrder.find(([field]) => nextErrors[field]);

    if (firstInvalid) {
      firstInvalid[1].current?.focus();
      return;
    }

    onSubmit({
      date,
      variety: trimmedVariety,
      weightLbs: roundWeight(parsedWeight ?? 0),
      count: parsedCount ?? 0,
    });

    // The date is intentionally kept so one picking session logs quickly.
    setVariety('');
    setWeight('');
    setCount('');
    varietyRef.current?.focus();
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <Plus className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-stone-900">Log a pick</h3>
          <p className="text-sm text-stone-500">The date sticks between entries.</p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <label className={LABEL_CLASSES} htmlFor={dateId}>
            Date
          </label>
          <input
            ref={dateRef}
            id={dateId}
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-invalid={errors.date ? true : undefined}
            aria-describedby={errors.date ? `${dateId}-error` : undefined}
            className={`mt-1.5 ${FIELD_CLASSES} ${errors.date ? INVALID_FIELD_CLASSES : ''}`}
          />
          {errors.date && (
            <p id={`${dateId}-error`} role="alert" className="mt-1.5 text-sm text-red-600">
              {errors.date}
            </p>
          )}
        </div>

        <div>
          <label className={LABEL_CLASSES} htmlFor={varietyId}>
            Variety
          </label>
          <input
            ref={varietyRef}
            id={varietyId}
            type="text"
            required
            list={listId}
            autoComplete="off"
            placeholder="Cherokee Purple"
            value={variety}
            onChange={(event) => setVariety(event.target.value)}
            aria-invalid={errors.variety ? true : undefined}
            aria-describedby={errors.variety ? `${varietyId}-error` : `${varietyId}-hint`}
            className={`mt-1.5 ${FIELD_CLASSES} ${errors.variety ? INVALID_FIELD_CLASSES : ''}`}
          />
          <datalist id={listId}>
            {varieties.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          {errors.variety ? (
            <p id={`${varietyId}-error`} role="alert" className="mt-1.5 text-sm text-red-600">
              {errors.variety}
            </p>
          ) : (
            <p id={`${varietyId}-hint`} className="mt-1.5 text-xs text-stone-500">
              Pick from the vault or type anything you are growing.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASSES} htmlFor={weightId}>
              Weight (lbs)
            </label>
            <input
              ref={weightRef}
              id={weightId}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              aria-invalid={errors.weight ? true : undefined}
              aria-describedby={errors.weight ? `${weightId}-error` : undefined}
              className={`mt-1.5 ${FIELD_CLASSES} ${errors.weight ? INVALID_FIELD_CLASSES : ''}`}
            />
            {errors.weight && (
              <p id={`${weightId}-error`} role="alert" className="mt-1.5 text-sm text-red-600">
                {errors.weight}
              </p>
            )}
          </div>

          <div>
            <label className={LABEL_CLASSES} htmlFor={countId}>
              Count
            </label>
            <input
              ref={countRef}
              id={countId}
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              placeholder="0"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              aria-invalid={errors.count ? true : undefined}
              aria-describedby={errors.count ? `${countId}-error` : undefined}
              className={`mt-1.5 ${FIELD_CLASSES} ${errors.count ? INVALID_FIELD_CLASSES : ''}`}
            />
            {errors.count && (
              <p id={`${countId}-error`} role="alert" className="mt-1.5 text-sm text-red-600">
                {errors.count}
              </p>
            )}
          </div>
        </div>

        {errors.amount && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {errors.amount}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add harvest
      </button>
    </form>
  );
}

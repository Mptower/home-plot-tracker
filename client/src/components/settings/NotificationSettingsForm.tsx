import { useEffect, useId, useState } from 'react';
import { Bell, BellOff, Check, Loader2, Moon } from 'lucide-react';
import type { GardenSettings } from '../../types';
import type { ApiIssue } from '../../lib/apiClient';
import {
  URGENT_WITHIN_HOURS,
  describeQuietHours,
  isTimeOfDay,
  isValidSettings,
  quietHoursDisabled,
  settingsEqual,
} from '../../lib/settings';

export interface NotificationSettingsFormProps {
  /** What the server says is stored. The draft is reset whenever this changes. */
  saved: GardenSettings;
  isSaving: boolean;
  saveError: string | null;
  saveIssues: ApiIssue[];
  savedAt: number | null;
  onSave: (settings: GardenSettings) => void;
}

const FIELD_CLASSES =
  'w-full rounded-xl border border-panel-edge bg-panel px-3 py-2 text-sm text-stone-900 shadow-sm transition-colors placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40';

const INVALID_FIELD_CLASSES = 'border-red-400 focus:border-red-500 focus:ring-red-500/40';

const LABEL_CLASSES = 'block text-sm font-semibold text-stone-700';

/**
 * The only editable thing on the Settings page.
 *
 * Saving is explicit. A control that saved on every keystroke would send a
 * request per digit of a time field, and `21:0` is a state every two-key edit
 * passes through — so the form holds a draft and one button sends it.
 */
export function NotificationSettingsForm({
  saved,
  isSaving,
  saveError,
  saveIssues,
  savedAt,
  onSave,
}: NotificationSettingsFormProps) {
  const fieldId = useId();
  const toggleId = `${fieldId}-notifications`;
  const startId = `${fieldId}-quiet-start`;
  const endId = `${fieldId}-quiet-end`;

  const [draft, setDraft] = useState<GardenSettings>(saved);

  // The server's answer wins whenever it changes — on the first load, and after
  // every save, where what came back is what is actually stored.
  useEffect(() => setDraft(saved), [saved]);

  const dirty = !settingsEqual(draft, saved);
  const valid = isValidSettings(draft);
  const quietOff = quietHoursDisabled(draft);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && dirty) onSave(draft);
      }}
      className="rounded-2xl border border-panel-edge bg-panel p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          {draft.frostNotifications ? (
            <Bell className="h-5 w-5" aria-hidden="true" />
          ) : (
            <BellOff className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-stone-900">Frost notifications</h3>
          <p className="text-sm text-stone-500">Sent to your phone through Home Assistant.</p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-panel-edge bg-panel-sunken px-4 py-3.5">
          <label className="min-w-0 cursor-pointer" htmlFor={toggleId}>
            <span className="block text-sm font-semibold text-stone-800">
              Warn me before a frost
            </span>
            <span className="mt-0.5 block text-sm leading-relaxed text-stone-500">
              Only when something tender is actually planted &mdash; or when it is cold enough that
              even the hardy crops are in trouble.
            </span>
          </label>

          <button
            id={toggleId}
            type="button"
            role="switch"
            aria-checked={draft.frostNotifications}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                frostNotifications: !current.frostNotifications,
              }))
            }
            className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel ${
              draft.frostNotifications ? 'bg-emerald-600' : 'bg-stone-300'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                draft.frostNotifications ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
            <span className="sr-only">
              {draft.frostNotifications
                ? 'Frost notifications are on'
                : 'Frost notifications are off'}
            </span>
          </button>
        </div>

        <fieldset className="rounded-2xl border border-panel-edge bg-panel-sunken px-4 py-4">
          <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-stone-800">
            <Moon className="h-4 w-4 text-stone-500" aria-hidden="true" />
            Quiet hours
          </legend>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASSES} htmlFor={startId}>
                From
              </label>
              <input
                id={startId}
                type="time"
                value={draft.quietHoursStart}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, quietHoursStart: event.target.value }))
                }
                aria-invalid={isTimeOfDay(draft.quietHoursStart) ? undefined : true}
                className={`mt-1.5 ${FIELD_CLASSES} ${
                  isTimeOfDay(draft.quietHoursStart) ? '' : INVALID_FIELD_CLASSES
                }`}
              />
            </div>

            <div>
              <label className={LABEL_CLASSES} htmlFor={endId}>
                Until
              </label>
              <input
                id={endId}
                type="time"
                value={draft.quietHoursEnd}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, quietHoursEnd: event.target.value }))
                }
                aria-invalid={isTimeOfDay(draft.quietHoursEnd) ? undefined : true}
                className={`mt-1.5 ${FIELD_CLASSES} ${
                  isTimeOfDay(draft.quietHoursEnd) ? '' : INVALID_FIELD_CLASSES
                }`}
              />
            </div>
          </div>

          <p
            role="status"
            className={`mt-3 rounded-xl px-3 py-2 text-sm leading-relaxed ${
              quietOff ? 'bg-amber-50 text-amber-900' : 'bg-panel text-stone-600'
            }`}
          >
            {describeQuietHours(draft)}
          </p>

          <p className="mt-2 px-1 text-xs leading-relaxed text-stone-500">
            Set both times to the same value to switch quiet hours off completely.
          </p>
        </fieldset>

        {/*
          The override, stated plainly and next to the control it modifies.
          Without it the first warning that arrives at 2am reads as a bug, and a
          frost warning she has learned to distrust is worse than none at all.
        */}
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-amber-900">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-800">
            <Bell className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="min-w-0 text-sm leading-relaxed">
            <span className="font-semibold">Quiet hours have one exception.</span> If the frost is
            less than {URGENT_WITHIN_HOURS} hours away, the warning is sent anyway &mdash; waiting
            until morning would be after the frost, and too late to cover anything.
          </p>
        </div>

        {saveError && (
          <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            <p className="font-semibold">{saveError}</p>
            {saveIssues.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {saveIssues.map((issue) => (
                  <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!valid || !dirty || isSaving}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500 disabled:shadow-none"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
          {isSaving ? 'Saving' : 'Save settings'}
        </button>

        {dirty && !isSaving && (
          <button
            type="button"
            onClick={() => setDraft(saved)}
            className="rounded-xl border border-panel-edge bg-panel px-3 py-2 text-sm font-semibold text-stone-600 transition-colors hover:bg-panel-sunken hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            Discard changes
          </button>
        )}

        <p role="status" className="text-sm text-stone-500">
          {dirty
            ? 'Not saved yet.'
            : savedAt !== null
              ? 'Saved. This takes effect straight away — nothing needs restarting.'
              : 'Everything here is saved.'}
        </p>
      </div>
    </form>
  );
}

/**
 * The frost warning.
 *
 * Amber, never red. This is a garden, not a fire alarm: the worst case is that
 * she loses some tomatoes, and a banner that shouts will be dismissed on sight
 * long before the night it matters. The severity is carried by the words and
 * the icon, not by the colour.
 *
 * What makes it worth reading is that it names *her* plants. "Frost Saturday
 * night" is what her phone's weather app already says. "Frost Saturday night,
 * 30°F — your Cherokee Purple and Black Beauty in Bed 1 are tender" is the part
 * that is only possible because the app knows what is in the ground.
 *
 * It also says what will be *fine*, which is most of the point. A warning that
 * only lists losses reads as alarm; one that says "your kale and onions will be
 * fine" reads as somebody who knows the garden telling her which half to worry
 * about. And when there are squares it cannot classify, it says so rather than
 * quietly leaving them out — being honest about the gap is what makes the rest
 * of it trustworthy.
 */
import { useCallback, useEffect, useState } from 'react';
import { Snowflake, X } from 'lucide-react';
import type { BedAtRisk, FrostWatch } from '../types';
import { useFrostWatch } from '../hooks/useFrostWatch';

const DISMISSED_KEY = 'hpt.frostDismissed';

/** English list: `a`, `a and b`, `a, b and c`. */
function joinNames(names: readonly string[], limit = 3): string {
  const shown = names.slice(0, limit);
  const extra = names.length - shown.length;
  const joined =
    shown.length <= 1
      ? (shown[0] ?? '')
      : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;

  return extra > 0 ? `${joined} and ${extra} more` : joined;
}

/** "Saturday night", "tonight" — how she would say it, not `2026-10-11`. */
function describeNight(night: string, now = new Date()): string {
  const [year, month, day] = night.split('-').map(Number);

  if (!year || !month || !day) return night;

  const date = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);

  if (days === 0) return 'tonight';
  if (days === 1) return 'tomorrow night';
  if (days > 1 && days <= 6) {
    return `${date.toLocaleDateString(undefined, { weekday: 'long' })} night`;
  }

  return `the night of ${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`;
}

/** "around 5am" — only when the forecast was hourly enough to know. */
function describeTime(watch: FrostWatch): string | null {
  if (watch.precision !== 'hour') return null;

  const at = new Date(watch.expectedAt);

  if (Number.isNaN(at.getTime())) return null;

  return at.toLocaleTimeString(undefined, { hour: 'numeric' }).replace(/\s/g, '').toLowerCase();
}

const HEADLINE: Record<string, string> = {
  advisory: 'Frost possible',
  frost: 'Frost',
  hard_freeze: 'Hard freeze',
};

function bedsWithTender(beds: readonly BedAtRisk[]): BedAtRisk[] {
  return beds.filter((bed) => bed.tender.length > 0);
}

export function FrostBanner() {
  const watch = useFrostWatch();
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  });

  // Keyed on the event rather than a boolean, so dismissing this weekend's
  // frost does not also dismiss the next one. Because the key carries the
  // severity band, a snap that gets worse comes back on its own.
  const handleDismiss = useCallback(() => {
    if (!watch) return;

    setDismissed(watch.eventKey);

    try {
      localStorage.setItem(DISMISSED_KEY, watch.eventKey);
    } catch {
      // A browser with storage disabled just gets a banner that comes back.
    }
  }, [watch]);

  // Once the cold snap has passed, drop the record so the key cannot linger and
  // suppress an unrelated future event that happens to hash the same way.
  useEffect(() => {
    if (watch === null || dismissed === null || watch.eventKey === dismissed) return;

    try {
      localStorage.removeItem(DISMISSED_KEY);
    } catch {
      // Nothing to do; the in-memory state below is what actually gates it.
    }

    setDismissed(null);
  }, [watch, dismissed]);

  if (watch === null) return null;
  // `none` means cold is coming but nothing planted minds it. Nothing to say.
  if (watch.severity === 'none') return null;
  if (dismissed === watch.eventKey) return null;

  const when = describeNight(watch.night);
  const time = describeTime(watch);
  const beds = bedsWithTender(watch.bedsAtRisk);
  const tender = joinNames(watch.tenderVarieties);
  const bedNames = joinNames(beds.map((bed) => bed.bedName));

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm sm:p-5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-800">
        <Snowflake className="h-5 w-5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold sm:text-base">
          {HEADLINE[watch.severity] ?? 'Cold'} {when}, {Math.round(watch.lowF)}°F
        </h3>

        <p className="mt-1 max-w-prose text-sm leading-relaxed text-amber-800">
          {tender !== '' ? (
            <>
              Your {tender}
              {bedNames !== '' ? ` in ${bedNames}` : ''}{' '}
              {watch.tenderVarieties.length === 1 ? 'is' : 'are'} tender.
            </>
          ) : (
            <>Everything planted is at risk at this temperature.</>
          )}
          {time !== null && ` Coldest around ${time}.`}
        </p>

        {watch.severity !== 'hard_freeze' && watch.hardyVarieties.length > 0 && (
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-amber-800">
            Your {joinNames(watch.hardyVarieties)} should be fine.
          </p>
        )}

        {watch.unknownSquareCount > 0 && (
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-amber-700">
            {watch.unknownSquareCount}{' '}
            {watch.unknownSquareCount === 1 ? 'square has' : 'squares have'} no crop family
            recorded, so this can&rsquo;t speak for{' '}
            {watch.unknownSquareCount === 1 ? 'it' : 'them'}.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss this frost warning"
        className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        Dismiss
      </button>
    </div>
  );
}

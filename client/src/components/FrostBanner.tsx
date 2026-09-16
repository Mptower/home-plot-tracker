/**
 * The frost warning.
 *
 * Amber, never red. This is a garden, not a fire alarm: the worst case is that
 * she loses some tomatoes, and a banner that shouts will be dismissed on sight
 * long before the night it matters. The severity is carried by the words and
 * the icon, not by the colour.
 *
 * What makes it worth reading is that it names *her* plants, and says what to
 * do about them. "Frost Saturday night" is what her phone's weather app already
 * says; "Cover your Cherokee Purple and Black Beauty in Bed 1 — it'll be
 * coldest around 5am" is the part that is only possible because the app knows
 * what is in the ground.
 *
 * It also says what will be *fine*, which is most of the point. A warning that
 * only lists losses reads as alarm; one that says "the Lacinato Kale should be
 * fine" reads as somebody who knows the garden telling her which half to worry
 * about. And when there are squares it cannot speak for, it says so rather than
 * quietly leaving them out — being honest about the gap is what makes the rest
 * of it trustworthy.
 *
 * ## The words come from `@hpt/shared`, and that is the point
 *
 * This banner and the notification on her phone describe the same cold night.
 * They had drifted into two voices: the phone said "Cover your Cherry Tomato in
 * Tomato bed", and this said "Your Cherry Tomato in Tomato bed are tender" — so
 * the screen she was actually looking at, while deciding whether to go outside,
 * was the one still speaking the old language. Both now compose from
 * `frostSentences`, which is where any future wording change belongs.
 *
 * ## What this surface does differently, and why
 *
 * A notification is read on a lock screen, so it names at most three crops and
 * three beds and gives whole sentences up to stay under a length ceiling. None
 * of that applies here. This is a panel at the top of a page she has already
 * chosen to look at, with room to spare, so it passes `Infinity` for both
 * limits and renders every sentence it is given — including the two the
 * notification drops first, which at a hard freeze are the ones saying that a
 * cover will not save anything and that even the hardy crops may be hurt.
 *
 * The clock stays local to each surface: the server reads her zone from the
 * `TZ` Supervisor injects into the add-on container, the browser reads the
 * device. So `describeNight` and `describeTime` are here, deliberately
 * duplicated from the server's, and the shared voice takes their output rather
 * than reading a clock of its own.
 */
import { useCallback, useEffect, useState } from 'react';
import { Snowflake, X } from 'lucide-react';
import { coldestHour, frostHeadline, frostSentences } from '@hpt/shared';
import type { ColdestHour } from '@hpt/shared';
import type { FrostWatch } from '../types';
import { useFrostWatch } from '../hooks/useFrostWatch';

const DISMISSED_KEY = 'hpt.frostDismissed';

/**
 * The banner is not a lock screen, so it spends none of a lock screen's
 * economies.
 *
 * Both limits exist in the shared voice because a notification has to fit. Here
 * they would only hide garden she owns: five beds are five names, and "spread
 * across 5 beds" tells her less than the list does while saving nothing worth
 * saving. Listing every bed also retires the last of the double-`and` reading
 * this file used to produce — "in Tomato bed, Bed 2 and Bed 3 and 2 more",
 * which parses as a bed called "2 more".
 */
const ROOM_TO_LIST = { nameLimit: Infinity, bedLimit: Infinity };

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

/**
 * "5am" — only when the forecast was hourly enough to know; `''` when not.
 *
 * `ColdestHour`, not `string`: the shared voice builds the clause around this,
 * so passing it the finished clause renders the preamble twice.
 */
function describeTime(watch: FrostWatch): ColdestHour {
  if (watch.precision !== 'hour') return coldestHour('');

  const at = new Date(watch.expectedAt);

  if (Number.isNaN(at.getTime())) return coldestHour('');

  // The `.replace` is load-bearing, not cosmetic: en-US renders "5 AM" and
  // de-DE "05 Uhr", and `coldestHour` refuses whitespace — so deleting it
  // silently costs her the hour. Pinned by `client/test/frostVoice.test.ts`.
  return coldestHour(
    at.toLocaleTimeString(undefined, { hour: 'numeric' }).replace(/\s/g, '').toLowerCase(),
  );
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
  // `none` means cold is coming but nothing planted minds it. Nothing to say,
  // so the "nothing you've planted should mind" sentence never reaches a
  // screen from here.
  if (watch.severity === 'none') return null;
  if (dismissed === watch.eventKey) return null;

  const headline = frostHeadline(watch, describeNight(watch.night));
  const said = frostSentences(watch, describeTime(watch), ROOM_TO_LIST);

  // The caveat explains the instruction it follows, so it stays in that
  // paragraph. The aside is the hard-freeze counterpart of the reassurance —
  // both answer "and what about everything else?" — so they share the second
  // paragraph, and only one of them is ever set.
  const instruction = [...said.lead, said.caveat].filter((sentence) => sentence !== '').join(' ');
  const everythingElse = said.aside !== '' ? said.aside : said.reassurance;

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm sm:p-5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-800">
        <Snowflake className="h-5 w-5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold sm:text-base">{headline}</h3>

        <p className="mt-1 max-w-prose text-sm leading-relaxed text-amber-800">{instruction}</p>

        {everythingElse !== '' && (
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-amber-800">
            {everythingElse}
          </p>
        )}

        {said.unrecorded !== '' && (
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-amber-700">
            {said.unrecorded}
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

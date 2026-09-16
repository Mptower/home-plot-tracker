/**
 * The words a frost warning is made of.
 *
 * Two surfaces warn her about the same cold night: the notification on her lock
 * screen and the banner at the top of the app. They had drifted into two
 * voices. The phone said *Cover your Cherry Tomato in Tomato bed*; the app, on
 * the same frost, said *Your Cherry Tomato in Tomato bed are tender* — so the
 * screen she was actually looking at while deciding whether to go outside was
 * the one still speaking the old language. This file is the fix, and it is a
 * shared module rather than a copied convention because a copied convention is
 * exactly what produced the seam.
 *
 * The voice, in four rules:
 *
 * 1. **Lead with the thing to go and do.** A frost warning exists to make
 *    someone go outside with a bedsheet. The verb and the crop names come
 *    first, because on a lock screen the first clause is the only part
 *    guaranteed to be read.
 * 2. **No botanical vocabulary.** She does not have to know what a nightshade
 *    is to use the rest of this app, and she should not have to know what
 *    "tender" or "crop family" mean to read a warning at ten at night.
 * 3. **Whole sentences**, with the hedges intact. "Should be fine", never "will
 *    be fine": this is a forecast, and over-promising in a frost warning costs
 *    a crop.
 * 4. **At most one em dash per sentence.** It carries the bed list when there
 *    is more than one bed, and the coldest hour otherwise. Two in one sentence
 *    is where the old wording lost her.
 *
 * ## What is *not* here
 *
 * No clock. `frostSentences` takes the coldest hour as a finished label and
 * never reads one, because the two surfaces read different clocks: the server
 * renders her zone from an ambient `TZ` that Supervisor injects into the
 * container, and the browser renders whatever the device is set to. The server
 * side of that is measured, delicate and pinned by forced-`TZ` tests — see the
 * header of `server/src/ha/notifier.ts` — and moving any of it in here would
 * put a load-bearing timezone dependence somewhere neither of those tests can
 * see it. `describeNight` and `describeTime` stay where they are; this module
 * takes their output.
 *
 * ## What each surface is allowed to differ on
 *
 * Only the *economies*, never the words. A lock screen truncates, so the
 * notification lists at most three crops and three beds and drops whole
 * sentences to stay under its ceiling. The banner has a screen and no ceiling,
 * so it passes `Infinity` for both limits and renders every sentence it is
 * given. Those are the options below, and they are deliberately the only knobs:
 * anything else a caller wants to phrase differently is a drift, and belongs
 * here as a decision made once.
 */
import type { BedAtRisk, FrostSeverity, FrostWatch } from './homeAssistant.js';

/**
 * English list: `a`, `a and b`, `a, b and c`, `a, b, c and 2 more`.
 *
 * With an overflow the whole list goes comma-separated and "and 2 more" is the
 * final item, so it never reads "Basil and Cherokee Purple and 2 more". The
 * banner used to carry its own copy that did exactly that.
 *
 * `limit` of `Infinity` lists everything, which is what a surface with room
 * should pass.
 */
export function joinNames(names: readonly string[], limit = 3): string {
  const shown = names.slice(0, limit);
  const extra = names.length - shown.length;

  if (shown.length === 0) return '';

  if (extra > 0) return `${shown.join(', ')} and ${extra} more`;
  if (shown.length === 1) return shown[0] ?? '';

  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

/**
 * What she should actually do about it, by band.
 *
 * The verb changes at a hard freeze on purpose. A bedsheet over a tomato buys
 * two or three degrees, which is the whole point of the 36°F advisory band and
 * still worth doing at 31°F. At 24°F it saves nothing, and an instruction she
 * finds false in the morning costs more than one she never got — so below the
 * hard-freeze threshold the honest advice is to take off what is worth keeping.
 */
const ACTION_VERB: Readonly<Record<FrostSeverity, string>> = {
  none: '',
  advisory: 'Cover your',
  frost: 'Cover your',
  hard_freeze: 'Pick what you can from your',
};

/** How the band is named where it is announced. */
const SEVERITY_WORD: Readonly<Record<FrostSeverity, string>> = {
  none: 'Cold',
  advisory: 'Frost possible',
  frost: 'Frost',
  hard_freeze: 'Hard freeze',
};

/**
 * Past this many beds the names stop being useful *on a lock screen*.
 *
 * Two or three she can picture; at five she is going out to the whole garden
 * anyway, and a count is both shorter and truer than a list with "and 2 more"
 * on the end of it. This is an economy, not a rule about the garden, which is
 * why it is an option: the banner has room to name all five.
 */
const BED_LIMIT = 3;

/** Same economy, for crop names. */
const NAME_LIMIT = 3;

/** Said when there is genuinely nothing to do. */
const NOTHING_MINDS = "Nothing you've planted should mind a night this cold.";

/** How much of the garden a surface has room to name. */
export interface FrostVoiceOptions {
  /** Crop names listed before the rest become "and 2 more". `Infinity` lists all. */
  nameLimit?: number;
  /** Beds named before they collapse to a count. `Infinity` lists all. */
  bedLimit?: number;
}

/**
 * One frost, broken into the sentences that describe it.
 *
 * Every field is either a finished sentence or the empty string, so a caller
 * decides only *whether* to show each one — never how to word it. `action` is
 * the exception and is documented on the field.
 */
export interface FrostSentences {
  /**
   * The instruction, and where.
   *
   * Sometimes an unfinished clause — `Cover your Cherry Tomato in Tomato bed` —
   * because when the em dash has not already been spent on a bed list it is
   * better spent fusing the coldest hour onto the end. `actionIsOpenClause`
   * says which shape this is; `lead` has it already resolved.
   */
  action: string;
  /** True while `action` is a clause the hour can hang off rather than a sentence. */
  actionIsOpenClause: boolean;
  /** `It'll be coldest around 5am.`, or `''` on a forecast too coarse to know. */
  hour: string;
  /** `action` and `hour` resolved into one or two finished sentences. */
  lead: string[];
  /** `A cover won't be enough this cold.` — why a hard freeze changed the verb. */
  caveat: string;
  /** `Even the Lacinato Kale may take damage.` — the hardy crops, at hard freeze. */
  aside: string;
  /** `The Lacinato Kale should be fine.` — the reassuring half, below hard freeze. */
  reassurance: string;
  /** `3 squares don't have a plant recorded, so they're not included.` */
  unrecorded: string;
}

function bedsHoldingTender(beds: readonly BedAtRisk[]): string[] {
  return beds.filter((bed) => bed.tender.length > 0).map((bed) => bed.bedName);
}

/** A clause promoted to a sentence: `it'll be …` becomes `It'll be ….`. */
function capitalise(clause: string): string {
  if (clause === '') return '';

  return `${clause.slice(0, 1).toUpperCase()}${clause.slice(1)}.`;
}

/**
 * The headline: `Frost tomorrow night — 31°F`.
 *
 * `nightLabel` comes from the caller for the same reason `hourLabel` does — it
 * is a reading of a clock, and each surface has its own. Both surfaces render
 * this identically, which matters more here than anywhere else in the file: the
 * headline is the first thing read on the lock screen and the first thing read
 * in the app, and two different ones is the seam at its most visible.
 */
export function frostHeadline(watch: FrostWatch, nightLabel: string): string {
  return `${SEVERITY_WORD[watch.severity]} ${nightLabel} — ${Math.round(watch.lowF)}°F`;
}

/**
 * Everything there is to say about one frost, in her language.
 *
 * Pure: no clock, no locale, no environment. `hourLabel` is `5am` or `''`.
 */
export function frostSentences(
  watch: FrostWatch,
  hourLabel: string,
  options: FrostVoiceOptions = {},
): FrostSentences {
  const nameLimit = options.nameLimit ?? NAME_LIMIT;
  const bedLimit = options.bedLimit ?? BED_LIMIT;

  const bedNames = bedsHoldingTender(watch.bedsAtRisk);
  const crops = joinNames(watch.tenderVarieties, nameLimit);
  const hardy = joinNames(watch.hardyVarieties, nameLimit);

  /** True while the opening is an unfinished clause the hour can hang off. */
  let actionIsOpenClause = false;
  let action: string;

  if (watch.severity !== 'none' && crops !== '') {
    const verb = ACTION_VERB[watch.severity];
    const they = watch.tenderVarieties.length === 1 ? "it's" : "they're";

    if (bedNames.length === 0) {
      action = `${verb} ${crops}`;
      actionIsOpenClause = true;
    } else if (bedNames.length === 1) {
      // One bed is unambiguous inline, and it leaves the dash free for the hour.
      action = `${verb} ${crops} in ${bedNames[0]}`;
      actionIsOpenClause = true;
    } else if (bedNames.length <= bedLimit) {
      action = `${verb} ${crops} — ${they} in ${joinNames(bedNames, bedLimit)}.`;
    } else {
      action = `${verb} ${crops} — ${they} spread across ${bedNames.length} beds.`;
    }
  } else if (watch.severity === 'hard_freeze') {
    action =
      hardy === ''
        ? "It's cold enough to damage anything still in the ground."
        : `It's cold enough to damage even your ${hardy}.`;
  } else {
    // Nothing tender in the ground and not a hard freeze, so there is nothing
    // to ask of her. Neither surface reaches this — the notifier refuses both
    // `severity: 'none'` and an empty tender list before composing, and the
    // banner returns `null` on `none` — but both can be called with it, and
    // dead wording rots.
    action = NOTHING_MINDS;
  }

  /** The clause, so the sentence and the fused form cannot word it differently. */
  const hourClause = hourLabel === '' ? '' : `it'll be coldest around ${hourLabel}`;
  const hour = capitalise(hourClause);

  let lead: string[];

  if (actionIsOpenClause) {
    // The dash is still free, so the hour fuses on rather than starting a
    // second sentence that would only say "It'll".
    lead = hourClause === '' ? [`${action}.`] : [`${action} — ${hourClause}.`];
  } else {
    lead = hour === '' ? [action] : [action, hour];
  }

  let caveat = '';
  let aside = '';
  let reassurance = '';

  if (watch.severity === 'hard_freeze' && crops !== '') {
    // Says why it did not just tell her to cover them.
    caveat = "A cover won't be enough this cold.";
    if (hardy !== '') aside = `Even the ${hardy} may take damage.`;
  } else if (
    watch.severity !== 'hard_freeze' &&
    watch.severity !== 'none' &&
    hardy !== '' &&
    crops !== ''
  ) {
    reassurance = `The ${hardy} should be fine.`;
  }

  // "No plant recorded", not "no crop family recorded". She has never used the
  // words "crop family", and after the plant catalogue landed she does not have
  // to: a square is something she planted or it is blank.
  const squares = watch.unknownSquareCount;
  const unrecorded =
    squares <= 0
      ? ''
      : squares === 1
        ? "1 square doesn't have a plant recorded, so it's not included."
        : `${squares} squares don't have a plant recorded, so they're not included.`;

  return { action, actionIsOpenClause, hour, lead, caveat, aside, reassurance, unrecorded };
}

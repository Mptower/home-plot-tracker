/**
 * Shapes a bare hour never has, and the clause that caused this always does.
 *
 * Whitespace is the load-bearing half. Both surfaces render the hour through
 * `toLocaleTimeString(…, { hour: 'numeric' }).replace(/\s/g, '')`, so a real
 * label has no whitespace in any locale, while every clause has some. The
 * `coldest` check is the belt to that braces: it catches a clause that has had
 * its spaces stripped, which is the one way the first test can be fooled.
 *
 * ## Callers must normalise before constructing. That is not optional
 *
 * ICU puts whitespace inside a perfectly legitimate hour: `en-US` renders
 * `5 AM` and `de-DE` renders `05 Uhr`. Handed either of those raw, this rejects
 * it and the hour is silently dropped — the guard reintroducing, for a whole
 * locale, the exact failure it exists to prevent. What makes that safe is the
 * `.replace(/\s/g, '')` in **both** `describeTime` implementations
 * (`server/src/ha/notifier.ts`, `client/src/components/FrostBanner.tsx`), which
 * runs before `coldestHour` ever sees the string.
 *
 * So that `.replace` is load-bearing in two other files, and deleting it looks
 * exactly like tidying. `client/test/frostVoice.test.ts` pins it in both of
 * them; do not remove it there either.
 *
 * ## Why this does not simply strip the whitespace itself
 *
 * That is the obvious simplification, it would make the callers' `.replace`
 * redundant, and it is actively worse. Stripping here turns the misuse
 * `'around 5am'` into `'around5am'`, which carries no whitespace, is not long
 * enough to trip the bound and does not contain "coldest" — so it sails through
 * and renders `it'll be coldest around around5am`. That is a *new* variant of
 * the exact bug this guard exists for, reachable from the same mistake by a
 * caller who trimmed the first two words off. Rejecting whitespace catches
 * strictly more than normalising it, so the normalising belongs upstream in the
 * two places that know they are formatting a clock.
 *
 * Deliberately *not* a format like `/^\d{1,2}(am|pm)$/`. The banner renders the
 * device's locale, so a 24-hour or non-English clock produces `17` or `午後5時`,
 * and a pattern written around American English would quietly drop the hour for
 * anyone it had not anticipated — the same failure, from the other direction.
 * `de-DE` is the one that makes this concrete: it renders `05 Uhr`, so a guard
 * narrowed to the AM/PM shape would break German while still passing a test
 * written only against `en-US`.
 */
const NOT_A_BARE_HOUR = /\s|—|coldest/i;
/**
 * A sanity bound, not a format.
 *
 * No locale renders a single hour longer than this, and a notification has a
 * 200-character ceiling it gives real sentences up to stay under — so a runaway
 * label costs her the reassurance rather than just looking odd.
 */
const HOUR_MAX_CHARS = 12;
/**
 * The only way to make a {@link ColdestHour}. `5am` in, `5am` out.
 *
 * ## On invalid input it returns `''` rather than throwing
 *
 * Her frost notifications are switched off, so the banner is currently the only
 * frost warning that reaches her at all, and a throw in here would blank it.
 * Falling back to `''` costs exactly one sentence — the hour — and keeps the
 * instruction, which is the part that makes her go outside with a bedsheet. A
 * warning that has lost the word "5am" is worth vastly more than no warning,
 * and treating a missing hour as a normal answer rather than an error is what
 * the rest of this module already does: `''` is the documented, well-tested
 * value for a forecast too coarse to know one.
 *
 * The cost of that choice is honest: a caller passing rubbish is told nothing
 * at runtime, and simply gets a shorter warning. That is the trade — a silent
 * missing sentence over a loud missing banner — and it is why the type above
 * exists to make the mistake unreachable from TypeScript in the first place,
 * and why {@link isColdestHour} is exported for callers the type cannot reach.
 */
export function coldestHour(label) {
    const trimmed = label.trim();
    if (trimmed.length > HOUR_MAX_CHARS)
        return '';
    if (NOT_A_BARE_HOUR.test(trimmed))
        return '';
    return trimmed;
}
/**
 * Whether `label` is already a canonical bare hour.
 *
 * Exported for the callers the brand cannot help. A JavaScript caller gets no
 * compile-time error and — by the deliberate choice above — no runtime one
 * either, so without this its only signal that it got the argument wrong is a
 * sentence quietly missing from the output. This is how such a caller, or a
 * verification harness like the one that found the original bug, can ask.
 */
export function isColdestHour(label) {
    return coldestHour(label) === label;
}
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
export function joinNames(names, limit = 3) {
    const shown = names.slice(0, limit);
    const extra = names.length - shown.length;
    if (shown.length === 0)
        return '';
    if (extra > 0)
        return `${shown.join(', ')} and ${extra} more`;
    if (shown.length === 1)
        return shown[0] ?? '';
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
const ACTION_VERB = {
    none: '',
    advisory: 'Cover your',
    frost: 'Cover your',
    hard_freeze: 'Pick what you can from your',
};
/** How the band is named where it is announced. */
const SEVERITY_WORD = {
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
function bedsHoldingTender(beds) {
    return beds.filter((bed) => bed.tender.length > 0).map((bed) => bed.bedName);
}
/** A clause promoted to a sentence: `it'll be …` becomes `It'll be ….`. */
function capitalise(clause) {
    if (clause === '')
        return '';
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
export function frostHeadline(watch, nightLabel) {
    return `${SEVERITY_WORD[watch.severity]} ${nightLabel} — ${Math.round(watch.lowF)}°F`;
}
/**
 * Everything there is to say about one frost, in her language.
 *
 * Pure: no clock, no locale, no environment. `hourLabel` is a
 * {@link ColdestHour} — `5am`, or `''` on a forecast too coarse to know one —
 * and is re-checked here rather than trusted, because the brand is erased
 * before this function exists as far as a JavaScript caller is concerned. See
 * {@link ColdestHour} for the doubled-preamble bug that check is for.
 */
export function frostSentences(watch, hourLabel, options = {}) {
    const nameLimit = options.nameLimit ?? NAME_LIMIT;
    const bedLimit = options.bedLimit ?? BED_LIMIT;
    const bedNames = bedsHoldingTender(watch.bedsAtRisk);
    const crops = joinNames(watch.tenderVarieties, nameLimit);
    const hardy = joinNames(watch.hardyVarieties, nameLimit);
    /** True while the opening is an unfinished clause the hour can hang off. */
    let actionIsOpenClause = false;
    let action;
    if (watch.severity !== 'none' && crops !== '') {
        const verb = ACTION_VERB[watch.severity];
        const they = watch.tenderVarieties.length === 1 ? "it's" : "they're";
        if (bedNames.length === 0) {
            action = `${verb} ${crops}`;
            actionIsOpenClause = true;
        }
        else if (bedNames.length === 1) {
            // One bed is unambiguous inline, and it leaves the dash free for the hour.
            action = `${verb} ${crops} in ${bedNames[0]}`;
            actionIsOpenClause = true;
        }
        else if (bedNames.length <= bedLimit) {
            action = `${verb} ${crops} — ${they} in ${joinNames(bedNames, bedLimit)}.`;
        }
        else {
            action = `${verb} ${crops} — ${they} spread across ${bedNames.length} beds.`;
        }
    }
    else if (watch.severity === 'hard_freeze') {
        action =
            hardy === ''
                ? "It's cold enough to damage anything still in the ground."
                : `It's cold enough to damage even your ${hardy}.`;
    }
    else {
        // Nothing tender in the ground and not a hard freeze, so there is nothing
        // to ask of her. Neither surface reaches this — the notifier refuses both
        // `severity: 'none'` and an empty tender list before composing, and the
        // banner returns `null` on `none` — but both can be called with it, and
        // dead wording rots.
        action = NOTHING_MINDS;
    }
    /** The clause, so the sentence and the fused form cannot word it differently. */
    // Re-derived rather than trusted: a JavaScript caller can hand this anything,
    // and handing it a whole clause is what produced "it'll be coldest around
    // it'll be coldest around 3am". `coldestHour` leaves a real hour untouched,
    // so this costs a valid caller nothing.
    const bareHour = coldestHour(hourLabel);
    const hourClause = bareHour === '' ? '' : `it'll be coldest around ${bareHour}`;
    const hour = capitalise(hourClause);
    let lead;
    if (actionIsOpenClause) {
        // The dash is still free, so the hour fuses on rather than starting a
        // second sentence that would only say "It'll".
        lead = hourClause === '' ? [`${action}.`] : [`${action} — ${hourClause}.`];
    }
    else {
        lead = hour === '' ? [action] : [action, hour];
    }
    let caveat = '';
    let aside = '';
    let reassurance = '';
    if (watch.severity === 'hard_freeze' && crops !== '') {
        // Says why it did not just tell her to cover them.
        caveat = "A cover won't be enough this cold.";
        if (hardy !== '')
            aside = `Even the ${hardy} may take damage.`;
    }
    else if (watch.severity !== 'hard_freeze' &&
        watch.severity !== 'none' &&
        hardy !== '' &&
        crops !== '') {
        reassurance = `The ${hardy} should be fine.`;
    }
    // "No plant recorded", not "no crop family recorded". She has never used the
    // words "crop family", and after the plant catalogue landed she does not have
    // to: a square is something she planted or it is blank.
    const squares = watch.unknownSquareCount;
    const unrecorded = squares <= 0
        ? ''
        : squares === 1
            ? "1 square doesn't have a plant recorded, so it's not included."
            : `${squares} squares don't have a plant recorded, so they're not included.`;
    return { action, actionIsOpenClause, hour, lead, caveat, aside, reassurance, unrecorded };
}
//# sourceMappingURL=frostVoice.js.map
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
 * Pure: no clock, no locale, no environment. `hourLabel` is `5am` or `''`.
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
    const hourClause = hourLabel === '' ? '' : `it'll be coldest around ${hourLabel}`;
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
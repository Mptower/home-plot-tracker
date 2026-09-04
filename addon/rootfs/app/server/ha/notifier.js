import { readHaState, writeHaState } from "../db/haState.js";
import { SEVERITY_RANK } from "./frost.js";
const STATE_KEY = 'frost_notifications';
/** Records older than this are dropped; nothing needs last autumn's history. */
const RETENTION_DAYS = 30;
/** Never more than this many for one night, however the forecast wobbles. */
const MAX_SENDS_PER_NIGHT = 2;
/**
 * Close enough that holding until morning risks being too late.
 *
 * A frost discovered at 10pm for 4am is exactly the notification worth breaking
 * quiet hours for: she can still go out and cover the beds. One discovered at
 * 10pm for Thursday can wait until breakfast.
 */
const URGENT_WITHIN_HOURS = 12;
function loadState(db) {
    const state = readHaState(db, STATE_KEY, { records: [] });
    return Array.isArray(state?.records) ? state : { records: [] };
}
/**
 * `yyyy-mm-dd` in her local zone, for pruning by age.
 *
 * Ambient clock (see the note at the top of this file). The least load-bearing
 * of the four: it only decides when a thirty-day-old record is dropped, so an
 * hours-wide error would cost nothing.
 */
function localIsoDate(date) {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}
function prune(records, now) {
    const cutoff = localIsoDate(new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000));
    return records.filter((record) => record.night >= cutoff);
}
/**
 * Is `now` inside the quiet window?
 *
 * Handles the wrap across midnight, which is the normal case: 21:00–07:00 is
 * two ranges on the clock, not one. Equal start and end means quiet hours are
 * switched off entirely rather than lasting all day — the latter would silence
 * every notification forever, which is a nasty way for a misconfiguration to
 * present.
 *
 * The comparison is in her local wall-clock time, which is the only reading of
 * "quiet hours" that means anything — 21:00 is a time on her kitchen clock, not
 * an instant. This is the site where an ambient-clock error would do real harm;
 * see the note at the top of this file for why it is sound.
 */
export function inQuietHours(now, startMinutes, endMinutes) {
    if (startMinutes === endMinutes)
        return false;
    // Ambient clock: correct because Supervisor injects `TZ` and Node resolves it
    // from bundled tzdata. Measured on the target machine, and pinned by test.
    const minutes = now.getHours() * 60 + now.getMinutes();
    return startMinutes < endMinutes
        ? minutes >= startMinutes && minutes < endMinutes
        : minutes >= startMinutes || minutes < endMinutes;
}
/** English list: `a`, `a and b`, `a, b and c`. */
function joinNames(names, limit = 3) {
    const shown = names.slice(0, limit);
    const extra = names.length - shown.length;
    let joined;
    if (shown.length === 0)
        joined = '';
    else if (shown.length === 1)
        joined = shown[0];
    else
        joined = `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
    return extra > 0 ? `${joined} and ${extra} more` : joined;
}
const SEVERITY_WORD = {
    none: 'Cold',
    advisory: 'Frost possible',
    frost: 'Frost',
    hard_freeze: 'Hard freeze',
};
/**
 * "Saturday night" rather than "2026-10-11".
 *
 * Uses the night's own local date. Within a week either side, a weekday name is
 * what she actually thinks in; beyond that it needs a date to be unambiguous.
 */
export function describeNight(night, now) {
    const [year, month, day] = night.split('-').map(Number);
    if (!year || !month || !day)
        return night;
    // Two ambient-clock reads, both her local zone (see the note at the top of
    // this file): the night's own local midnight, and today's. `Math.round`
    // rather than a plain division because a DST boundary between the two makes
    // the gap 23 or 25 hours rather than 24.
    const date = new Date(year, month - 1, day);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (days === 0)
        return 'tonight';
    if (days === 1)
        return 'tomorrow night';
    if (days > 1 && days <= 6) {
        // `undefined` locale and zone: her local weekday name, for the same reason.
        return `${date.toLocaleDateString(undefined, { weekday: 'long' })} night`;
    }
    return `the night of ${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`;
}
/** "around 5am" — only when the forecast was hourly enough to know. */
function describeTime(watch) {
    if (watch.precision !== 'hour')
        return '';
    const at = new Date(watch.expectedAt);
    if (Number.isNaN(at.getTime()))
        return '';
    // Ambient clock again: `expectedAt` is an instant, and this renders it as the
    // hour she will read on her own clock. See the note at the top of this file.
    const label = at
        .toLocaleTimeString(undefined, { hour: 'numeric' })
        .replace(/\s/g, '')
        .toLowerCase();
    return ` Coldest around ${label}.`;
}
/**
 * The words.
 *
 * Names the crops and the bed, because that is the entire difference between
 * this and the weather app she already has. Adds the reassuring half — what
 * will be fine — so it reads as information rather than alarm, and admits to
 * anything it could not classify rather than quietly leaving it out.
 */
export function composeNotification(watch, now) {
    const when = describeNight(watch.night, now);
    const title = `${SEVERITY_WORD[watch.severity]} ${when} — ${Math.round(watch.lowF)}°F`;
    const beds = watch.bedsAtRisk.filter((bed) => bed.tender.length > 0);
    const bedNames = joinNames(beds.map((bed) => bed.bedName));
    const tender = joinNames(watch.tenderVarieties);
    const parts = [];
    if (tender !== '') {
        parts.push(bedNames === ''
            ? `${tender} are tender.`
            : `${tender} in ${bedNames} ${watch.tenderVarieties.length === 1 ? 'is' : 'are'} tender.`);
    }
    else if (watch.severity === 'hard_freeze') {
        const all = joinNames(watch.hardyVarieties);
        parts.push(all === '' ? 'Everything planted is at risk.' : `${all} may be damaged.`);
    }
    const time = describeTime(watch);
    if (time !== '')
        parts.push(time.trim());
    if (watch.severity !== 'hard_freeze' && watch.hardyVarieties.length > 0) {
        parts.push(`Your ${joinNames(watch.hardyVarieties)} should be fine.`);
    }
    if (watch.unknownSquareCount > 0) {
        const squares = watch.unknownSquareCount;
        parts.push(`${squares} ${squares === 1 ? 'square has' : 'squares have'} no crop family recorded, ` +
            `so this can't speak for ${squares === 1 ? 'it' : 'them'}.`);
    }
    return { title, message: parts.join(' ') };
}
/**
 * Should this watch be announced, and as what?
 *
 * Pure apart from the state read — no clock of its own, no network — so every
 * rule above is testable directly, including across a simulated restart.
 */
export function decideNotification(db, watch, options, now = new Date()) {
    if (!options.enabled)
        return { send: false, reason: 'disabled' };
    if (watch === null)
        return { send: false, reason: 'no_watch' };
    // `severity: 'none'` means cold is coming but nothing planted minds it.
    // The banner stays quiet and so does her phone.
    if (watch.severity === 'none')
        return { send: false, reason: 'nothing_at_risk' };
    // Below the hard-freeze band, a warning is only worth sending if something
    // tender is actually in the ground. At hard freeze the hardy crops are in
    // trouble too, so anything planted is reason enough.
    if (watch.severity !== 'hard_freeze' && watch.tenderVarieties.length === 0) {
        return { send: false, reason: 'nothing_at_risk' };
    }
    const state = loadState(db);
    const previous = state.records.find((record) => record.night === watch.night);
    if (previous) {
        if (previous.sends >= MAX_SENDS_PER_NIGHT)
            return { send: false, reason: 'capped' };
        // Same night, same band or milder: she has already been told.
        if (SEVERITY_RANK[watch.severity] <= SEVERITY_RANK[previous.severity]) {
            return { send: false, reason: 'already_sent' };
        }
    }
    const hoursAway = (new Date(watch.expectedAt).getTime() - now.getTime()) / (60 * 60 * 1000);
    const urgent = Number.isFinite(hoursAway) && hoursAway <= URGENT_WITHIN_HOURS;
    if (!urgent &&
        inQuietHours(now, options.quietHoursStartMinutes, options.quietHoursEndMinutes)) {
        // Held, not dropped. Nothing is recorded, so the next poll after 07:00
        // reconsiders it from scratch and sends it then.
        return { send: false, reason: 'quiet_hours' };
    }
    return { send: true, ...composeNotification(watch, now) };
}
/** Records a send, so the rules above can see it — including after a restart. */
export function recordNotification(db, watch, now = new Date()) {
    const state = loadState(db);
    const records = prune(state.records, now);
    const existing = records.find((record) => record.night === watch.night);
    if (existing) {
        existing.severity = watch.severity;
        existing.sends += 1;
        existing.lastSentAt = now.toISOString();
    }
    else {
        records.push({
            night: watch.night,
            severity: watch.severity,
            sends: 1,
            lastSentAt: now.toISOString(),
        });
    }
    writeHaState(db, STATE_KEY, { records });
}
//# sourceMappingURL=notifier.js.map
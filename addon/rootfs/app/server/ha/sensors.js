/**
 * Stamped on every entity this app creates, and the marker the collision guard
 * looks for. Also shows up in the entity's attributes in Home Assistant, which
 * is a fair way to tell her where the number came from.
 */
export const SENSOR_ATTRIBUTION = 'The Home Plot Tracker';
/** The four entities, without their configurable prefix. */
export const PUBLISHED_SENSORS = [
    'harvest_weight',
    'harvest_count',
    'top_variety',
    'frost_risk',
];
/** Home Assistant rejects a state longer than this. Only `top_variety` is at risk. */
const MAX_STATE_LENGTH = 255;
/** What Home Assistant shows when a sensor has nothing to say. */
const UNKNOWN = 'unknown';
function roundWeight(value) {
    return Math.round(value * 100) / 100;
}
function truncate(value) {
    return value.length <= MAX_STATE_LENGTH ? value : `${value.slice(0, MAX_STATE_LENGTH - 1)}…`;
}
/**
 * Rolls the harvest log up exactly the way the Harvest Log view does.
 *
 * Note this counts **every** entry, not just the current calendar year. That is
 * a deliberate match with the app rather than an oversight: the view's "Season
 * so far" strip runs `summarizeHarvests(harvests)` over the whole array, so
 * filtering to this year here would put a different number on her dashboard
 * than the one on her screen, for a value with the same name. Two numbers that
 * disagree is worse than one number whose window is generous. `first_harvest`
 * and `last_harvest` are published as attributes so the span is never a
 * mystery.
 */
export function summariseHarvests(harvests) {
    const byVariety = new Map();
    const days = new Set();
    let totalWeightLbs = 0;
    let totalCount = 0;
    let firstDate = null;
    let lastDate = null;
    for (const entry of harvests) {
        const weight = Number.isFinite(entry.weightLbs) ? entry.weightLbs : 0;
        const count = Number.isFinite(entry.count) ? entry.count : 0;
        totalWeightLbs += weight;
        totalCount += count;
        if (typeof entry.date === 'string' && entry.date !== '') {
            days.add(entry.date);
            if (firstDate === null || entry.date < firstDate)
                firstDate = entry.date;
            if (lastDate === null || entry.date > lastDate)
                lastDate = entry.date;
        }
        const variety = typeof entry.variety === 'string' ? entry.variety.trim() : '';
        if (variety === '')
            continue;
        const existing = byVariety.get(variety);
        if (existing) {
            existing.weightLbs += weight;
            existing.count += count;
        }
        else {
            byVariety.set(variety, { weightLbs: weight, count });
        }
    }
    const ranked = [...byVariety.entries()]
        .map(([variety, totals]) => ({ variety, ...totals }))
        .sort((left, right) => right.weightLbs - left.weightLbs ||
        right.count - left.count ||
        left.variety.localeCompare(right.variety));
    return {
        totalWeightLbs: roundWeight(totalWeightLbs),
        totalCount,
        entryCount: harvests.length,
        harvestDays: days.size,
        varietyCount: ranked.length,
        topVariety: ranked[0]
            ? { variety: ranked[0].variety, weightLbs: roundWeight(ranked[0].weightLbs), count: ranked[0].count }
            : null,
        firstDate,
        lastDate,
    };
}
/**
 * The exact payloads for all four entities.
 *
 * Separated from the posting so a test can assert the whole published surface —
 * ids, rounding, units, device classes, icons — without a fake HTTP layer.
 */
export function buildSensorPayloads(input) {
    const { prefix } = input;
    const totals = summariseHarvests(input.harvests);
    const common = { attribution: SENSOR_ATTRIBUTION };
    return [
        {
            entityId: `sensor.${prefix}_harvest_weight`,
            state: totals.totalWeightLbs.toFixed(2),
            attributes: {
                ...common,
                friendly_name: 'Garden harvest weight',
                unit_of_measurement: 'lb',
                device_class: 'weight',
                // `measurement`, not `total_increasing` and not `total`.
                //
                // `total_increasing` would be actively harmful: correcting or deleting
                // a harvest row makes the value drop, which Home Assistant reads as a
                // meter reset and folds into the long-term sum permanently.
                //
                // `total` handles decreases properly, but these entities vanish on
                // every Home Assistant restart (see the file header) and come back with
                // no history, which produces statistics gaps and "state class changed"
                // repair notices. `measurement` gives her a clean graph on a dashboard
                // and tells the statistics engine nothing that is not true.
                state_class: 'measurement',
                icon: 'mdi:scale-balance',
                entries: totals.entryCount,
                varieties: totals.varietyCount,
                harvest_days: totals.harvestDays,
                first_harvest: totals.firstDate,
                last_harvest: totals.lastDate,
            },
        },
        {
            entityId: `sensor.${prefix}_harvest_count`,
            state: String(totals.totalCount),
            attributes: {
                ...common,
                friendly_name: 'Garden harvest count',
                unit_of_measurement: 'items',
                state_class: 'measurement',
                icon: 'mdi:basket-outline',
                entries: totals.entryCount,
                harvest_days: totals.harvestDays,
            },
        },
        {
            entityId: `sensor.${prefix}_top_variety`,
            state: truncate(totals.topVariety?.variety ?? UNKNOWN),
            attributes: {
                ...common,
                friendly_name: 'Garden top variety',
                icon: 'mdi:trophy-variant-outline',
                weight_lbs: totals.topVariety?.weightLbs ?? 0,
                count: totals.topVariety?.count ?? 0,
            },
        },
        {
            entityId: `sensor.${prefix}_frost_risk`,
            // `unknown` when we have no forecast at all, which is a different thing
            // from `none` — "no cold is coming" versus "nobody told us".
            state: input.frostKnown ? (input.frost?.severity ?? 'none') : UNKNOWN,
            attributes: {
                ...common,
                friendly_name: 'Garden frost risk',
                icon: 'mdi:snowflake-alert',
                // `enum` makes this render as a proper state in the UI and gives her
                // automations a documented set of values to branch on.
                device_class: 'enum',
                options: ['none', 'advisory', 'frost', 'hard_freeze'],
                low_f: input.frost?.lowF ?? null,
                expected_at: input.frost?.expectedAt ?? null,
                night: input.frost?.night ?? null,
                beds_at_risk: input.frost?.bedsAtRisk.map((bed) => bed.bedName) ?? [],
                tender_varieties: input.frost?.tenderVarieties ?? [],
            },
        },
    ];
}
/**
 * Which of our entity ids are safe to write.
 *
 * Anything that already exists without our attribution belongs to something
 * else and is left strictly alone. Run once at boot; the answer is cached for
 * the process lifetime, since an id that was foreign at boot is not going to
 * become ours later.
 */
export async function findWritableSensors(client, prefix, warn = console.warn) {
    const writable = new Set();
    for (const sensor of PUBLISHED_SENSORS) {
        const entityId = `sensor.${prefix}_${sensor}`;
        const existing = await client.getState(entityId);
        if (!existing.ok) {
            // A 404 is the happy path: nothing there, so it is ours to create. Any
            // other failure means we could not check, and the safe reading of "I
            // don't know" is to go ahead — the alternative is that one flaky request
            // at boot disables her sensors until the next restart.
            writable.add(entityId);
            continue;
        }
        if (existing.value.attributes?.attribution === SENSOR_ATTRIBUTION) {
            writable.add(entityId);
            continue;
        }
        warn(`Not publishing ${entityId}: an entity with that id already exists and was not created ` +
            `by this add-on. Set the sensor_prefix option to something else to publish alongside it.`);
    }
    return writable;
}
/** Posts every payload it is allowed to. Returns how many actually landed. */
export async function publishSensors(client, payloads, writable) {
    let published = 0;
    for (const payload of payloads) {
        if (!writable.has(payload.entityId))
            continue;
        const result = await client.setState(payload.entityId, payload.state, payload.attributes);
        if (result.ok)
            published += 1;
    }
    return published;
}
//# sourceMappingURL=sensors.js.map
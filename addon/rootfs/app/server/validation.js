/**
 * Bounds that exist purely to stop a single request from exhausting memory or
 * disk. They are far above anything a real vegetable garden produces.
 */
export const LIMITS = {
    maxItemsPerCollection: 5_000,
    maxStringLength: 10_000,
    maxBedDimension: 64,
    maxLayoutCells: 4_096,
    minPurchaseYear: 1000,
    maxPurchaseYear: 9999,
};
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
function describe(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'an array';
    return typeof value;
}
class Collector {
    issues = [];
    add(path, message) {
        this.issues.push({ path, message });
    }
    get ok() {
        return this.issues.length === 0;
    }
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Rejects anything that is not an object with exactly the expected keys. Missing
 * and unknown fields are both reported, so a typo in an import file names itself.
 */
function checkShape(collector, path, value, allowed) {
    if (!isPlainObject(value)) {
        collector.add(path, `expected an object, received ${describe(value)}`);
        return false;
    }
    const present = Object.keys(value);
    const unknown = present.filter((key) => !allowed.includes(key));
    const missing = allowed.filter((key) => !present.includes(key));
    for (const key of unknown) {
        collector.add(`${path}.${key}`, 'unknown field is not allowed');
    }
    for (const key of missing) {
        collector.add(`${path}.${key}`, 'required field is missing');
    }
    return unknown.length === 0 && missing.length === 0;
}
function readString(collector, path, value, options) {
    if (typeof value !== 'string') {
        collector.add(path, `expected a string, received ${describe(value)}`);
        return '';
    }
    if (value.length > LIMITS.maxStringLength) {
        collector.add(path, `must be at most ${LIMITS.maxStringLength} characters`);
        return '';
    }
    if (!options.allowEmpty && value.trim() === '') {
        collector.add(path, 'must not be empty');
        return '';
    }
    return value;
}
function readInteger(collector, path, value, options) {
    if (typeof value !== 'number') {
        collector.add(path, `expected a number, received ${describe(value)}`);
        return options.min;
    }
    // Catches NaN and ±Infinity, both of which survive JSON round-trips as
    // literals in hand-edited files and would poison every total in the UI.
    if (!Number.isFinite(value)) {
        collector.add(path, 'must be a finite number');
        return options.min;
    }
    if (!Number.isInteger(value)) {
        collector.add(path, `expected a whole number, received ${value}`);
        return options.min;
    }
    if (value < options.min || value > options.max) {
        collector.add(path, `must be between ${options.min} and ${options.max}, received ${value}`);
        return options.min;
    }
    return value;
}
function readNumber(collector, path, value, options) {
    if (typeof value !== 'number') {
        collector.add(path, `expected a number, received ${describe(value)}`);
        return options.min;
    }
    if (!Number.isFinite(value)) {
        collector.add(path, 'must be a finite number');
        return options.min;
    }
    if (value < options.min || value > options.max) {
        collector.add(path, `must be between ${options.min} and ${options.max}, received ${value}`);
        return options.min;
    }
    return value;
}
/** `yyyy-mm-dd`, and a date that actually exists — `2026-02-30` is rejected. */
function readIsoDate(collector, path, value) {
    if (typeof value !== 'string') {
        collector.add(path, `expected a string, received ${describe(value)}`);
        return '';
    }
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) {
        collector.add(path, `expected an ISO date formatted yyyy-mm-dd, received ${JSON.stringify(value)}`);
        return '';
    }
    const [, yearPart, monthPart, dayPart] = match;
    const year = Number(yearPart);
    const month = Number(monthPart);
    const day = Number(dayPart);
    const asUtc = new Date(Date.UTC(year, month - 1, day));
    if (asUtc.getUTCFullYear() !== year ||
        asUtc.getUTCMonth() !== month - 1 ||
        asUtc.getUTCDate() !== day) {
        collector.add(path, `${JSON.stringify(value)} is not a real calendar date`);
        return '';
    }
    return value;
}
/**
 * The layout grid must agree with the bed's own `rows` and `columns`. A
 * disagreement is the one corruption that visibly breaks the planner, so it is
 * rejected rather than silently reshaped.
 */
function readLayout(collector, path, value, rows, columns) {
    if (!Array.isArray(value)) {
        collector.add(path, `expected an array of rows, received ${describe(value)}`);
        return [];
    }
    if (value.length !== rows) {
        collector.add(path, `must hold exactly ${rows} rows to match "rows", found ${value.length}`);
        return [];
    }
    const grid = [];
    for (let row = 0; row < value.length; row += 1) {
        const rawRow = value[row];
        if (!Array.isArray(rawRow)) {
            collector.add(`${path}[${row}]`, `expected an array, received ${describe(rawRow)}`);
            continue;
        }
        if (rawRow.length !== columns) {
            collector.add(`${path}[${row}]`, `must hold exactly ${columns} cells to match "columns", found ${rawRow.length}`);
            continue;
        }
        const cells = [];
        for (let column = 0; column < rawRow.length; column += 1) {
            const cell = rawRow[column];
            if (cell === null) {
                cells.push(null);
                continue;
            }
            if (typeof cell !== 'string') {
                collector.add(`${path}[${row}][${column}]`, `expected a variety name or null, received ${describe(cell)}`);
                continue;
            }
            if (cell.length > LIMITS.maxStringLength) {
                collector.add(`${path}[${row}][${column}]`, `must be at most ${LIMITS.maxStringLength} characters`);
                continue;
            }
            cells.push(cell);
        }
        grid.push(cells);
    }
    return grid;
}
const SEED_FIELDS = ['id', 'category', 'variety', 'brand', 'purchaseYear', 'notes'];
const BED_FIELDS = ['id', 'name', 'rows', 'columns', 'layout', 'lastYearCategory'];
const HARVEST_FIELDS = ['id', 'date', 'variety', 'weightLbs', 'count'];
function readSeed(collector, path, raw) {
    if (!checkShape(collector, path, raw, SEED_FIELDS))
        return null;
    return {
        id: readString(collector, `${path}.id`, raw.id, { allowEmpty: false }),
        // Not restricted to SEED_CATEGORIES: the list is a UI affordance, and an
        // import from an older or newer build must still load.
        category: readString(collector, `${path}.category`, raw.category, { allowEmpty: true }),
        variety: readString(collector, `${path}.variety`, raw.variety, { allowEmpty: false }),
        brand: readString(collector, `${path}.brand`, raw.brand, { allowEmpty: true }),
        purchaseYear: readInteger(collector, `${path}.purchaseYear`, raw.purchaseYear, {
            min: LIMITS.minPurchaseYear,
            max: LIMITS.maxPurchaseYear,
        }),
        notes: readString(collector, `${path}.notes`, raw.notes, { allowEmpty: true }),
    };
}
function readBed(collector, path, raw) {
    if (!checkShape(collector, path, raw, BED_FIELDS))
        return null;
    const rows = readInteger(collector, `${path}.rows`, raw.rows, {
        min: 1,
        max: LIMITS.maxBedDimension,
    });
    const columns = readInteger(collector, `${path}.columns`, raw.columns, {
        min: 1,
        max: LIMITS.maxBedDimension,
    });
    if (rows * columns > LIMITS.maxLayoutCells) {
        collector.add(path, `a bed may hold at most ${LIMITS.maxLayoutCells} cells`);
        return null;
    }
    return {
        id: readString(collector, `${path}.id`, raw.id, { allowEmpty: false }),
        name: readString(collector, `${path}.name`, raw.name, { allowEmpty: false }),
        rows,
        columns,
        layout: readLayout(collector, `${path}.layout`, raw.layout, rows, columns),
        // Empty is the app's sentinel for "new ground / nothing recorded".
        lastYearCategory: readString(collector, `${path}.lastYearCategory`, raw.lastYearCategory, {
            allowEmpty: true,
        }),
    };
}
function readHarvest(collector, path, raw) {
    if (!checkShape(collector, path, raw, HARVEST_FIELDS))
        return null;
    return {
        id: readString(collector, `${path}.id`, raw.id, { allowEmpty: false }),
        date: readIsoDate(collector, `${path}.date`, raw.date),
        variety: readString(collector, `${path}.variety`, raw.variety, { allowEmpty: false }),
        // Zero is legitimate: the form accepts a count-only or weight-only pick.
        weightLbs: readNumber(collector, `${path}.weightLbs`, raw.weightLbs, { min: 0, max: 1_000_000 }),
        count: readInteger(collector, `${path}.count`, raw.count, { min: 0, max: 1_000_000 }),
    };
}
function readCollection(collector, path, raw, readItem) {
    if (!Array.isArray(raw)) {
        collector.add(path, `expected an array, received ${describe(raw)}`);
        return [];
    }
    if (raw.length > LIMITS.maxItemsPerCollection) {
        collector.add(path, `must hold at most ${LIMITS.maxItemsPerCollection} items`);
        return [];
    }
    const items = [];
    const seenIds = new Set();
    raw.forEach((entry, index) => {
        const item = readItem(collector, `${path}[${index}]`, entry);
        if (item === null)
            return;
        // Ids are primary keys. Catching a duplicate here turns what would be an
        // opaque constraint failure mid-transaction into a precise 400.
        if (item.id !== '' && seenIds.has(item.id)) {
            collector.add(`${path}[${index}].id`, `duplicate id ${JSON.stringify(item.id)}`);
            return;
        }
        seenIds.add(item.id);
        items.push(item);
    });
    return items;
}
function finish(collector, value) {
    return collector.ok ? { ok: true, value } : { ok: false, issues: collector.issues };
}
export function validateSeeds(raw, path = 'body') {
    const collector = new Collector();
    const value = readCollection(collector, path, raw, readSeed);
    return finish(collector, value);
}
export function validateBeds(raw, path = 'body') {
    const collector = new Collector();
    const value = readCollection(collector, path, raw, readBed);
    return finish(collector, value);
}
export function validateHarvests(raw, path = 'body') {
    const collector = new Collector();
    const value = readCollection(collector, path, raw, readHarvest);
    return finish(collector, value);
}
const SNAPSHOT_FIELDS = ['seeds', 'beds', 'harvests'];
/**
 * The whole-app payload accepted by `POST /api/import`. All three collections
 * are required: an import replaces everything, and letting a key be omitted
 * would make "wipe my harvests" indistinguishable from "I forgot a key".
 */
export function validateSnapshot(raw) {
    const collector = new Collector();
    if (!checkShape(collector, 'body', raw, SNAPSHOT_FIELDS)) {
        return { ok: false, issues: collector.issues };
    }
    const snapshot = {
        seeds: readCollection(collector, 'body.seeds', raw.seeds, readSeed),
        beds: readCollection(collector, 'body.beds', raw.beds, readBed),
        harvests: readCollection(collector, 'body.harvests', raw.harvests, readHarvest),
    };
    return finish(collector, snapshot);
}
//# sourceMappingURL=validation.js.map
/**
 * Domain types shared by the browser client and the Node server.
 *
 * This package is the single source of truth for the shapes that travel over
 * the API. It is deliberately free of framework imports — no React, no Express —
 * so both sides can depend on it without dragging the other's runtime in.
 *
 * The React prop contracts (`SeedVaultViewProps` and friends) stay in
 * `client/src/types.ts` because they are a client concern.
 */
/**
 * Canonical category list backing every category dropdown in the app.
 *
 * These are **crop families**, not supermarket aisles, because the crop-rotation
 * warning depends on them being families — families are what share soil-borne
 * disease and pests. It is also why melons are `Cucurbit` rather than `Fruit`,
 * and why a ground cherry is a `Nightshade`.
 *
 * Each entry is additionally chosen so that every plant in it takes a frost the
 * same way, which is what lets `CATEGORY_TENDERNESS` in
 * `server/src/ha/tenderness.ts` stay one value per family. `Fruit` holds only
 * hardy perennial fruit for exactly that reason: a category containing both a
 * strawberry and a watermelon could not have a single honest answer.
 *
 * Adding one here has three obligations, and the build will catch you on the
 * first: `CATEGORY_TENDERNESS`, `client/src/lib/categoryTheme.ts`, and
 * `shared/src/plants.ts` so the catalogue can actually assign it.
 */
export const SEED_CATEGORIES = [
    'Nightshade',
    'Cucurbit',
    'Brassica',
    'Allium',
    'Legume',
    'Root',
    'Leafy Green',
    'Herb',
    'Fruit',
    'Flower',
    'Other',
];
/** localStorage keys, namespaced under `hpt.` to avoid collisions. */
export const STORAGE_KEYS = {
    seeds: 'hpt.seeds',
    beds: 'hpt.beds',
    harvests: 'hpt.harvests',
    /**
     * Which category corrections she has waved away.
     *
     * Unlike the three above this is a preference, not a record: it holds no
     * garden data, it is never synced to the server, and losing it costs her
     * nothing worse than being offered a correction she has already declined.
     * Per-device on purpose — dismissing a nudge on her phone is not a statement
     * about what the tablet in the shed should show.
     */
    dismissedCategoryFixes: 'hpt.dismissedCategoryFixes',
};
/** The three collections the API exposes. */
export const COLLECTION_NAMES = ['seeds', 'beds', 'harvests'];
/** Header a client sends to declare the version it is editing from. */
export const IF_MATCH_HEADER = 'If-Match';
/** Header carrying the current version of a collection. */
export const ETAG_HEADER = 'ETag';
/**
 * Backup and restore.
 *
 * Her whole garden lives in one SQLite file inside an add-on `/data` directory
 * that Supervisor deletes on uninstall, with no confirmation step. These shapes
 * are how she gets a copy out of it and back in without needing anybody else.
 *
 * The two constants that describe the file — its `format` string and the highest
 * `formatVersion` this build understands — are exported from here as runtime
 * values, so the server, the browser and the file itself cannot disagree about
 * what a backup is called.
 *
 * They were briefly duplicated on each side of the fence instead, guarded by a
 * parity test, because `server/src` could not take a runtime value from this
 * package. That is no longer true: the add-on image now stages `@hpt/shared`
 * and links it as a `file:` dependency, and `server/test/shared-imports.test.ts`
 * is what keeps that staging honest. One definition is better than two that
 * happen to match on the day they are written.
 */
/** Identifies a file as ours, so a wrong file can be refused by name. */
export const BACKUP_FORMAT = 'home-plot-tracker.garden';
/**
 * The highest file format this build understands.
 *
 * Bump only when an older build would **misread** a newer file. Adding another
 * optional field is not that: unknown top-level keys are tolerated on the way
 * in, precisely so a future version can add one without stranding a file in an
 * older install that could otherwise have restored it.
 */
export const BACKUP_FORMAT_VERSION = 1;
export { PLANT_CATALOGUE, categoryForVariety, matchPlant, normalizePlantName, plantLookupKeys, searchPlants, } from './plants.js';
/**
 * Cold tolerance per crop family.
 *
 * The single copy. The frost warnings come from here by way of
 * `server/src/ha/tenderness.ts`, which re-exports it, and the seed vault uses
 * it to explain *why* a miscategorised packet matters — "this one is filed as
 * something the frost engine treats as hardy, so you are not being warned about
 * it". There is no second copy to drift.
 */
export { CATEGORY_TENDERNESS, isKnownTendernessCategory, tendernessOf, } from './tenderness.js';
export { frostHeadline, frostSentences, joinNames } from './frostVoice.js';
//# sourceMappingURL=index.js.map
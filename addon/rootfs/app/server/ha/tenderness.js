/**
 * Crop family to cold tolerance.
 *
 * `Herb` is the one genuine compromise. It spans basil, which collapses at
 * 40°F, and rosemary, sage and thyme, which are fine under snow. It is mapped
 * `tender` because basil is the herb people actually lose, and being warned
 * about a hardy rosemary costs nothing next to losing the basil.
 *
 * Null-prototype, because the keys are variety categories that ultimately come
 * from user input. With an ordinary object literal, a square planted with
 * something called "constructor" or "toString" would find an inherited property
 * and be classified as whatever that happens to be, instead of `unknown`.
 */
export const CATEGORY_TENDERNESS = Object.assign(Object.create(null), {
    Nightshade: 'tender',
    Cucurbit: 'tender',
    Legume: 'tender',
    Herb: 'tender',
    Brassica: 'hardy',
    Allium: 'hardy',
    Root: 'hardy',
    'Leafy Green': 'hardy',
});
export function tendernessOf(category) {
    if (!category)
        return 'unknown';
    return Object.hasOwn(CATEGORY_TENDERNESS, category)
        ? (CATEGORY_TENDERNESS[category] ?? 'unknown')
        : 'unknown';
}
/**
 * Which of the given categories this mapping does not cover.
 *
 * Takes the list rather than importing `SEED_CATEGORIES` so the check reads the
 * same in a test as it would anywhere else. It exists so a test can fail the
 * day somebody adds a ninth category and forgets this file — at which point
 * every plant of that family would silently become `unknown` and stop being
 * warned about, with nothing anywhere to say so.
 */
export function categoriesMissingTenderness(categories) {
    return categories.filter((category) => !Object.hasOwn(CATEGORY_TENDERNESS, category));
}
/**
 * Frost bands, in °F, matching the units her Home Assistant reports.
 *
 * `advisory` is 36°F rather than 32°F on purpose. A forecast low is the air
 * temperature at 2m at a regional station; on a still, clear night the air at
 * plant level runs 3–5°F colder than that, and radiative cooling on leaf
 * surfaces colder still. Tender crops are routinely burned on nights the
 * forecast called 34–36°F, so 36°F is the trigger gardeners actually use, and
 * a warning that only fired at 32°F would miss the nights that cost her the
 * tomatoes.
 */
export const FROST_THRESHOLDS_F = {
    /** Tender crops at risk. Cover them. */
    advisory: 36,
    /** Tender crops killed outright. Hardy crops unbothered. */
    frost: 32,
    /** Hardy crops damaged too. This is the one that ends a season. */
    hardFreeze: 28,
};
//# sourceMappingURL=tenderness.js.map
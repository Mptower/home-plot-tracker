/**
 * Crop family to cold tolerance.
 *
 * `Herb` is the one genuine compromise. It spans basil, which collapses at
 * 40°F, and rosemary, sage and thyme, which are fine under snow. It is mapped
 * `tender` because basil is the herb people actually lose, and being warned
 * about a hardy rosemary costs nothing next to losing the basil.
 *
 * `Fruit` deliberately holds only hardy perennial fruit — strawberries,
 * brambles, currants, grapes, rhubarb. Melons are `Cucurbit`, which is what
 * they botanically are, so this category never has to answer for both a
 * strawberry and a watermelon at once. See `plants.ts`.
 *
 * `Other` is `tender` both because its members are (corn, okra, sweet potato,
 * celery) and because tender is the safe default for a catch-all: over-warning
 * costs a bedsheet, under-warning costs the crop. It is not the same as having
 * no category — an uncategorised planting is still `unknown` and still raises
 * nothing.
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
    Flower: 'tender',
    Other: 'tender',
    Brassica: 'hardy',
    Allium: 'hardy',
    Root: 'hardy',
    'Leafy Green': 'hardy',
    Fruit: 'hardy',
});
/**
 * Cold tolerance for a category, or `unknown` for anything unrecognised.
 *
 * Null-prototype lookup, because the keys come from user input: an ordinary
 * object would answer for `constructor` and `toString`.
 */
export function tendernessOf(category) {
    if (!category)
        return 'unknown';
    return Object.hasOwn(CATEGORY_TENDERNESS, category)
        ? (CATEGORY_TENDERNESS[category] ?? 'unknown')
        : 'unknown';
}
/**
 * Whether this mapping actually has an answer for a category.
 *
 * The distinction matters to the frost engine. A seed packet carrying free text
 * from before the app offered a category list has told it nothing usable, and
 * treating that as "the vault has spoken" is how a planting silently stops being
 * warned about — which is the bug this whole mapping exists to prevent. See
 * `server/src/ha/varietyCategory.ts`.
 */
export function isKnownTendernessCategory(category) {
    return typeof category === 'string' && Object.hasOwn(CATEGORY_TENDERNESS, category);
}
//# sourceMappingURL=tenderness.js.map
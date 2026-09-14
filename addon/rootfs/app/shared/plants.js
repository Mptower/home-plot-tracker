/**
 * A catalogue of the plants people actually grow, so nobody has to know
 * botanical families to use this app.
 *
 * The app has always asked for a `category` and offered no list to pick from.
 * That is a taxonomy question put to a gardener holding a seed packet, and the
 * answers it produces are exactly as good as you would expect: a cherry tomato
 * filed as a Leafy Green, which the frost engine then reads as hardy and
 * declines to warn about. The category is not the gardener's job. It is derived
 * from the variety she typed, and she can still override it.
 *
 * ## Why the categories look the way they do
 *
 * `SEED_CATEGORIES` is a list of **crop families**, not a list of supermarket
 * aisles, and that matters because the *other* consumer of a category is the
 * crop-rotation warning. Rotation works on families because families share
 * soil-borne disease and pests.
 *
 * So melons are `Cucurbit`, not "Fruit": watermelon, cantaloupe and honeydew
 * are Cucurbitaceae, they share cucumber beetles and bacterial wilt with squash
 * and cucumber, and grouping them anywhere else would make the rotation warning
 * wrong as well as the frost warning. A ground cherry is *Physalis*, so it is a
 * `Nightshade`. `Fruit` is left holding only the hardy perennial fruit —
 * strawberries, brambles, currants, grapes, rhubarb — which is a genuinely
 * coherent group: every member shrugs off a frost.
 *
 * That is deliberate, and it is what lets `CATEGORY_TENDERNESS` stay the coarse
 * one-value-per-family map its own header argues for. There is no per-variety
 * tenderness override here, because with families chosen this way there is
 * nothing for one to fix.
 *
 * ## Where this may be imported
 *
 * This module is a runtime value, not a type, and both sides import it. The
 * **client** uses it to suggest plants in the picker; the **server** uses it in
 * `ha/varietyCategory.ts` to work out what a bed square is when there is no
 * seed packet to ask, which is the difference between warning her about a
 * frost-tender planting and saying nothing at all.
 *
 * That used to be forbidden. The add-on image staged `server/dist/src` with
 * Express as its only dependency and no `node_modules/@hpt/shared`, so a server
 * runtime import from this package resolved cleanly in development and in every
 * test and then crashed the add-on on boot with `ERR_MODULE_NOT_FOUND`.
 * `scripts/build-addon.mjs` now stages this package's build into the image as a
 * real `file:` dependency, and `server/test/shared-imports.test.ts` enforces
 * that it stays staged — it fails if a server source imports this package while
 * the committed add-on tree does not ship it.
 */
/**
 * The catalogue.
 *
 * Ordered by family so it reads as a garden rather than an index. Nothing in
 * the app depends on the order.
 */
export const PLANT_CATALOGUE = [
    // ---------------------------------------------------------------- Nightshade
    { name: 'Tomato', category: 'Nightshade' },
    { name: 'Cherry Tomato', category: 'Nightshade' },
    { name: 'Grape Tomato', category: 'Nightshade' },
    { name: 'Beefsteak Tomato', category: 'Nightshade', aliases: ['beefsteak'] },
    { name: 'Roma Tomato', category: 'Nightshade', aliases: ['roma'] },
    { name: 'Plum Tomato', category: 'Nightshade' },
    { name: 'Heirloom Tomato', category: 'Nightshade' },
    { name: 'Cherokee Purple', category: 'Nightshade' },
    { name: 'Brandywine', category: 'Nightshade' },
    { name: 'San Marzano', category: 'Nightshade' },
    { name: 'Early Girl', category: 'Nightshade' },
    { name: 'Better Boy', category: 'Nightshade' },
    { name: 'Sungold', category: 'Nightshade', aliases: ['sun gold'] },
    { name: 'Green Zebra', category: 'Nightshade' },
    { name: 'Mortgage Lifter', category: 'Nightshade' },
    { name: 'Black Krim', category: 'Nightshade' },
    // A "black cherry" is a tomato, not stone fruit.
    { name: 'Black Cherry', category: 'Nightshade' },
    { name: 'Chocolate Cherry', category: 'Nightshade' },
    { name: 'Yellow Pear', category: 'Nightshade' },
    { name: 'Amish Paste', category: 'Nightshade' },
    { name: 'Celebrity', category: 'Nightshade' },
    { name: 'Sweet 100', category: 'Nightshade', aliases: ['supersweet 100'] },
    { name: 'Tomatillo', category: 'Nightshade' },
    {
        name: 'Ground Cherry',
        category: 'Nightshade',
        aliases: ['husk cherry', 'husk tomato', 'cape gooseberry'],
    },
    {
        name: 'Pepper',
        category: 'Nightshade',
        aliases: ['chili', 'chilli', 'chile', 'chili pepper', 'chile pepper', 'hot pepper'],
    },
    { name: 'Bell Pepper', category: 'Nightshade', aliases: ['green pepper', 'red bell pepper'] },
    { name: 'Sweet Pepper', category: 'Nightshade' },
    { name: 'Mini Sweet Pepper', category: 'Nightshade', aliases: ['lunchbox pepper'] },
    { name: 'Jalapeño', category: 'Nightshade', aliases: ['jalapeno pepper'] },
    { name: 'Habanero', category: 'Nightshade' },
    { name: 'Serrano', category: 'Nightshade' },
    { name: 'Poblano', category: 'Nightshade', aliases: ['ancho'] },
    { name: 'Cayenne', category: 'Nightshade' },
    { name: 'Banana Pepper', category: 'Nightshade', aliases: ['hungarian wax'] },
    { name: 'Ghost Pepper', category: 'Nightshade', aliases: ['bhut jolokia'] },
    { name: 'Shishito', category: 'Nightshade' },
    { name: 'Anaheim', category: 'Nightshade', aliases: ['hatch chile'] },
    { name: 'Scotch Bonnet', category: 'Nightshade' },
    { name: 'Carolina Reaper', category: 'Nightshade' },
    { name: 'Padrón', category: 'Nightshade' },
    { name: 'Pepperoncini', category: 'Nightshade', aliases: ['peperoncini'] },
    { name: 'Cherry Bomb Pepper', category: 'Nightshade', aliases: ['cherry bomb'] },
    { name: 'Pimento', category: 'Nightshade', aliases: ['pimiento'] },
    {
        name: 'Potato',
        category: 'Nightshade',
        aliases: ['yukon gold', 'russet', 'kennebec', 'red pontiac', 'fingerling potato'],
    },
    { name: 'Eggplant', category: 'Nightshade', aliases: ['aubergine', 'black beauty'] },
    // ------------------------------------------------------------------ Cucurbit
    {
        name: 'Cucumber',
        category: 'Cucurbit',
        aliases: ['pickling cucumber', 'slicing cucumber', 'armenian cucumber', 'lemon cucumber'],
    },
    { name: 'Zucchini', category: 'Cucurbit', aliases: ['courgette'] },
    { name: 'Squash', category: 'Cucurbit' },
    { name: 'Summer Squash', category: 'Cucurbit', aliases: ['yellow squash', 'crookneck', 'pattypan'] },
    { name: 'Winter Squash', category: 'Cucurbit' },
    { name: 'Butternut Squash', category: 'Cucurbit', aliases: ['butternut'] },
    { name: 'Acorn Squash', category: 'Cucurbit' },
    { name: 'Spaghetti Squash', category: 'Cucurbit' },
    { name: 'Delicata Squash', category: 'Cucurbit', aliases: ['delicata'] },
    { name: 'Kabocha', category: 'Cucurbit' },
    { name: 'Hubbard Squash', category: 'Cucurbit' },
    { name: 'Pumpkin', category: 'Cucurbit', aliases: ['sugar pumpkin', 'jack o lantern'] },
    // Melons are Cucurbitaceae. They belong with the squash they share pests
    // with, and they are tender, which is the answer that keeps her from losing
    // them to a light frost.
    { name: 'Melon', category: 'Cucurbit' },
    { name: 'Watermelon', category: 'Cucurbit', aliases: ['sugar baby'] },
    { name: 'Cantaloupe', category: 'Cucurbit', aliases: ['muskmelon'] },
    { name: 'Honeydew', category: 'Cucurbit' },
    { name: 'Bitter Melon', category: 'Cucurbit' },
    { name: 'Gourd', category: 'Cucurbit', aliases: ['birdhouse gourd'] },
    { name: 'Luffa', category: 'Cucurbit', aliases: ['loofah'] },
    // ------------------------------------------------------------------ Brassica
    { name: 'Broccoli', category: 'Brassica', aliases: ['calabrese'] },
    { name: 'Broccoli Rabe', category: 'Brassica', aliases: ['rapini'] },
    { name: 'Romanesco', category: 'Brassica' },
    { name: 'Cauliflower', category: 'Brassica' },
    { name: 'Cabbage', category: 'Brassica', aliases: ['green cabbage', 'red cabbage'] },
    { name: 'Napa Cabbage', category: 'Brassica', aliases: ['chinese cabbage'] },
    { name: 'Brussels Sprout', category: 'Brassica', aliases: ['brussel sprout'] },
    {
        name: 'Kale',
        category: 'Brassica',
        aliases: ['lacinato', 'dinosaur kale', 'red russian kale', 'curly kale'],
    },
    { name: 'Collards', category: 'Brassica', aliases: ['collard greens'] },
    { name: 'Kohlrabi', category: 'Brassica' },
    { name: 'Bok Choy', category: 'Brassica', aliases: ['pak choi', 'pak choy', 'bok choi'] },
    { name: 'Horseradish', category: 'Brassica' },
    // -------------------------------------------------------------------- Allium
    {
        name: 'Onion',
        category: 'Allium',
        aliases: ['yellow onion', 'red onion', 'sweet onion', 'walla walla', 'onion set'],
    },
    {
        name: 'Green Onion',
        category: 'Allium',
        aliases: ['scallion', 'spring onion', 'bunching onion'],
    },
    // An heirloom multiplier onion. Nothing to do with potatoes.
    { name: 'Potato Onion', category: 'Allium', aliases: ['multiplier onion'] },
    {
        name: 'Garlic',
        category: 'Allium',
        aliases: ['hardneck garlic', 'softneck garlic', 'elephant garlic'],
    },
    // Chives and garlic chives sit with the alliums rather than the herbs on
    // purpose: they are *Allium*, they are hardy, and `Herb` is mapped tender.
    // The picker searches by name, so she still finds them by typing "chives".
    { name: 'Chives', category: 'Allium' },
    { name: 'Garlic Chives', category: 'Allium' },
    { name: 'Shallot', category: 'Allium' },
    { name: 'Leek', category: 'Allium' },
    // -------------------------------------------------------------------- Legume
    {
        name: 'Bean',
        category: 'Legume',
        aliases: ['green bean', 'snap bean', 'string bean', 'bush bean', 'pole bean', 'wax bean'],
    },
    { name: 'Fava Bean', category: 'Legume', aliases: ['broad bean'] },
    { name: 'Lima Bean', category: 'Legume', aliases: ['butter bean'] },
    { name: 'Runner Bean', category: 'Legume', aliases: ['scarlet runner'] },
    { name: 'Soybean', category: 'Legume', aliases: ['edamame'] },
    { name: 'Chickpea', category: 'Legume', aliases: ['garbanzo', 'chick pea'] },
    { name: 'Pea', category: 'Legume', aliases: ['english pea', 'shelling pea', 'garden pea'] },
    { name: 'Snap Pea', category: 'Legume', aliases: ['sugar snap pea', 'sugar snap'] },
    { name: 'Snow Pea', category: 'Legume' },
    { name: 'Black Eyed Pea', category: 'Legume', aliases: ['cowpea'] },
    { name: 'Peanut', category: 'Legume' },
    { name: 'Lentil', category: 'Legume' },
    // ---------------------------------------------------------------------- Root
    { name: 'Carrot', category: 'Root', aliases: ['nantes', 'danvers', 'chantenay'] },
    { name: 'Beet', category: 'Root', aliases: ['beetroot', 'detroit dark red', 'golden beet'] },
    // Radish, turnip and rutabaga are botanically Brassicaceae. They are filed
    // under Root because that is where a gardener looks for them, and it costs
    // nothing in frost terms — both families are hardy. Rotation planning against
    // a previous brassica crop is the one place the distinction would matter.
    {
        name: 'Radish',
        category: 'Root',
        aliases: ['cherry belle', 'french breakfast', 'watermelon radish'],
    },
    { name: 'Daikon', category: 'Root' },
    { name: 'Turnip', category: 'Root', aliases: ['purple top turnip'] },
    { name: 'Rutabaga', category: 'Root', aliases: ['swede'] },
    { name: 'Parsnip', category: 'Root' },
    { name: 'Celeriac', category: 'Root', aliases: ['celery root'] },
    { name: 'Sunchoke', category: 'Root', aliases: ['jerusalem artichoke'] },
    // --------------------------------------------------------------- Leafy Green
    {
        name: 'Lettuce',
        category: 'Leafy Green',
        aliases: ['leaf lettuce', 'loose leaf lettuce', 'oakleaf', 'buttercrunch', 'black seeded simpson'],
    },
    { name: 'Romaine', category: 'Leafy Green', aliases: ['cos lettuce'] },
    { name: 'Butterhead', category: 'Leafy Green' },
    { name: 'Iceberg', category: 'Leafy Green' },
    { name: 'Mesclun', category: 'Leafy Green', aliases: ['salad mix', 'mixed greens'] },
    { name: 'Spinach', category: 'Leafy Green', aliases: ['bloomsdale'] },
    { name: 'Swiss Chard', category: 'Leafy Green', aliases: ['chard', 'rainbow chard'] },
    { name: 'Arugula', category: 'Leafy Green', aliases: ['rocket', 'roquette'] },
    { name: 'Mustard Greens', category: 'Leafy Green', aliases: ['mustard'] },
    { name: 'Mizuna', category: 'Leafy Green' },
    { name: 'Tatsoi', category: 'Leafy Green' },
    { name: 'Endive', category: 'Leafy Green', aliases: ['escarole'] },
    { name: 'Radicchio', category: 'Leafy Green', aliases: ['chicory'] },
    { name: 'Watercress', category: 'Leafy Green', aliases: ['cress'] },
    // A cress, despite the name. Not a Capsicum.
    { name: 'Pepper Grass', category: 'Leafy Green', aliases: ['peppergrass', 'curly cress'] },
    // Mâche. A salad green, despite the name.
    { name: 'Corn Salad', category: 'Leafy Green', aliases: ['mache', 'lambs lettuce'] },
    { name: 'Sorrel', category: 'Leafy Green' },
    // ---------------------------------------------------------------------- Herb
    {
        name: 'Basil',
        category: 'Herb',
        aliases: ['sweet basil', 'genovese', 'genovese basil', 'thai basil', 'holy basil', 'lemon basil'],
    },
    { name: 'Cilantro', category: 'Herb', aliases: ['coriander'] },
    {
        name: 'Parsley',
        category: 'Herb',
        aliases: ['flat leaf parsley', 'italian parsley', 'curly parsley'],
    },
    { name: 'Dill', category: 'Herb' },
    { name: 'Rosemary', category: 'Herb' },
    { name: 'Thyme', category: 'Herb', aliases: ['lemon thyme', 'english thyme'] },
    { name: 'Oregano', category: 'Herb', aliases: ['greek oregano'] },
    { name: 'Sage', category: 'Herb', aliases: ['garden sage'] },
    { name: 'Mint', category: 'Herb', aliases: ['spearmint', 'peppermint', 'chocolate mint'] },
    { name: 'Tarragon', category: 'Herb', aliases: ['french tarragon'] },
    { name: 'Marjoram', category: 'Herb', aliases: ['sweet marjoram'] },
    { name: 'Lavender', category: 'Herb', aliases: ['english lavender'] },
    { name: 'Lemon Balm', category: 'Herb' },
    { name: 'Fennel', category: 'Herb', aliases: ['florence fennel', 'bulb fennel'] },
    { name: 'Chamomile', category: 'Herb' },
    { name: 'Borage', category: 'Herb' },
    { name: 'Savory', category: 'Herb', aliases: ['summer savory', 'winter savory'] },
    { name: 'Stevia', category: 'Herb' },
    { name: 'Lemongrass', category: 'Herb' },
    // --------------------------------------------------------------------- Fruit
    // Hardy perennial fruit, and only that. Every entry here survives a frost,
    // which is what makes the category safe to map to a single tenderness.
    { name: 'Strawberry', category: 'Fruit', aliases: ['june bearing strawberry', 'everbearing strawberry'] },
    { name: 'Raspberry', category: 'Fruit', aliases: ['black raspberry'] },
    { name: 'Blackberry', category: 'Fruit', aliases: ['marionberry'] },
    { name: 'Blueberry', category: 'Fruit', aliases: ['highbush blueberry'] },
    { name: 'Gooseberry', category: 'Fruit' },
    { name: 'Currant', category: 'Fruit', aliases: ['black currant', 'red currant'] },
    { name: 'Grape', category: 'Fruit', aliases: ['concord grape', 'table grape'] },
    { name: 'Rhubarb', category: 'Fruit' },
    { name: 'Elderberry', category: 'Fruit' },
    { name: 'Cherry', category: 'Fruit', aliases: ['sour cherry', 'sweet cherry'] },
    // -------------------------------------------------------------------- Flower
    { name: 'Marigold', category: 'Flower', aliases: ['french marigold', 'african marigold'] },
    { name: 'Nasturtium', category: 'Flower' },
    { name: 'Zinnia', category: 'Flower' },
    { name: 'Cosmos', category: 'Flower' },
    { name: 'Sunflower', category: 'Flower', aliases: ['mammoth sunflower'] },
    { name: 'Calendula', category: 'Flower', aliases: ['pot marigold'] },
    { name: 'Poppy', category: 'Flower', aliases: ['corn poppy', 'california poppy'] },
    // Lathyrus, an ornamental vine. Not edible, and not a Legume as far as this
    // app is concerned — filing it with the peas would be wrong on both counts.
    { name: 'Sweet Pea', category: 'Flower' },
    // Ricinus, an ornamental. Emphatically not a bean.
    { name: 'Castor Bean', category: 'Flower' },
    { name: 'Snapdragon', category: 'Flower' },
    { name: 'Petunia', category: 'Flower' },
    { name: 'Dahlia', category: 'Flower' },
    { name: 'Alyssum', category: 'Flower', aliases: ['sweet alyssum'] },
    { name: 'Bachelor Button', category: 'Flower', aliases: ['cornflower'] },
    { name: 'Morning Glory', category: 'Flower' },
    { name: 'Echinacea', category: 'Flower', aliases: ['coneflower'] },
    { name: 'Black Eyed Susan', category: 'Flower' },
    // --------------------------------------------------------------------- Other
    // Corn (Poaceae), okra (Malvaceae), sweet potato (Convolvulaceae) and celery
    // (Apiaceae) each have exactly one common garden member, so a family category
    // for each would be a dropdown of singletons. They are also all tender, which
    // is what makes `Other` safe to map to a single tenderness — and tender is the
    // right default anyway: over-warning costs a bedsheet, under-warning costs the
    // crop.
    {
        name: 'Corn',
        category: 'Other',
        aliases: ['sweet corn', 'popcorn', 'flint corn', 'field corn', 'indian corn'],
    },
    { name: 'Okra', category: 'Other', aliases: ['clemson spineless'] },
    { name: 'Sweet Potato', category: 'Other', aliases: ['sweet potato slip'] },
    { name: 'Celery', category: 'Other', aliases: ['pascal celery'] },
    { name: 'Artichoke', category: 'Other', aliases: ['globe artichoke'] },
    { name: 'Asparagus', category: 'Other' },
    { name: 'Ginger', category: 'Other' },
    { name: 'Turmeric', category: 'Other' },
];
/**
 * Folds a name down to something comparable: no accents, no case, no
 * punctuation. `Jalapeño`, `jalapeno` and `JALAPEÑO!` all land on `jalapeno`,
 * because she should not have to find the ñ key to get a frost warning.
 */
export function normalizePlantName(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
function tokenize(value) {
    const normalized = normalizePlantName(value);
    return normalized === '' ? [] : normalized.split(' ');
}
/**
 * Plural spellings of a key's final word, so "Peppers" and "Tomatoes" match
 * without the input having to be de-pluralised — stripping a trailing `s` from
 * what the *user* typed is how "Brussels" becomes "Brussel" and "cress" becomes
 * "cres". Generating forwards from a known word is safe; guessing backwards
 * from an unknown one is not.
 */
function pluralForms(word) {
    if (word.endsWith('s'))
        return [];
    if (/[^aeiou]y$/.test(word))
        return [`${word.slice(0, -1)}ies`];
    if (/(x|z|ch|sh)$/.test(word))
        return [`${word}es`];
    // "tomatoes" is correct and "tomatos" is what people type.
    if (word.endsWith('o'))
        return [`${word}es`, `${word}s`];
    return [`${word}s`];
}
function keyVariants(key) {
    const tokens = tokenize(key);
    if (tokens.length === 0)
        return [];
    const head = tokens.slice(0, -1);
    const last = tokens[tokens.length - 1] ?? '';
    return [tokens.join(' '), ...pluralForms(last).map((plural) => [...head, plural].join(' '))];
}
/** Every searchable spelling of an entry, normalised. Exported for the tests. */
export function plantLookupKeys(entry) {
    const keys = new Set();
    for (const key of [entry.name, ...(entry.aliases ?? [])]) {
        for (const variant of keyVariants(key))
            keys.add(variant);
    }
    return [...keys];
}
/**
 * A `Map` rather than an object literal, for the reason `CATEGORY_TENDERNESS`
 * uses a null prototype: the keys are compared against strings that came from a
 * text box, and a plain object would report a hit for "constructor" or
 * "toString" and hand back whatever it inherited.
 */
const INDEX = (() => {
    const index = new Map();
    for (const entry of PLANT_CATALOGUE) {
        for (const key of plantLookupKeys(entry)) {
            // First writer wins, so the catalogue's own order is the tie-break and a
            // duplicate can never make the result depend on iteration order. A test
            // asserts no two *different* entries ever claim the same key.
            if (!index.has(key))
                index.set(key, entry);
        }
    }
    return index;
})();
/**
 * What plant a typed variety name refers to, or `null`.
 *
 * Resolution is whole-word spans only, longest first, and on a tie the span
 * nearest the **end** of the name wins. Both rules earn their keep:
 *
 *   * Whole-word spans are why `peppercorn` and `peppermint` do not become
 *     Capsicums, and why `horseradish` is not a radish.
 *   * Longest-first is why `Ground Cherry` is a nightshade rather than fruit,
 *     and why `Sweet Potato` is not a potato.
 *   * Nearest-the-end is because English compound plant names are head-final:
 *     a cherry tomato is a tomato, rhubarb chard is chard, and corn salad is a
 *     salad. The last noun is the plant; the ones before it are adjectives.
 *
 * Anything it cannot place returns `null` rather than a guess. A wrong category
 * is worse than no category, because a wrong one is applied silently.
 */
export function matchPlant(variety) {
    if (typeof variety !== 'string')
        return null;
    const tokens = tokenize(variety);
    if (tokens.length === 0)
        return null;
    const whole = tokens.join(' ');
    const exact = INDEX.get(whole);
    if (exact)
        return { entry: exact, confidence: 'exact', matched: whole };
    let best = null;
    for (let start = 0; start < tokens.length; start += 1) {
        for (let end = start + 1; end <= tokens.length; end += 1) {
            const span = tokens.slice(start, end).join(' ');
            const entry = INDEX.get(span);
            if (entry === undefined)
                continue;
            const length = end - start;
            const isBetter = best === null || length > best.length || (length === best.length && end > best.end);
            if (isBetter)
                best = { entry, length, end, matched: span };
        }
    }
    return best === null ? null : { entry: best.entry, confidence: 'contains', matched: best.matched };
}
/** The crop family for a typed variety name, or `null` if it is not recognised. */
export function categoryForVariety(variety) {
    return matchPlant(variety)?.entry.category ?? null;
}
/**
 * Catalogue entries matching what she has typed so far, best first.
 *
 * Ranked so that typing "pep" puts Pepper above Bell Pepper above Pepperoncini:
 * a name that starts with the query beats an alias that starts with it, which
 * beats a name that merely contains it. Within a rank, shorter names first, so
 * the plain plant comes before its cultivars.
 */
export function searchPlants(query, limit = 12) {
    const needle = normalizePlantName(query);
    if (needle === '')
        return [];
    const ranked = [];
    for (const entry of PLANT_CATALOGUE) {
        const name = normalizePlantName(entry.name);
        const aliases = (entry.aliases ?? []).map(normalizePlantName);
        let rank = -1;
        if (name.startsWith(needle))
            rank = 0;
        else if (aliases.some((alias) => alias.startsWith(needle)))
            rank = 1;
        else if (name.includes(needle))
            rank = 2;
        else if (aliases.some((alias) => alias.includes(needle)))
            rank = 3;
        if (rank >= 0)
            ranked.push({ entry, rank });
    }
    ranked.sort((left, right) => left.rank - right.rank ||
        left.entry.name.length - right.entry.name.length ||
        left.entry.name.localeCompare(right.entry.name));
    return ranked.slice(0, limit).map((candidate) => candidate.entry);
}
//# sourceMappingURL=plants.js.map
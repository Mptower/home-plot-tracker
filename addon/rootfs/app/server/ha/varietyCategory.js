import { categoryForVariety, isKnownTendernessCategory, matchPlant, moreTender, normalizePlantName, plantLookupKeys, tendernessOf, } from '@hpt/shared';
/**
 * Every tolerant spelling of a seed packet's variety name.
 *
 * Runs the packet's name through the catalogue's key generator by handing it a
 * one-off entry, so a packet is indexed under exactly the spellings a catalogue
 * plant of the same name would be.
 */
function packetKeys(variety) {
    return plantLookupKeys({ name: variety, category: '' });
}
/**
 * Indexes the vault by variety name, so a lookup is a map hit rather than a scan.
 *
 * Two maps rather than one, because an exact hit has to beat a tolerant one:
 * if she owns both "Corn Salad" and "Corn", the square that says "Corn Salad"
 * must find the packet that says so.
 *
 * `Map`s rather than object literals, for the reason `CATEGORY_TENDERNESS` uses
 * a null prototype: the keys are compared against strings that came from a text
 * box, and a plain object would report a hit for "constructor" or "toString"
 * and hand back whatever it inherited.
 */
function indexVault(seeds) {
    const exact = new Map();
    const tolerant = new Map();
    for (const seed of seeds) {
        if (typeof seed?.variety !== 'string')
            continue;
        // A category that means nothing to the tenderness map is not an answer, so
        // it is not indexed at all and the square falls through to the catalogue.
        if (!isKnownTendernessCategory(seed.category))
            continue;
        if (!exact.has(seed.variety))
            exact.set(seed.variety, seed.category);
        for (const key of packetKeys(seed.variety)) {
            // First writer wins, matching the catalogue's own tie-break, so two
            // packets that fold to the same key can never make the result depend on
            // iteration order.
            if (!tolerant.has(key))
                tolerant.set(key, seed.category);
        }
    }
    return { exact, tolerant };
}
/**
 * A resolver over her seed vault, falling back to the plant catalogue.
 *
 * Built once per assessment and called per square, because the vault index is
 * the expensive half and the catalogue's own index is built once per process.
 *
 * The index is built from every spelling of a packet's name and queried with
 * just the normalised square — the same asymmetry the catalogue uses, and the
 * reason a plural is only ever generated forwards from a name somebody
 * actually wrote.
 */
export function buildCategoryLookup(seeds) {
    const { exact, tolerant } = indexVault(seeds);
    return (variety) => {
        const fromExact = exact.get(variety);
        if (fromExact !== undefined)
            return fromExact;
        const normalized = normalizePlantName(variety);
        if (normalized === '')
            return null;
        return tolerant.get(normalized) ?? categoryForVariety(variety);
    };
}
/**
 * How a bed square takes a frost, erring towards the tender answer.
 *
 * The frost engine's resolver, and the only caller of it. Everything else in the
 * app asks `buildCategoryLookup` and gets the category she filed, unchanged.
 *
 * Her filing is resolved exactly as it always was, and then — and only then —
 * checked against the catalogue's opinion of the same square. The catalogue only
 * gets a vote when it recognises the *whole* name, because overruling her
 * deserves a higher bar than filling in a blank and the substring matcher does
 * not clear it. When both have an answer and they disagree, the more tender one
 * wins.
 *
 * Note what this does *not* do. It cannot talk the frost engine out of a
 * warning: where she has filed something tender and the catalogue disagrees,
 * `moreTender` has no way to travel back. It does not invent a reading for a
 * square nothing places. And it hands back no category at all, which is what
 * keeps crop rotation reading her records rather than this file's opinion of
 * them.
 */
export function buildTendernessLookup(seeds) {
    const categoryOf = buildCategoryLookup(seeds);
    return (variety) => {
        const filed = tendernessOf(categoryOf(variety));
        const match = matchPlant(variety);
        // A `contains` match is a guess about which word in the name is the plant,
        // and a guess is not grounds for overriding something she typed herself.
        if (match === null || match.confidence !== 'exact')
            return filed;
        return moreTender(filed, tendernessOf(match.entry.category));
    };
}
//# sourceMappingURL=varietyCategory.js.map
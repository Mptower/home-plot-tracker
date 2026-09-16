/**
 * What is planted in a square, and which crop family it belongs to.
 *
 * A bed square holds a variety name and nothing else — a string she typed or
 * picked. The frost warning needs a crop family, because that is what
 * `CATEGORY_TENDERNESS` is keyed on, and everything interesting about this file
 * is how it gets from one to the other without either missing a planting or
 * inventing an answer.
 *
 * ## Why this stopped being a one-line map lookup
 *
 * It used to be: index the seed vault by variety name, match the square's
 * string against it exactly, and give up otherwise. Giving up means `unknown`,
 * and an `unknown` square raises no warning at all — it is counted, honestly, in
 * `unknownSquareCount`, and she is never told. A plant the app cannot categorise
 * is a plant the app will quietly let die on a night it saw coming.
 *
 * Two things made that miss constantly. Exact matching means a bed square and a
 * packet that differ by a space, a plural or a capital letter do not match: her
 * own data has a packet called "Cherry Tomato" and a harvest logged as "Tomato".
 * And the bed planner now offers the plant catalogue directly, so she can plant
 * ~170 varieties she has no packet for and never will.
 *
 * ## The order, and why it is that order
 *
 * 1. **The vault, matched exactly.** Unchanged, and first because it is what she
 *    literally typed on a packet she literally owns.
 * 2. **The vault, matched tolerantly** — case, accents, punctuation and plurals
 *    folded away. "cherry tomato" and "Tomatoes" find the packet they obviously
 *    mean.
 * 3. **The catalogue.** What the app knows about plants in general. This is the
 *    tier that closes the blind spot: a square planted from the plant list, or
 *    typed freehand, now has a family.
 * 4. **Nothing.** `null`, which becomes `unknown`, which raises no warning and
 *    says so. Still the right answer for a square nobody can place — a warning
 *    that guesses is a warning she learns to distrust.
 *
 * **The vault wins; the catalogue only fills gaps.** A packet she filed as
 * `Leafy Green` stays a leafy green even if the catalogue is certain it is a
 * tomato. Silently overruling her would make `CategoryFixBanner` — which exists
 * precisely to offer that correction, and to explain what it costs her — a lie.
 * That is true of the *category*, which is what everything below reads; frost
 * tenderness is a separate question with a separate answer, further down.
 *
 * With one exception, which is not really an exception: a packet whose category
 * is a string the tenderness map has never heard of (free text from before the
 * app offered a list) has told us *nothing usable*, so it is not treated as the
 * vault having spoken and resolution carries on to the catalogue. An
 * uninterpretable category is a gap, not a decision. Stopping there would
 * reproduce exactly the bug this file exists to close.
 *
 * ## The tolerance is borrowed, not invented
 *
 * Tier 2 builds its keys with the catalogue's own `plantLookupKeys`, so there is
 * one normalisation and one pluralisation rule in the codebase rather than two
 * that drift. In particular plurals are still generated *forwards* from a known
 * word — never stripped backwards off user input, which is how "Brussels"
 * becomes "Brussel" and "cress" becomes "cres".
 *
 * There is deliberately no fuzzy matching, no edit distance and no prefix
 * guessing. `matchPlant` already stops at whole-word spans and returns `null`
 * rather than a guess; this file does not loosen that. `unknown` is honest, and
 * a confident wrong answer is not.
 *
 * ## Which family, and how it takes a frost, are different questions
 *
 * Everything above answers the first one, and that is the answer everything
 * except the frost engine wants. A category is a crop family: it colours a chip,
 * it files a packet in the vault, and it is what the rotation warning compares
 * against what grew in the bed last year. Those are all statements about her
 * records, and her records are hers.
 *
 * `buildTendernessLookup` answers the second, and it is allowed to disagree.
 * She filed her cherry tomatoes as a `Leafy Green` — an entirely reasonable
 * thing to do with a leafy plant, especially when the form that took that row
 * asked a home gardener for a botanical family and offered no list to pick
 * from. `Leafy Green` is hardy, so the frost engine had nothing to say, and her
 * only crop went into first frost unwarned while both a seed packet and a
 * catalogue entry sat there with the word "Tomato" in them.
 *
 * So for tenderness *only*, her filing and an exact catalogue match are both
 * consulted and the more tender of the two wins. The bias is one-way — it may
 * move a plant from hardy towards tender and never the reverse — because the two
 * mistakes are not the same size. Under-warning costs the crop on a night the
 * forecast already saw coming. Over-warning costs a walk outside with a
 * bedsheet.
 *
 * Three things stop that becoming a blanket "warn about everything":
 *
 *   * **Exact matches only.** `matchPlant` will find a known plant inside a
 *     longer name, and that is not a good enough reason to overrule a decision
 *     she made months ago: "Chocolate Cherry" is a cherry tomato, and a
 *     `contains` match reads the word "cherry" and calls it fruit. Only a
 *     whole-name hit counts. That still covers her row, and it still covers a
 *     plural or differently-cased square, because "cherry tomatoes" is one of
 *     the keys the catalogue generates for `Cherry Tomato` itself.
 *   * **It never produces a category.** The bias returns a `Tenderness` and
 *     nothing else, so there is no category here for rotation, a badge or the
 *     vault to pick up by accident. Kale filed as a `Leafy Green` is still a
 *     leafy green everywhere it is shown or rotated on — and still hardy, too,
 *     because on that packet the two answers agree.
 *   * **Unknown is never promoted.** A square nothing can place has no exact
 *     match either, so there is nothing to compare it against: it stays
 *     `unknown`, is counted as such, and still raises nothing.
 *
 * This is a safety net, not a repair. `CategoryFixBanner` still offers to
 * correct the row and correcting it is still the goal — the net only reaches
 * names the catalogue knows outright, and the category is what her rotation is
 * actually built on.
 */
import type { SeedPacket, Tenderness } from '@hpt/shared';
import {
  categoryForVariety,
  isKnownTendernessCategory,
  matchPlant,
  moreTender,
  normalizePlantName,
  plantLookupKeys,
  tendernessOf,
} from '@hpt/shared';

/** Resolves a bed square's variety name to a crop family, or `null`. */
export type CategoryLookup = (variety: string) => string | null;

/** Resolves a bed square's variety name to how badly it minds the cold. */
export type TendernessLookup = (variety: string) => Tenderness;

/**
 * Every tolerant spelling of a seed packet's variety name.
 *
 * Runs the packet's name through the catalogue's key generator by handing it a
 * one-off entry, so a packet is indexed under exactly the spellings a catalogue
 * plant of the same name would be.
 */
function packetKeys(variety: string): string[] {
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
function indexVault(seeds: readonly SeedPacket[]): {
  exact: Map<string, string>;
  tolerant: Map<string, string>;
} {
  const exact = new Map<string, string>();
  const tolerant = new Map<string, string>();

  for (const seed of seeds) {
    if (typeof seed?.variety !== 'string') continue;
    // A category that means nothing to the tenderness map is not an answer, so
    // it is not indexed at all and the square falls through to the catalogue.
    if (!isKnownTendernessCategory(seed.category)) continue;

    if (!exact.has(seed.variety)) exact.set(seed.variety, seed.category);

    for (const key of packetKeys(seed.variety)) {
      // First writer wins, matching the catalogue's own tie-break, so two
      // packets that fold to the same key can never make the result depend on
      // iteration order.
      if (!tolerant.has(key)) tolerant.set(key, seed.category);
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
export function buildCategoryLookup(seeds: readonly SeedPacket[]): CategoryLookup {
  const { exact, tolerant } = indexVault(seeds);

  return (variety) => {
    const fromExact = exact.get(variety);
    if (fromExact !== undefined) return fromExact;

    const normalized = normalizePlantName(variety);
    if (normalized === '') return null;

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
export function buildTendernessLookup(seeds: readonly SeedPacket[]): TendernessLookup {
  const categoryOf = buildCategoryLookup(seeds);

  return (variety) => {
    const filed = tendernessOf(categoryOf(variety));
    const match = matchPlant(variety);

    // A `contains` match is a guess about which word in the name is the plant,
    // and a guess is not grounds for overriding something she typed herself.
    if (match === null || match.confidence !== 'exact') return filed;

    return moreTender(filed, tendernessOf(match.entry.category));
  };
}

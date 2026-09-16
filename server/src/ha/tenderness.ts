/**
 * The frost bands, and the crop-family tenderness map the warnings are built on.
 *
 * The map itself is not here any more. It lives in `shared/src/tenderness.ts`
 * and is re-exported below, because the browser needs the same knowledge — the
 * point of offering to fix a miscategorised packet is being able to say *why it
 * matters*, that her tomato is currently filed as something the frost engine
 * treats as hardy and so is not being warned about.
 *
 * There used to be two hand-kept copies of it, held together by a parity test,
 * because the add-on image did not ship `@hpt/shared` and a server runtime
 * import from it would have crashed the add-on on boot.
 * `scripts/build-addon.mjs` now stages that package into the image as a real
 * `file:` dependency, so there is one copy again. The re-export keeps every
 * existing import in `server/src/ha/` pointing at this file, which is where the
 * warnings come from and where somebody reading the frost engine will look.
 */
import {
  CATEGORY_TENDERNESS,
  isKnownTendernessCategory,
  moreTender,
  tendernessOf,
} from '@hpt/shared';

export { CATEGORY_TENDERNESS, isKnownTendernessCategory, moreTender, tendernessOf };

/**
 * Which of the given categories this mapping does not cover.
 *
 * Takes the list rather than importing `SEED_CATEGORIES` so the check reads the
 * same in a test as it would anywhere else. It exists so a test can fail the
 * day somebody adds a ninth category and forgets the map — at which point every
 * plant of that family would silently become `unknown` and stop being warned
 * about, with nothing anywhere to say so.
 */
export function categoriesMissingTenderness(categories: readonly string[]): string[] {
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
 *
 * These stay server-side. Nothing in the browser decides whether it is cold.
 */
export const FROST_THRESHOLDS_F = {
  /** Tender crops at risk. Cover them. */
  advisory: 36,
  /** Tender crops killed outright. Hardy crops unbothered. */
  frost: 32,
  /** Hardy crops damaged too. This is the one that ends a season. */
  hardFreeze: 28,
} as const;

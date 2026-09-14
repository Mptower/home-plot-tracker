/**
 * How badly each crop family minds the cold — the browser's copy.
 *
 * This is a deliberate duplicate of `server/src/ha/tenderness.ts`, and the
 * duplication is the least bad option available rather than an oversight.
 *
 * The frost engine is server-side, and that file cannot live here: the add-on
 * image stages `server/dist/src` with Express as its only dependency and no
 * `node_modules/@hpt/shared` at all, so a server runtime import from this
 * package would resolve in development, pass every test, typecheck clean, and
 * then crash the add-on on boot. (See the header of `homeAssistant.ts` and
 * `server/test/shared-imports.test.ts`.)
 *
 * But the browser now needs the same knowledge, because the whole point of
 * offering to fix a miscategorised packet is being able to tell her *why it
 * matters* — that her tomato is currently filed as something the frost engine
 * considers hardy, and so is not being warned about.
 *
 * The two copies are held together by `server/test/tenderness-parity.test.ts`,
 * which fails if they ever disagree. The server file is the one the warnings
 * actually come from and stays the source of truth; this one follows it.
 *
 * The honest alternative is to stage `shared/dist` into the add-on image so
 * there is only ever one copy. That changes her deployment path, nothing in CI
 * builds the Docker image, and it is not worth bundling into a change about
 * plant names — so it is left for its own PR.
 */
import type { Tenderness } from './index.js';

/** Crop family to cold tolerance. Mirrors `server/src/ha/tenderness.ts`. */
export const CATEGORY_TENDERNESS: Readonly<Record<string, Tenderness>> = Object.assign(
  Object.create(null) as Record<string, Tenderness>,
  {
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
  } satisfies Record<string, Tenderness>,
);

/**
 * Cold tolerance for a category, or `unknown` for anything unrecognised.
 *
 * Null-prototype lookup, because the keys come from user input: an ordinary
 * object would answer for `constructor` and `toString`.
 */
export function tendernessOf(category: string | null | undefined): Tenderness {
  if (!category) return 'unknown';

  return Object.hasOwn(CATEGORY_TENDERNESS, category)
    ? (CATEGORY_TENDERNESS[category] ?? 'unknown')
    : 'unknown';
}

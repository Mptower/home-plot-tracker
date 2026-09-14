/**
 * There is one tenderness map, and this is what says so.
 *
 * This file replaces `tenderness-parity.test.ts`, which existed because there
 * were two hand-kept copies of the map — one in `server/src/ha/tenderness.ts`
 * for the frost engine, one in `shared/src/tenderness.ts` for the browser — and
 * something had to fail when they drifted. They could not be merged, because
 * the add-on image did not ship `@hpt/shared` and a server runtime import from
 * it would have crashed the add-on on boot.
 *
 * `scripts/build-addon.mjs` now stages that package into the image, so the
 * duplicate is gone and a parity assertion would be comparing an object with
 * itself. The interesting question changed with it: not "do the two copies
 * agree" but "is there still only one". A future edit that reintroduced a local
 * literal here would pass a parity test — the copies would start out identical
 * — and quietly restore the drift. Identity does not.
 *
 * What each category *means* is tested next door in `frost.test.ts`, where the
 * warnings that depend on it are.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORY_TENDERNESS as SHARED_CATEGORY_TENDERNESS,
  SEED_CATEGORIES,
  isKnownTendernessCategory as sharedIsKnown,
  tendernessOf as sharedTendernessOf,
} from '@hpt/shared';
import {
  CATEGORY_TENDERNESS,
  isKnownTendernessCategory,
  tendernessOf,
} from '../src/ha/tenderness.ts';

test('the frost engine and the browser share one map object, not two that agree', () => {
  // `equal`, not `deepEqual`: two literals that happen to match would satisfy
  // deep equality on the day they were written and drift silently afterwards.
  assert.equal(CATEGORY_TENDERNESS, SHARED_CATEGORY_TENDERNESS);
  assert.equal(tendernessOf, sharedTendernessOf);
  assert.equal(isKnownTendernessCategory, sharedIsKnown);
});

test('every category the app offers is one the map has an answer for', () => {
  for (const category of SEED_CATEGORIES) {
    assert.equal(isKnownTendernessCategory(category), true, `${category} is not in the map`);
  }
});

test('free text from before the category list is not mistaken for an answer', () => {
  // This is the distinction the frost engine leans on: a packet carrying an
  // uninterpretable category has told it nothing, so resolution falls through to
  // the plant catalogue instead of stopping at a shrug. See
  // `server/src/ha/varietyCategory.ts`.
  assert.equal(isKnownTendernessCategory('Nightshade'), true);
  assert.equal(isKnownTendernessCategory('Tomatoes'), false);
  assert.equal(isKnownTendernessCategory('Vegetable'), false);
  // Case-sensitive, because the categories are a fixed list the app writes, not
  // something to be guessed at.
  assert.equal(isKnownTendernessCategory('nightshade'), false);
});

test('nothing reaches through the map prototype and comes back a category', () => {
  assert.equal(isKnownTendernessCategory('constructor'), false);
  assert.equal(isKnownTendernessCategory('toString'), false);
  assert.equal(isKnownTendernessCategory('__proto__'), false);
  assert.equal(isKnownTendernessCategory('hasOwnProperty'), false);
  assert.equal(isKnownTendernessCategory(''), false);
  assert.equal(isKnownTendernessCategory(null), false);
  assert.equal(isKnownTendernessCategory(undefined), false);
});

/**
 * The two copies of the tenderness map must agree.
 *
 * `server/src/ha/tenderness.ts` is where the frost warnings actually come from.
 * `shared/src/tenderness.ts` is the browser's copy, which exists so the seed
 * vault can explain *why* a miscategorised packet matters — "this one is filed
 * as something the frost engine treats as hardy, so you are not being warned
 * about it". Both headers explain why there are two.
 *
 * A duplicate is only acceptable while something fails when it drifts. This is
 * that something. If it ever goes red, fix the copies rather than the test: a
 * silent disagreement means the app tells her one thing and warns her about
 * another.
 *
 * Note this file is `server/test`, not `server/src`, which is why it is allowed
 * to import `@hpt/shared` as a runtime value at all — see
 * `shared-imports.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_CATEGORY_TENDERNESS, clientTendernessOf, SEED_CATEGORIES } from '@hpt/shared';
import { CATEGORY_TENDERNESS, tendernessOf } from '../src/ha/tenderness.ts';

test('the browser and the frost engine agree, category for category', () => {
  // Spread rather than compared directly: both are null-prototype objects, and
  // deepEqual on those compares prototypes too.
  assert.deepEqual({ ...CLIENT_CATEGORY_TENDERNESS }, { ...CATEGORY_TENDERNESS });
});

test('neither copy has a category the other is missing', () => {
  assert.deepEqual(
    Object.keys(CLIENT_CATEGORY_TENDERNESS).sort(),
    Object.keys(CATEGORY_TENDERNESS).sort(),
  );
});

test('every category the app offers is answered the same way by both', () => {
  for (const category of SEED_CATEGORIES) {
    assert.equal(
      clientTendernessOf(category),
      tendernessOf(category),
      `${category} is classified differently in the browser than on the server`,
    );
  }
});

test('the browser copy is as careful about prototype keys as the server one', () => {
  assert.equal(clientTendernessOf('constructor'), 'unknown');
  assert.equal(clientTendernessOf('toString'), 'unknown');
  assert.equal(clientTendernessOf('__proto__'), 'unknown');
  assert.equal(clientTendernessOf(''), 'unknown');
  assert.equal(clientTendernessOf(null), 'unknown');
  assert.equal(clientTendernessOf(undefined), 'unknown');
});

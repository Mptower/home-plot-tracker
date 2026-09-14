/**
 * The plant catalogue, and specifically the places it could quietly get a
 * category wrong.
 *
 * The whole point of the catalogue is that a gardener never has to think about
 * crop families, which means the matcher has to be right without supervision.
 * Most of this file is therefore the traps: compound names whose obvious
 * substring points at the wrong plant. A `peppercorn` is not a Capsicum, a
 * `sweet potato` is not a potato, a `ground cherry` is not fruit, and a
 * `castor bean` will not feed anybody.
 *
 * These live in the client workspace because `@hpt/shared` is a client-side
 * runtime dependency and only a client-side one — see the header of
 * `shared/src/plants.ts`, and `server/test/shared-imports.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_CATEGORIES } from '@hpt/shared';
import {
  PLANT_CATALOGUE,
  categoryForVariety,
  matchPlant,
  normalizePlantName,
  plantLookupKeys,
  searchPlants,
} from '@hpt/shared';

/** Shorthand: assert a typed variety name lands in the expected family. */
function expectCategory(variety: string | null | undefined, category: string | null): void {
  assert.equal(
    categoryForVariety(variety),
    category,
    `${JSON.stringify(variety)} should resolve to ${category ?? 'no category'}`,
  );
}

test('the catalogue only uses categories the app offers', () => {
  const allowed = new Set(SEED_CATEGORIES);
  const strays = PLANT_CATALOGUE.filter((entry) => !allowed.has(entry.category));

  assert.deepEqual(strays, []);
});

test('no two entries claim the same name', () => {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const entry of PLANT_CATALOGUE) {
    const key = normalizePlantName(entry.name);
    if (seen.has(key)) duplicates.push(entry.name);
    seen.add(key);
  }

  assert.deepEqual(duplicates, []);
});

test('no lookup key is claimed by two different plants', () => {
  // A collision would make the answer depend on catalogue order, which is
  // exactly the kind of quiet wrongness this whole feature exists to remove.
  const owner = new Map<string, string>();
  const collisions: string[] = [];

  for (const entry of PLANT_CATALOGUE) {
    for (const key of plantLookupKeys(entry)) {
      const existing = owner.get(key);
      if (existing !== undefined && existing !== entry.name) {
        collisions.push(`${key}: ${existing} vs ${entry.name}`);
      }
      owner.set(key, entry.name);
    }
  }

  assert.deepEqual(collisions, []);
});

test('the complaint that started this is covered: peppers, herbs and fruit', () => {
  // "it's missing some pretty important plant types, like peppers — we grow
  // both jalapeno and bell peppers. It is also missing a lot of herbs and
  // fruits."
  for (const pepper of [
    'Bell Pepper',
    'Jalapeño',
    'Habanero',
    'Serrano',
    'Poblano',
    'Cayenne',
    'Banana Pepper',
    'Ghost Pepper',
    'Shishito',
    'Anaheim',
    'Mini Sweet Pepper',
  ]) {
    expectCategory(pepper, 'Nightshade');
  }

  for (const herb of [
    'Basil',
    'Thai Basil',
    'Cilantro',
    'Coriander',
    'Flat Leaf Parsley',
    'Curly Parsley',
    'Dill',
    'Rosemary',
    'Thyme',
    'Oregano',
    'Sage',
    'Mint',
    'Tarragon',
    'Marjoram',
    'Lavender',
    'Lemon Balm',
    'Fennel',
  ]) {
    expectCategory(herb, 'Herb');
  }

  for (const fruit of ['Strawberry', 'Raspberry', 'Blackberry', 'Blueberry', 'Grape', 'Rhubarb']) {
    expectCategory(fruit, 'Fruit');
  }

  // Melons and ground cherries are fruit in the kitchen and not in the garden.
  expectCategory('Cantaloupe', 'Cucurbit');
  expectCategory('Watermelon', 'Cucurbit');
  expectCategory('Melon', 'Cucurbit');
  expectCategory('Ground Cherry', 'Nightshade');
});

test('her live data resolves the way it should have all along', () => {
  // The two rows exported from her box: a seed packet and a harvest that never
  // linked up, both filed by hand.
  expectCategory('Cherry Tomato', 'Nightshade');
  expectCategory('Tomato', 'Nightshade');
});

test('a whole name that is a catalogue entry matches exactly', () => {
  const match = matchPlant('Cherry Tomato');

  assert.equal(match?.confidence, 'exact');
  assert.equal(match?.entry.name, 'Cherry Tomato');
});

test('a known plant inside a longer name matches by containment', () => {
  const match = matchPlant('Sugar Baby Watermelon');

  assert.equal(match?.confidence, 'contains');
  assert.equal(match?.entry.name, 'Watermelon');
});

test('case, accents, punctuation and plurals all fold away', () => {
  for (const spelling of ['Jalapeño', 'jalapeno', 'JALAPEÑO', 'Jalapeños', '  jalapeño!  ']) {
    expectCategory(spelling, 'Nightshade');
  }

  expectCategory('Peppers', 'Nightshade');
  expectCategory('Tomatoes', 'Nightshade');
  // What people type when they are not sure about the -oes.
  expectCategory('Tomatos', 'Nightshade');
  expectCategory('Cherries', 'Fruit');
  expectCategory('Radishes', 'Root');
  expectCategory('Brussels Sprouts', 'Brassica');
  expectCategory('Peas', 'Legume');
});

test('a substring that is not a whole word never matches', () => {
  // Piper nigrum. Not a Capsicum, and nothing in the catalogue.
  expectCategory('Peppercorn', null);
  expectCategory('Black Peppercorns', null);

  // These two *are* in the catalogue, and must resolve on their own terms
  // rather than by finding "pepper" inside themselves.
  expectCategory('Peppermint', 'Herb');
  expectCategory('Pepperoncini', 'Nightshade');

  // Armoracia rusticana. A brassica, and not a radish.
  expectCategory('Horseradish', 'Brassica');
});

test('the longest known span wins over a shorter one inside it', () => {
  expectCategory('Ground Cherry', 'Nightshade');
  expectCategory('Cape Gooseberry', 'Nightshade');
  expectCategory('Husk Cherry', 'Nightshade');
  expectCategory('Gooseberry', 'Fruit');

  // Ipomoea batatas is not Solanum tuberosum, and unlike a potato its vines are
  // killed outright by a frost.
  expectCategory('Sweet Potato', 'Other');
  expectCategory('Purple Sweet Potato', 'Other');
  expectCategory('Potato', 'Nightshade');
  expectCategory('Yukon Gold Potatoes', 'Nightshade');

  expectCategory('Cherry Belle Radish', 'Root');
  expectCategory('Cherry Bomb Pepper', 'Nightshade');
  expectCategory('Black Cherry Tomato', 'Nightshade');
  expectCategory('Cherry', 'Fruit');

  // A cress and an ornamental, both wearing a vegetable's name.
  expectCategory('Pepper Grass', 'Leafy Green');
  expectCategory('Castor Bean', 'Flower');
  expectCategory('Sweet Pea', 'Flower');
  expectCategory('Sugar Snap Pea', 'Legume');

  // Mâche.
  expectCategory('Corn Salad', 'Leafy Green');
  expectCategory('Sweet Corn', 'Other');

  // A multiplier onion.
  expectCategory('Potato Onion', 'Allium');

  // Helianthus tuberosus. A tuber, and hardy, unlike a globe artichoke.
  expectCategory('Jerusalem Artichoke', 'Root');
  expectCategory('Artichoke', 'Other');

  // Apium graveolens var. rapaceum — the hardy root, not the tender stalk.
  expectCategory('Celery Root', 'Root');
  expectCategory('Celery', 'Other');
});

test('on a tie the plant nearest the end of the name wins', () => {
  // English compound plant names are head-final: the last noun is the plant and
  // everything before it is an adjective.
  expectCategory('Rhubarb Chard', 'Leafy Green');
  expectCategory('Strawberry Spinach', 'Leafy Green');
  expectCategory('Corn Poppy', 'Flower');
  expectCategory('Strawberry Popcorn', 'Other');
  expectCategory('Watermelon Radish', 'Root');
  expectCategory('Lemon Cucumber', 'Cucurbit');
  expectCategory('Yellow Pear Tomato', 'Nightshade');
  expectCategory('Bitter Melon', 'Cucurbit');
});

test('named heirlooms resolve without the word "tomato" anywhere', () => {
  for (const heirloom of [
    'Cherokee Purple',
    'Brandywine',
    'San Marzano',
    'Early Girl',
    'Better Boy',
    'Sungold',
    'Sun Gold',
    'Green Zebra',
    'Mortgage Lifter',
    'Black Krim',
  ]) {
    expectCategory(heirloom, 'Nightshade');
  }
});

test('the rest of a normal plot is covered', () => {
  const expectations: [string, string][] = [
    ['Zucchini', 'Cucurbit'],
    ['Butternut Squash', 'Cucurbit'],
    ['Pumpkin', 'Cucurbit'],
    ['Cucumber', 'Cucurbit'],
    ['Green Beans', 'Legume'],
    ['Snow Pea', 'Legume'],
    ['Edamame', 'Legume'],
    ['Broccoli', 'Brassica'],
    ['Cauliflower', 'Brassica'],
    ['Cabbage', 'Brassica'],
    ['Kale', 'Brassica'],
    ['Collard Greens', 'Brassica'],
    ['Onion', 'Allium'],
    ['Garlic', 'Allium'],
    ['Shallot', 'Allium'],
    ['Leek', 'Allium'],
    ['Scallion', 'Allium'],
    ['Chives', 'Allium'],
    ['Carrot', 'Root'],
    ['Beet', 'Root'],
    ['Radish', 'Root'],
    ['Turnip', 'Root'],
    ['Parsnip', 'Root'],
    ['Romaine', 'Leafy Green'],
    ['Spinach', 'Leafy Green'],
    ['Swiss Chard', 'Leafy Green'],
    ['Arugula', 'Leafy Green'],
    ['Mustard Greens', 'Leafy Green'],
    ['Corn', 'Other'],
    ['Okra', 'Other'],
    ['Eggplant', 'Nightshade'],
    ['Tomatillo', 'Nightshade'],
    ['Marigold', 'Flower'],
    ['Nasturtium', 'Flower'],
  ];

  for (const [variety, category] of expectations) expectCategory(variety, category);
});

test('an unrecognised variety is admitted rather than guessed at', () => {
  expectCategory('Bed 3 mystery seeds', null);
  expectCategory('', null);
  expectCategory('   ', null);
  expectCategory(null, null);
  expectCategory(undefined, null);

  // Object.prototype keys must not find an inherited property.
  expectCategory('constructor', null);
  expectCategory('toString', null);
  expectCategory('__proto__', null);
});

test('search ranks the plain plant above its cultivars', () => {
  const results = searchPlants('pep').map((entry) => entry.name);

  assert.equal(results[0], 'Pepper');
  assert.ok(results.includes('Bell Pepper'));
  assert.ok(results.includes('Pepperoncini'));
});

test('search finds a plant through an alias she typed', () => {
  assert.ok(searchPlants('courgette').some((entry) => entry.name === 'Zucchini'));
  assert.ok(searchPlants('edamame').some((entry) => entry.name === 'Soybean'));
  assert.ok(searchPlants('rapini').some((entry) => entry.name === 'Broccoli Rabe'));
});

test('search is forgiving about accents and honours its limit', () => {
  assert.ok(searchPlants('jalapeno').some((entry) => entry.name === 'Jalapeño'));
  assert.ok(searchPlants('jalapeño').some((entry) => entry.name === 'Jalapeño'));

  assert.equal(searchPlants('e', 5).length, 5);
  assert.deepEqual(searchPlants(''), []);
  assert.deepEqual(searchPlants('   '), []);
  assert.deepEqual(searchPlants('zzzzz'), []);
});

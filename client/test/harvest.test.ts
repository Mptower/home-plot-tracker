/**
 * The variety suggestions behind the harvest form.
 *
 * This exists because of a specific fragmentation in her real data: the seed
 * packet said "Cherry Tomato", the harvest said "Tomato", and because both are
 * free text the season totals counted one plant as two. Suggesting what she has
 * actually planted is how the two stop drifting apart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { GardenBed, HarvestLog, SeedPacket } from '@hpt/shared';
import { collectVarietyOptions } from '../src/lib/harvest.ts';

function seed(overrides: Partial<SeedPacket> = {}): SeedPacket {
  return {
    id: 'seed_cherry',
    variety: 'Cherry Tomato',
    category: 'Nightshade',
    brand: 'Burpee',
    purchaseYear: 2026,
    notes: '',
    ...overrides,
  };
}

function bed(overrides: Partial<GardenBed> = {}): GardenBed {
  return {
    id: 'bed_tomato',
    name: 'Tomato bed',
    rows: 1,
    columns: 2,
    layout: [['Cherry Tomato', null]],
    lastYearCategory: '',
    ...overrides,
  };
}

function harvest(overrides: Partial<HarvestLog> = {}): HarvestLog {
  return {
    id: 'harvest_1',
    date: '2026-09-04',
    variety: 'Tomato',
    weightLbs: 0,
    count: 10,
    ...overrides,
  };
}

test('what is growing in a bed is suggested, not just what is in the vault', () => {
  const options = collectVarietyOptions(
    [],
    [],
    [bed({ layout: [['Jalapeño', 'Bell Pepper']] })],
  );

  assert.deepEqual(options, ['Bell Pepper', 'Jalapeño']);
});

test('her three sources are merged and alphabetised', () => {
  const options = collectVarietyOptions([seed()], [harvest()], [bed()]);

  // "Cherry Tomato" appears in both the vault and the bed; "Tomato" only in the
  // log. All three sources, no duplicates.
  assert.deepEqual(options, ['Cherry Tomato', 'Tomato']);
});

test('empty squares and blank names never become suggestions', () => {
  const options = collectVarietyOptions(
    [seed({ variety: '   ' })],
    [],
    [bed({ rows: 2, columns: 2, layout: [[null, null], ['Basil', null]] })],
  );

  assert.deepEqual(options, ['Basil']);
});

test('the same variety cased two ways is one suggestion, spelled the first way seen', () => {
  const options = collectVarietyOptions(
    [seed({ variety: 'Cherry Tomato' })],
    [harvest({ variety: 'cherry tomato' })],
    [],
  );

  assert.deepEqual(options, ['Cherry Tomato']);
});

test('beds are optional, so nothing that called this before has changed', () => {
  assert.deepEqual(collectVarietyOptions([seed()], [harvest()]), ['Cherry Tomato', 'Tomato']);
});

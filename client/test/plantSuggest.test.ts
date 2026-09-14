/**
 * The suggestion layer behind every place she types a variety name.
 *
 * The rule being defended here is that **her vault comes first**. A catalogue
 * that buried her own packets under a hundred varieties she has never bought
 * would be a worse app than the one with no catalogue at all, so the ordering
 * is pinned rather than left to whichever list happened to be concatenated
 * first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SeedPacket } from '../src/types.ts';
import {
  catalogueSuggestions,
  moveHighlight,
  suggestVarieties,
  vaultSuggestions,
} from '../src/lib/plantSuggest.ts';

function packet(overrides: Partial<SeedPacket> = {}): SeedPacket {
  return {
    id: 'seed_cherokee_purple',
    variety: 'Cherokee Purple',
    category: 'Nightshade',
    brand: 'Baker Creek',
    purchaseYear: 2025,
    notes: '',
    ...overrides,
  };
}

const VAULT: SeedPacket[] = [
  packet(),
  packet({ id: 'seed_cherry', variety: 'Cherry Tomato', category: 'Leafy Green', brand: 'Burpee', purchaseYear: 2026 }),
  packet({ id: 'seed_basil', variety: 'Genovese Basil', category: 'Herb', brand: 'Botanical Interests', purchaseYear: 2024 }),
];

test('the catalogue answers the complaint that started this', () => {
  // "it is missing some pretty important plant types, like peppers — we grow
  // both jalapeno and bell peppers."
  const jalapeno = catalogueSuggestions('jalap');
  assert.equal(jalapeno[0]?.variety, 'Jalapeño');
  assert.equal(jalapeno[0]?.category, 'Nightshade');

  const bell = catalogueSuggestions('bell');
  assert.equal(bell[0]?.variety, 'Bell Pepper');
  assert.equal(bell[0]?.category, 'Nightshade');
});

test('a catalogue suggestion carries the family, so the form can fill it in', () => {
  for (const suggestion of catalogueSuggestions('tomato')) {
    assert.equal(suggestion.source, 'catalogue');
    assert.equal(suggestion.category, 'Nightshade');
    assert.equal(suggestion.detail, '');
  }
});

test('catalogue suggestions respect the limit', () => {
  // "pepper" matches more than a dozen entries, so this is a real cap.
  assert.equal(catalogueSuggestions('pepper', { limit: 3 }).length, 3);
  assert.ok(catalogueSuggestions('pepper').length <= 8);
});

test('excluded varieties are dropped without shortening the list', () => {
  const unfiltered = catalogueSuggestions('pepper', { limit: 4 });
  const filtered = catalogueSuggestions('pepper', {
    limit: 4,
    excludeVarieties: [unfiltered[0]!.variety],
  });

  // Still four: the exclusion pulls a further match up rather than leaving a gap.
  assert.equal(filtered.length, 4);
  assert.ok(!filtered.some((suggestion) => suggestion.variety === unfiltered[0]!.variety));
});

test('exclusion is by plant name, not by exact string', () => {
  // She owns "Jalapeno" typed without the tilde; the catalogue entry is
  // "Jalapeño". Offering both would be offering her the same plant twice.
  const filtered = catalogueSuggestions('jalap', { excludeVarieties: ['Jalapeno'] });
  assert.ok(!filtered.some((suggestion) => suggestion.variety === 'Jalapeño'));
});

test('an empty query offers nothing from the catalogue', () => {
  assert.deepEqual(catalogueSuggestions(''), []);
  assert.deepEqual(catalogueSuggestions('   '), []);
});

test('the vault matches variety, brand and family alike', () => {
  assert.deepEqual(
    vaultSuggestions('cher', VAULT).map((suggestion) => suggestion.variety),
    ['Cherokee Purple', 'Cherry Tomato'],
  );
  // People do search by where they bought it.
  assert.deepEqual(
    vaultSuggestions('burpee', VAULT).map((suggestion) => suggestion.variety),
    ['Cherry Tomato'],
  );
  assert.deepEqual(
    vaultSuggestions('herb', VAULT).map((suggestion) => suggestion.variety),
    ['Genovese Basil'],
  );
});

test('a vault suggestion reports the category she actually filed, not the true one', () => {
  // Her cherry tomato is stored as a Leafy Green. The picker must show what is
  // really on the packet — correcting it here would hide the problem instead of
  // fixing it, and the fix belongs in the nudge she can accept or decline.
  const [suggestion] = vaultSuggestions('cherry tomato', VAULT);
  assert.equal(suggestion?.category, 'Leafy Green');
  assert.equal(suggestion?.source, 'vault');
  assert.equal(suggestion?.detail, 'Burpee · 2026');
});

test('an empty vault query returns the whole vault', () => {
  // Opening the picker with nothing typed should show her seeds, not a blank.
  assert.equal(vaultSuggestions('', VAULT).length, VAULT.length);
});

test('names starting with the query beat names merely containing it', () => {
  const seeds = [
    packet({ id: 'a', variety: 'Sweet Basil' }),
    packet({ id: 'b', variety: 'Basil' }),
  ];

  assert.deepEqual(
    vaultSuggestions('basil', seeds).map((suggestion) => suggestion.variety),
    ['Basil', 'Sweet Basil'],
  );
});

test('her vault is offered before the catalogue', () => {
  const suggestions = suggestVarieties('tomato', VAULT);

  assert.equal(suggestions[0]?.source, 'vault');
  assert.equal(suggestions[0]?.variety, 'Cherry Tomato');
  assert.ok(suggestions.some((suggestion) => suggestion.source === 'catalogue'));
  // Every vault hit precedes every catalogue hit.
  const firstCatalogue = suggestions.findIndex((suggestion) => suggestion.source === 'catalogue');
  assert.ok(suggestions.slice(0, firstCatalogue).every((suggestion) => suggestion.source === 'vault'));
});

test('a plant she already owns is never listed twice', () => {
  const seeds = [packet({ id: 'seed_jalapeno', variety: 'Jalapeno', category: 'Nightshade' })];
  const suggestions = suggestVarieties('jalapeno', seeds);

  // Hers, spelled her way, and only once — the accented catalogue entry is the
  // same plant and must not be offered alongside it.
  assert.equal(suggestions.filter((suggestion) => suggestion.source === 'catalogue').length, 0);
  assert.equal(suggestions[0]?.source, 'vault');
  assert.equal(suggestions[0]?.variety, 'Jalapeno');
});

test('the combined list honours its own limit', () => {
  assert.ok(suggestVarieties('tomato', VAULT, { limit: 2 }).length <= 2);
  assert.ok(suggestVarieties('pepper', VAULT, { limit: 5 }).length <= 5);
});

test('suggestion keys are unique, or React renders the wrong row', () => {
  const suggestions = suggestVarieties('tomato', VAULT);
  assert.equal(new Set(suggestions.map((suggestion) => suggestion.key)).size, suggestions.length);
});

test('a variety nobody has heard of suggests nothing at all', () => {
  assert.deepEqual(suggestVarieties('zzzz nonsense', VAULT), []);
});

test('arrow keys wrap the way every other combobox does', () => {
  // Nothing highlighted: down lands on the first, up on the last.
  assert.equal(moveHighlight(-1, 3, 1), 0);
  assert.equal(moveHighlight(-1, 3, -1), 2);

  assert.equal(moveHighlight(0, 3, 1), 1);
  assert.equal(moveHighlight(2, 3, 1), 0);
  assert.equal(moveHighlight(0, 3, -1), 2);

  // An empty list has nothing to highlight; returning 0 here would let Enter
  // pick an option that does not exist.
  assert.equal(moveHighlight(-1, 0, 1), -1);
  assert.equal(moveHighlight(4, 0, -1), -1);
});

/**
 * Suggestion plumbing shared by the three places she types a variety name.
 *
 * React components in this repo cannot be unit-tested — the client suite is
 * plain `node --test` with no DOM — so everything here that could plausibly be
 * wrong lives in pure functions with tests, and the components stay thin enough
 * to read.
 *
 * The one rule that matters across all three call sites: **her own seed vault
 * comes first**. Planting what you already own is the common case, and a
 * catalogue that buried her packets under a hundred varieties she has never
 * bought would be a downgrade.
 */
import type { PlantCatalogueEntry, SeedPacket } from '../types';
// Runtime values come from the package directly rather than through
// `../types`. The client suite is plain Node, which cannot resolve the
// extensionless relative specifiers Vite is happy with, so anything that
// survives type erasure has to be imported the way the tests can follow.
import { normalizePlantName, searchPlants } from '@hpt/shared';

/** One offered option, flattened so the components do not care where it came from. */
export interface PlantSuggestion {
  /** React key. Unique within a single suggestion list. */
  key: string;
  /** Written into the variety field when chosen. */
  variety: string;
  /** Crop family, filled in for her. */
  category: string;
  /** `vault` = a packet she owns. `catalogue` = the wider list. */
  source: 'vault' | 'catalogue';
  /** Second line: brand and year for a packet, nothing for a catalogue entry. */
  detail: string;
}

function toSuggestion(entry: PlantCatalogueEntry): PlantSuggestion {
  return {
    key: `catalogue:${entry.name}`,
    variety: entry.name,
    category: entry.category,
    source: 'catalogue',
    detail: '',
  };
}

function packetToSuggestion(packet: SeedPacket): PlantSuggestion {
  const detail = [packet.brand.trim(), packet.purchaseYear ? String(packet.purchaseYear) : '']
    .filter((part) => part !== '')
    .join(' · ');

  return {
    key: `vault:${packet.id}`,
    variety: packet.variety,
    category: packet.category,
    source: 'vault',
    detail,
  };
}

/**
 * Catalogue matches for a query, as suggestions.
 *
 * `excludeVarieties` drops anything already offered from her vault, so the same
 * plant never appears twice in one list.
 */
export function catalogueSuggestions(
  query: string,
  { limit = 8, excludeVarieties = [] }: { limit?: number; excludeVarieties?: readonly string[] } = {},
): PlantSuggestion[] {
  const excluded = new Set(
    excludeVarieties.map((variety) => normalizePlantName(variety)).filter((key) => key !== ''),
  );

  // Over-fetch so exclusions cannot leave the list short.
  return searchPlants(query, limit + excluded.size)
    .filter((entry) => !excluded.has(normalizePlantName(entry.name)))
    .slice(0, limit)
    .map(toSuggestion);
}

/**
 * Packets in her vault matching a query, best first.
 *
 * Matches the variety, the brand and the family, because "what did I buy from
 * Baker Creek" and "show me the brassicas" are both things people search for.
 * An empty query returns everything she owns: opening the picker with nothing
 * typed should show her vault, not a blank panel.
 */
export function vaultSuggestions(
  query: string,
  seeds: readonly SeedPacket[],
  { limit = Number.POSITIVE_INFINITY }: { limit?: number } = {},
): PlantSuggestion[] {
  const needle = query.trim().toLowerCase();
  const matches =
    needle === ''
      ? [...seeds]
      : seeds.filter(
          (packet) =>
            packet.variety.toLowerCase().includes(needle) ||
            packet.brand.toLowerCase().includes(needle) ||
            packet.category.toLowerCase().includes(needle),
        );

  return matches
    .slice()
    .sort((left, right) => {
      // Names that start with what she typed beat names that merely contain it.
      const leftStarts = left.variety.toLowerCase().startsWith(needle) ? 0 : 1;
      const rightStarts = right.variety.toLowerCase().startsWith(needle) ? 0 : 1;

      return leftStarts - rightStarts || left.variety.localeCompare(right.variety);
    })
    .slice(0, limit)
    .map(packetToSuggestion);
}

/**
 * The combined list behind the seed-vault and harvest fields: her vault first,
 * then the catalogue, capped as a whole.
 */
export function suggestVarieties(
  query: string,
  seeds: readonly SeedPacket[],
  { limit = 8 }: { limit?: number } = {},
): PlantSuggestion[] {
  const vault = vaultSuggestions(query, seeds, { limit });

  if (vault.length >= limit) return vault.slice(0, limit);

  const catalogue = catalogueSuggestions(query, {
    limit: limit - vault.length,
    excludeVarieties: vault.map((suggestion) => suggestion.variety),
  });

  return [...vault, ...catalogue];
}

/**
 * Arrow-key movement within a suggestion list.
 *
 * `-1` means "nothing highlighted", which is the state the field starts in and
 * returns to when the list changes under her. Arrowing down from there lands on
 * the first item; arrowing up lands on the last, which is how every native
 * combobox behaves. Movement wraps, and an empty list stays at `-1` rather than
 * producing an index nothing can render.
 */
export function moveHighlight(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;

  return (current + delta + count) % count;
}

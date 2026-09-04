import type { GardenBed, HarvestLog, SeedPacket } from '../types';

/** Builds an empty `rows` x `columns` grid, then applies the given plantings. */
function buildLayout(
  rows: number,
  columns: number,
  plantings: Record<string, string> = {},
): (string | null)[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => plantings[`${row},${column}`] ?? null),
  );
}

export const DEFAULT_SEEDS: SeedPacket[] = [
  {
    id: 'seed_cherokee_purple',
    category: 'Nightshade',
    variety: 'Cherokee Purple',
    brand: 'Baker Creek',
    purchaseYear: 2025,
    notes: 'Dusky heirloom slicer. Needs staking early — vines get heavy by mid-July.',
  },
  {
    id: 'seed_marketmore_76',
    category: 'Cucurbit',
    variety: 'Marketmore 76',
    brand: 'Johnny\u2019s Selected Seeds',
    purchaseYear: 2024,
    notes: 'Reliable slicing cucumber. Trellis along the north edge to avoid shading neighbors.',
  },
  {
    id: 'seed_lacinato_kale',
    category: 'Brassica',
    variety: 'Lacinato Kale',
    brand: 'Botanical Interests',
    purchaseYear: 2025,
    notes: 'Sweetens after the first frost. Direct sow a second round in late August.',
  },
  {
    id: 'seed_red_of_florence',
    category: 'Allium',
    variety: 'Red of Florence Onion',
    brand: 'Territorial Seed',
    purchaseYear: 2021,
    notes: 'Older packet — run a paper-towel germination test before committing a full row.',
  },
  {
    id: 'seed_provider_bush_bean',
    category: 'Legume',
    variety: 'Provider Bush Bean',
    brand: 'High Mowing',
    purchaseYear: 2026,
    notes: 'Earliest bean in the vault. Succession sow every two weeks through June.',
  },
  {
    id: 'seed_genovese_basil',
    category: 'Herb',
    variety: 'Genovese Basil',
    brand: 'Seed Savers Exchange',
    purchaseYear: 2025,
    notes: 'Pinch flower spikes weekly to keep the leaves tender.',
  },
];

export const DEFAULT_BEDS: GardenBed[] = [
  {
    id: 'bed_raised_north',
    name: 'Bed 1 - Raised',
    rows: 4,
    columns: 6,
    layout: buildLayout(4, 6, {
      '0,0': 'Cherokee Purple',
      '0,1': 'Cherokee Purple',
      '1,3': 'Genovese Basil',
      '2,5': 'Marketmore 76',
    }),
    lastYearCategory: 'Nightshade',
  },
  {
    id: 'bed_ground_south',
    name: 'Bed 2 - In Ground',
    rows: 3,
    columns: 5,
    layout: buildLayout(3, 5, {
      '0,2': 'Lacinato Kale',
      '2,0': 'Provider Bush Bean',
    }),
    lastYearCategory: 'Brassica',
  },
];

export const DEFAULT_HARVESTS: HarvestLog[] = [
  {
    id: 'harvest_2026_08_12_tomato',
    date: '2026-08-12',
    variety: 'Cherokee Purple',
    weightLbs: 3.4,
    count: 5,
  },
  {
    id: 'harvest_2026_08_18_cucumber',
    date: '2026-08-18',
    variety: 'Marketmore 76',
    weightLbs: 2.1,
    count: 4,
  },
  {
    id: 'harvest_2026_08_25_kale',
    date: '2026-08-25',
    variety: 'Lacinato Kale',
    weightLbs: 0.9,
    count: 12,
  },
  {
    id: 'harvest_2026_08_30_bean',
    date: '2026-08-30',
    variety: 'Provider Bush Bean',
    weightLbs: 1.6,
    count: 0,
  },
  {
    id: 'harvest_2026_09_02_tomato',
    date: '2026-09-02',
    variety: 'Cherokee Purple',
    weightLbs: 4.2,
    count: 7,
  },
];

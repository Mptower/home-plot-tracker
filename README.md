# home-plot-tracker

**The Home Plot Tracker** — a personalized home vegetable garden tracker.

A single-user, offline-first web app for planning garden beds, cataloging seed
packets and logging every harvest. There is no backend and no sign-in: all data
lives in your browser's `localStorage`.

## Tech stack

| Concern    | Choice                                       |
| ---------- | -------------------------------------------- |
| Build tool | Vite 6                                       |
| UI         | React 18 + TypeScript (strict)               |
| Styling    | Tailwind CSS v3 (PostCSS + Autoprefixer)     |
| Icons      | `lucide-react`                                |
| State      | Plain React hooks — no state library, no router |
| Storage    | `localStorage` via a typed `useLocalStorage` hook |

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check (tsc -b) + production bundle into dist/
npm run preview  # serve the production build
npm run lint     # ESLint
npm run typecheck
```

## Data model

All domain types live in [`src/types.ts`](src/types.ts).

```ts
interface SeedPacket {
  id: string;
  category: string;      // one of SEED_CATEGORIES
  variety: string;       // e.g. "Cherokee Purple"
  brand: string;
  purchaseYear: number;
  notes: string;
}

interface GardenBed {
  id: string;
  name: string;                 // e.g. "Bed 1 - Raised"
  rows: number;
  columns: number;
  layout: (string | null)[][];  // rows x columns; each cell is a variety name or null
  lastYearCategory: string;     // category grown here last season, for rotation checks
}

interface HarvestLog {
  id: string;
  date: string;          // ISO yyyy-mm-dd
  variety: string;
  weightLbs: number;
  count: number;
}

type ViewId = 'planner' | 'vault' | 'harvest';
```

`src/types.ts` also exports:

- `SEED_CATEGORIES: readonly string[]` — the canonical category list
  (`Nightshade`, `Cucurbit`, `Brassica`, `Allium`, `Legume`, `Root`,
  `Leafy Green`, `Herb`). Every category dropdown reads from this list.
- `STORAGE_KEYS` — the `localStorage` key map (see below).
- The prop contracts for each view: `SeedVaultViewProps`, `BedPlannerViewProps`,
  `HarvestLogViewProps` and `SidebarProps`.

## The three views

### 🗺️ Bed Planner

Each bed renders as a real grid of square buttons, sized from its `rows` and
`columns`. Click a square to assign a variety from the vault, or clear it.
Squares are tinted by the crop family of whatever is planted, so a bed is
readable at a glance, and a variety that is no longer in the vault degrades to a
neutral "Uncatalogued" square rather than breaking the grid.

**Crop rotation warnings.** Every bed remembers `lastYearCategory`. Whenever the
current layout holds anything from that same family, an amber banner names the
family dynamically — _"Crop Rotation Warning: Nightshades planted here last
year!"_ — and each offending square picks up an amber ring. The check runs over
committed state rather than the click that caused it, so the warning survives a
reload. It is advice, never a block: planting is always allowed. Dismissing it
hides that exact conflict set, and creating a new conflict brings it back.

### 🗃️ Seed Vault

A card grid of every packet with search and category filters. Each card
estimates viability from `purchaseYear`: 95% for a packet bought this season,
declining 6 points a year through a three-year shelf life and 12 points a year
after that, floored at 5%. Packets are labelled **Fresh** (0–1 years), **Aging**
(2–3 years) or **Replace** (more than 3 years). A stale packet gets a rose
accent, an explicit "sow extra thickly" callout and a place in the "need
replacing" count. The logic lives in [`src/lib/germination.ts`](src/lib/germination.ts)
and is pure, with the current year injectable for testing.

### ⚖️ Harvest Log

A split pane: a sticky quick-entry form on the left, the historical feed on the
right. The form keeps the date between submissions so a single picking session
is fast to record, and suggests varieties from the vault plus anything typed
before. The feed sorts newest first and groups entries under day headers with
per-day subtotals, above a season summary of total weight, items, days logged
and the top varieties by weight.

Dates are stored as ISO `yyyy-mm-dd` and parsed by splitting the parts into a
local `Date`. `new Date('2026-09-04')` would be read as UTC midnight and render
as the previous day in a US timezone, so that path is deliberately avoided.

## Category colour

[`src/lib/categoryTheme.ts`](src/lib/categoryTheme.ts) is the single source of
truth for crop-family colour, shared by the Seed Vault badges and the Bed
Planner squares, legend and picker so a family looks the same everywhere.

Three hues are deliberately excluded from that palette because they carry
meaning elsewhere and would be ambiguous next to a category: **emerald**
(primary chrome and a bed square's active/hover state), **amber** (rotation
warnings) and **rose** (a stale packet).

Class strings are written out in full. Tailwind scans source text literally, so
a constructed name like `` `bg-${hue}-100` `` never reaches the stylesheet and
the colour would vanish from a production build.

## Storage keys

`App` owns all persisted state and writes it under these namespaced keys:

| Key            | Contents          |
| -------------- | ----------------- |
| `hpt.seeds`    | `SeedPacket[]`    |
| `hpt.beds`     | `GardenBed[]`     |
| `hpt.harvests` | `HarvestLog[]`    |

Reads and writes go through [`useLocalStorage`](src/hooks/useLocalStorage.ts),
which parses lazily, falls back to the supplied initial value on missing or
corrupt data, and swallows quota errors so a full disk never crashes the app.
The starter dataset used as that fallback lives in
[`src/lib/seedData.ts`](src/lib/seedData.ts).

`activeView` is deliberately **not** persisted — the app always opens on the
Bed Planner.

## Architecture

`App` holds every piece of state at the top level and passes it down as props;
the views are presentational and mutate through the setters they receive.

```
App
├── Sidebar            { activeView, onChange }
├── BedPlannerView     { beds, setBeds, seeds }
├── SeedVaultView      { seeds, setSeeds }
└── HarvestLogView     { harvests, setHarvests, seeds }
```

Shared building blocks:

- `src/components/ViewHeader.tsx` — icon + title + description section header.
- `src/components/ViewSummaryCard.tsx` — card with a headline and stat tiles.
- `src/lib/id.ts` — `createId(prefix?)`, the single source of ids for new
  records. Use it instead of array indices for React keys.

### Project layout

```
src/
├── App.tsx                       app shell, owns all state
├── main.tsx                      React entry point
├── index.css                     Tailwind entry + base layer
├── types.ts                      domain types, prop contracts, constants
├── hooks/useLocalStorage.ts      typed localStorage-backed state
├── lib/
│   ├── id.ts                     createId helper
│   ├── seedData.ts               DEFAULT_SEEDS / DEFAULT_BEDS / DEFAULT_HARVESTS
│   ├── categoryTheme.ts          shared crop-family colour palette
│   ├── germination.ts            seed-age and viability estimates
│   ├── rotation.ts               layout edits + crop-rotation conflicts
│   └── harvest.ts                day grouping, totals, local date parsing
└── components/
    ├── Sidebar.tsx
    ├── BedPlannerView.tsx        + bed-planner/
    ├── SeedVaultView.tsx         + seed-vault/
    ├── HarvestLogView.tsx        + harvest-log/
    ├── ViewHeader.tsx
    └── ViewSummaryCard.tsx
```

## Design language

Nature-inspired and deliberately calm, built entirely from Tailwind's stock
scales so new screens match without extra configuration:

- **Emerald** for primary actions and the active navigation state.
- **Amber** for accents and highlights.
- **Stone** for backgrounds, borders and text.
- Soft stone page background, white `rounded-2xl` cards with
  `border-stone-200` and light shadows, generous padding, and a consistent
  `focus-visible` emerald ring for keyboard users.

The sidebar is full height and sticky; below the `md` breakpoint it collapses
to an icon rail.

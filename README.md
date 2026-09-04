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
├── lib/id.ts                     createId helper
├── lib/seedData.ts               DEFAULT_SEEDS / DEFAULT_BEDS / DEFAULT_HARVESTS
└── components/
    ├── Sidebar.tsx
    ├── BedPlannerView.tsx
    ├── SeedVaultView.tsx
    ├── HarvestLogView.tsx
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

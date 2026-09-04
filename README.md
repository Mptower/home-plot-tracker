# home-plot-tracker

**The Home Plot Tracker** — a personalized home vegetable garden tracker.

A single-user web app for planning garden beds, cataloging seed packets and
logging every harvest.

The app began as a pure client-side SPA that kept everything in the browser's
`localStorage`. That is per-browser-profile: a phone in the garden and a laptop
indoors are two separate datastores that silently diverge. It is being moved to
a small self-hosted server so there is one source of truth.

It is deployed as a **Home Assistant add-on behind HA ingress**, which
authenticates every request against the user's Home Assistant session. That is
why the app has no login of its own, and why both halves are careful to work
under an arbitrary URL prefix.

This repo is mid-migration. **The server and its API exist and are complete
(phase 1); the client still reads and writes `localStorage` until phase 3
rewires it.** See [Migration phases](#migration-phases).

## Repository layout

An npm workspace with three packages:

```
shared/    domain types shared by both sides   (@hpt/shared)
client/    the Vite + React SPA                (@hpt/client)
server/    the Express 5 + SQLite API          (@hpt/server)
```

`shared/` is the contract. It holds `SeedPacket`, `GardenBed`, `HarvestLog`,
`ViewId`, `SEED_CATEGORIES` and `STORAGE_KEYS`, so the server validates against
exactly the shapes the client renders. It builds to `dist/` with declarations,
which is why every root script builds it first.

React-specific prop contracts (`SeedVaultViewProps` and friends) stay in
[`client/src/types.ts`](client/src/types.ts), which re-exports the shared types
so no view component needed an import change.

## Tech stack

| Concern     | Choice                                            |
| ----------- | ------------------------------------------------- |
| Build tool  | Vite 6                                            |
| UI          | React 18 + TypeScript (strict)                    |
| Styling     | Tailwind CSS v3 (PostCSS + Autoprefixer)          |
| Icons       | `lucide-react`                                    |
| State       | Plain React hooks — no state library, no router   |
| Server      | Node 22 LTS + Express 5, TypeScript, ESM          |
| Database    | SQLite via the built-in `node:sqlite` module      |
| Tests       | `node:test` — built in, no test framework needed  |

Two deliberate choices worth calling out:

- **`node:sqlite`, not `better-sqlite3`.** The target is a small self-hosted
  box. A native module means that box needs a C++ build toolchain, and every
  Node upgrade risks an `ERR_DLOPEN_FAILED` until it is rebuilt. The built-in
  module has neither problem. It is marked experimental, so Node prints a
  warning we suppress explicitly rather than silently.
- **`node:test`, not Vitest or Jest.** The server suite needs a runner and
  assertions, both of which ship with Node.

## Getting started

```bash
npm ci
npm run dev        # Vite on :5173 + API on :8080, proxied
```

`npm run dev` runs both processes. Vite proxies `/api` to the Node server, so
the browser only ever talks to one origin and there is no CORS configuration
anywhere in the codebase.

From the repository root:

| Script              | Does                                                |
| ------------------- | --------------------------------------------------- |
| `npm run dev`       | client + server in watch mode                       |
| `npm run build`     | builds all three packages                           |
| `npm run typecheck` | `tsc --noEmit` across all three                     |
| `npm run lint`      | ESLint across all three                             |
| `npm test`          | the server test suite                               |
| `npm start`         | runs the built server, serving the built client     |

Every one of these builds `shared/` first, because the other two packages
resolve it through its emitted declarations.

The server runs TypeScript directly in development and under test using Node's
`--experimental-strip-types`, so there is no build step in the edit loop. The
production build still goes through `tsc`.

## The API

Three collections, each with exactly two operations:

| Method | Path                    | Does                                    |
| ------ | ----------------------- | --------------------------------------- |
| `GET`  | `/api/health`           | liveness probe for systemd / monitoring |
| `GET`  | `/api/seeds`            | the full `SeedPacket[]`                 |
| `PUT`  | `/api/seeds`            | replaces it                             |
| `GET`  | `/api/beds`             | the full `GardenBed[]`                  |
| `PUT`  | `/api/beds`             | replaces it                             |
| `GET`  | `/api/harvests`         | the full `HarvestLog[]`                 |
| `PUT`  | `/api/harvests`         | replaces it                             |
| `POST` | `/api/import`           | replaces all three at once              |

### Why collection-level, and not per-item CRUD

Because it is the shape the app already has. Every view is handed
`(data, setData)` and re-renders from the whole array:

```
BedPlannerView     { beds, setBeds, seeds }
SeedVaultView      { seeds, setSeeds }
HarvestLogView     { harvests, setHarvests, seeds }
```

`GET` is the read half of that pair and `PUT` is the write half, so phase 3
replaces the `useLocalStorage` hook with a fetching one and no view component
changes at all.

Per-item CRUD would buy nothing here and cost plenty: ids threaded through every
call site, optimistic update and rollback in the UI, and a merge strategy for
concurrent edits. This is one household with a few dozen rows. Whole-collection
replace is a few kilobytes and is trivially correct.

Each `PUT` runs inside a transaction (`BEGIN IMMEDIATE`, delete, insert,
`COMMIT`), so a payload that fails partway through leaves the previous
collection completely intact rather than half-replaced. The response is read
back out of the database rather than echoed from the request, so what you get
back is what was actually stored.

Array order is preserved: each row carries a `position` column and reads are
`ORDER BY position`.

### Validation

Every write is validated server-side, on the assumption that the client is
lying. Malformed payloads get a `400` listing every problem found, each with a
path:

```json
{
  "error": "The seeds payload was rejected.",
  "issues": [
    { "path": "body[0].purchaseYear", "message": "expected an integer, received string" },
    { "path": "body[1].sneaky", "message": "unknown field" }
  ]
}
```

Rejected: unknown fields, missing fields, wrong types, non-finite numbers
(`NaN`, `Infinity`), negative weights and counts, duplicate ids, dates that are
not `yyyy-mm-dd`, dates that match the pattern but do not exist (`2026-02-30`),
and a `rows`/`columns` pair that disagrees with the actual `layout` dimensions.

The validator builds a fresh object out of individually validated values, so the
parsed request object never reaches the database. Smuggling an extra key through
is structurally impossible rather than merely checked for.

Validation is deliberately slightly looser than the UI in two places. `category`
is not restricted to `SEED_CATEGORIES`, so an export made before or after a
category list change still imports. Bed dimensions are capped at 64 rather than
the UI's 12, so a bed built by hand is not rejected. Both are documented at the
top of [`server/src/validation.ts`](server/src/validation.ts).

### Importing existing browser data

`POST /api/import` takes `{ seeds, beds, harvests }` — the exact shape of the
three `localStorage` values — validates all three the same way, and **replaces**
everything in a single transaction. It never merges. The response says so
explicitly, and reports what it destroyed:

```json
{
  "mode": "replace",
  "message": "Import replaced all existing data. 3 seeds, 1 bed and 2 harvests were deleted and 12 seeds, 4 beds and 30 harvests were stored.",
  "replaced": { "seeds": 3, "beds": 1, "harvests": 2 },
  "imported": { "seeds": 12, "beds": 4, "harvests": 30 }
}
```

All three keys are required. Omitting one is an error rather than an implicit
"wipe that collection", because the destructive reading of an ambiguous payload
is the one you cannot undo.

## Database

SQLite, through `node:sqlite`. Opened with `journal_mode = WAL` (so a read
during a write does not block), `foreign_keys = ON` and a `busy_timeout`.

`GardenBed.layout` is stored as JSON text. It is only ever read and written
whole, so a `bed_cells` table would add a join and a fan-out for no benefit.

### Migrations

A numbered list in [`server/src/db/migrations.ts`](server/src/db/migrations.ts)
and a ~40-line runner. On boot the runner reads the `schema_migrations` ledger,
applies everything with a higher version in order, each in its own transaction,
and records it. Running it against an up-to-date database is a no-op, so boot is
idempotent.

Adding one means appending to the array — never editing an applied entry, since
the ledger records versions rather than checksums and an edit would silently
never re-run. The rules are written at the top of that file.

## Configuration

All server configuration is environment variables with working defaults, so it
runs with none set. See [`.env.example`](.env.example).

| Variable        | Default          | Does                                            |
| --------------- | ---------------- | ----------------------------------------------- |
| `PORT`          | `8080`           | port to listen on                               |
| `HOST`          | `0.0.0.0`        | interface to bind                               |
| `DATA_DIR`      | `data`           | everything the server persists; created if missing |
| `DATABASE_PATH` | `$DATA_DIR/home-plot-tracker.db` | overrides the file outright     |
| `CLIENT_DIR`    | `../client/dist` | built client to serve                           |
| `SERVE_CLIENT`  | `true`           | set `false` to run API-only                     |
| `BASE_PATH`     | `/`              | path prefix to mount everything under           |
| `LOG_REQUESTS`  | `true`           | one line per request                            |
| `NODE_ENV`      | `production`     | anything else disables long-lived asset caching |

`DATA_DIR` is the important one. As a Home Assistant add-on it is set to
`/data`, the persistent volume HA's own backups snapshot — put the database
anywhere else and the backups quietly contain no garden. Locally it defaults to
`./data`.

Relative paths resolve against the working directory, so they mean the same
thing whether you run from source or from `dist/`. `npm start` runs the server
with `server/` as its working directory, which is why the defaults reach
`server/data/` and back out to `client/dist`. Set them explicitly in a
deployment rather than relying on where you happened to launch from.

## Serving the client, under any path

In production the Node server serves `CLIENT_DIR` itself; Vite is a development
tool only. Hashed files under `assets/` are sent `immutable` with a one-year
max-age, `index.html` is sent `no-cache`, and anything else gets a short
revalidated cache. Any request that is not a file and not `/api/*` falls back to
`index.html` so deep links work.

The app is **base-path agnostic**: it works mounted at `/`, at `/garden`, or
under a generated prefix it has never heard of.

Ingress strips its prefix before proxying, so this process normally sees plain
`/` and `/api/...`. The side that has to be careful is the **client**, whose
asset and API URLs are what the browser resolves against the prefixed address
bar.

- Vite builds with `base: './'`, so `index.html` references its assets
  relatively. This also rewrites the absolute `url("/botanical.svg")` in
  `index.css` to `url(../botanical.svg)`; without it the page background 404s
  under a prefix.
- The client builds its API URLs relative to `document.baseURI`
  ([`client/src/lib/api.ts`](client/src/lib/api.ts)). There is no absolute
  `/api/...` string anywhere the browser will consume.
- The server injects a `<base href>` into `index.html` on the way out. Relative
  URLs resolve correctly from the app root on their own, but not from a deeper
  path, where `./assets/index.js` would resolve against the wrong directory.
- If an `X-Ingress-Path` header is present it sets that `<base href>`, per
  request. Ingress generates a new prefix per session, so it cannot come from an
  env var. The header is validated against a strict pattern and HTML-escaped
  before it goes anywhere near the document.
- `BASE_PATH` mounts the API and the static handler under a fixed prefix. Not
  needed for ingress; kept for running behind a plain reverse proxy that does
  not strip.

## Deploying

```bash
npm ci
npm run build
DATA_DIR=/data NODE_ENV=production npm start
```

One Node process serves both the API and the client — the Home Assistant base
image's busybox has no `httpd` applet, so there is no separate static server to
lean on, which was the plan anyway.

The only state on disk is `DATA_DIR`, holding the database plus its `-wal` and
`-shm` files. On an add-on that is `/data`, which is what HA's built-in backups
snapshot, so backups need no extra configuration. Elsewhere, back up all three
files, or stop the process first so the WAL is checkpointed into the main file —
shutdown on `SIGTERM`/`SIGINT` closes the database cleanly, which does exactly
that.

There is nothing to compile natively and no `node_modules` rebuild after a Node
upgrade, which is the whole reason for `node:sqlite`. Target architecture is
amd64.

## Tests

```bash
npm test
```

`node:test`, run straight from TypeScript. Each test starts a real server on a
real ephemeral port against a temporary database file, so the suite exercises
HTTP and SQLite rather than mocks of them. Coverage:

| File                    | Covers                                                     |
| ----------------------- | ---------------------------------------------------------- |
| `migrations.test.ts`    | applying from empty, re-running as a no-op, WAL, pragmas    |
| `config.test.ts`        | `DATA_DIR` resolution, creation on boot, `BASE_PATH` parsing |
| `api.test.ts`           | each collection round-tripping, order, health, 404s         |
| `validation.test.ts`    | every rejection rule, and the error body shape              |
| `import.test.ts`        | replace semantics, reported counts, partial payloads        |
| `transactions.test.ts`  | a failed write leaving the previous collection intact       |
| `static.test.ts`        | cache headers, SPA fallback, mounting under a prefix        |

## Migration phases

| Phase | Scope                                                     | Status        |
| ----- | --------------------------------------------------------- | ------------- |
| 1     | workspaces, server, API, tests                            | **done**      |
| 2     | auth and sessions                                         | **cancelled** |
| 3     | client reads and writes the API instead of `localStorage` | next          |
| 4     | packaging as a Home Assistant add-on                      | later         |

**There is no authentication and there will not be.** The app is deployed as a
Home Assistant add-on behind HA ingress, which authenticates every request
against the user's Home Assistant session before it reaches this process. A
second login would be pure friction, so there is no password hashing, no
sessions, no cookies, no users table and no middleware slot waiting for one.
Nothing in the code assumes a user exists: no `req.user`, no ownership columns,
no per-user scoping.

If this is ever exposed outside Home Assistant, access control has to be added
deliberately at that point, and the absence of a half-built auth layer is a
feature — there is nothing to mistake for protection.

## Data model

All domain types live in [`shared/src/index.ts`](shared/src/index.ts).

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

`shared` also exports:

- `SEED_CATEGORIES: readonly string[]` — the canonical category list
  (`Nightshade`, `Cucurbit`, `Brassica`, `Allium`, `Legume`, `Root`,
  `Leafy Green`, `Herb`). Every category dropdown reads from this list.
- `STORAGE_KEYS` — the `localStorage` key map (see below).
- `COLLECTION_NAMES` and `GardenSnapshot`, used by the API and the import
  endpoint.

[`client/src/types.ts`](client/src/types.ts) re-exports all of the above and
adds the prop contracts for each view: `SeedVaultViewProps`,
`BedPlannerViewProps`, `HarvestLogViewProps` and `SidebarProps`.

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
replacing" count. and is pure, with the current year injectable for testing. The logic lives in
[`client/src/lib/germination.ts`](client/src/lib/germination.ts)
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

[`client/src/lib/categoryTheme.ts`](client/src/lib/categoryTheme.ts) is the
single source of truth for crop-family colour, shared by the Seed Vault badges
and the Bed Planner squares, legend and picker so a family looks the same
everywhere.

Three hues are deliberately excluded from that palette because they carry
meaning elsewhere and would be ambiguous next to a category: **emerald**
(primary chrome and a bed square's active/hover state), **amber** (rotation
warnings) and **rose** (a stale packet).

Class strings are written out in full. Tailwind scans source text literally, so
a constructed name like `` `bg-${hue}-100` `` never reaches the stylesheet and
the colour would vanish from a production build.

## Storage keys

`App` still owns all persisted state and writes it under these namespaced keys.
Phase 3 replaces this layer with the API; the keys are what
`POST /api/import` exists to ingest.

| Key            | Contents          |
| -------------- | ----------------- |
| `hpt.seeds`    | `SeedPacket[]`    |
| `hpt.beds`     | `GardenBed[]`     |
| `hpt.harvests` | `HarvestLog[]`    |

Reads and writes go through
[`useLocalStorage`](client/src/hooks/useLocalStorage.ts), which parses lazily,
falls back to the supplied initial value on missing or corrupt data, and
swallows quota errors so a full disk never crashes the app. The starter dataset
used as that fallback lives in
[`client/src/lib/seedData.ts`](client/src/lib/seedData.ts).

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

- `client/src/components/ViewHeader.tsx` — icon + title + description section
  header.
- `client/src/components/ViewSummaryCard.tsx` — card with a headline and stat
  tiles.
- `client/src/lib/id.ts` — `createId(prefix?)`, the single source of ids for new
  records. Use it instead of array indices for React keys.
- `client/src/lib/api.ts` — resolves API URLs against the document base. Use it
  for every request rather than writing a path by hand.

### Project layout

```
shared/src/index.ts               domain types + constants, the contract

client/
├── index.html
├── vite.config.ts                base: './', proxies /api in dev
└── src/
    ├── App.tsx                   app shell, owns all state
    ├── main.tsx                  React entry point
    ├── index.css                 Tailwind entry + base layer
    ├── types.ts                  re-exports @hpt/shared + view prop contracts
    ├── hooks/useLocalStorage.ts  typed localStorage-backed state
    ├── lib/
    │   ├── api.ts                base-path-aware API URLs
    │   ├── id.ts                 createId helper
    │   ├── seedData.ts           DEFAULT_SEEDS / DEFAULT_BEDS / DEFAULT_HARVESTS
    │   ├── categoryTheme.ts      shared crop-family colour palette
    │   ├── germination.ts        seed-age and viability estimates
    │   ├── rotation.ts           layout edits + crop-rotation conflicts
    │   └── harvest.ts            day grouping, totals, local date parsing
    └── components/
        ├── Sidebar.tsx
        ├── BedPlannerView.tsx    + bed-planner/
        ├── SeedVaultView.tsx     + seed-vault/
        ├── HarvestLogView.tsx    + harvest-log/
        ├── ViewHeader.tsx
        └── ViewSummaryCard.tsx

server/
├── src/
│   ├── index.ts                  bootstrap: migrate, listen, shut down cleanly
│   ├── app.ts                    builds the Express app (the test seam)
│   ├── config.ts                 environment variables and defaults
│   ├── validation.ts             every write is checked here
│   ├── static.ts                 client hosting, SPA fallback, base path
│   ├── http.ts                   small response helpers
│   ├── routes/api.ts             the eight endpoints
│   └── db/
│       ├── open.ts               open, pragmas, withTransaction
│       ├── migrations.ts         the numbered list
│       ├── migrate.ts            the runner
│       └── collections.ts        list/replace for each collection
└── test/                         node:test suites
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

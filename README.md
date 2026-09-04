# home-plot-tracker

**The Home Plot Tracker** — a personalized home vegetable garden tracker.

A single-user web app for planning garden beds, cataloging seed packets and
logging every harvest.

The app began as a pure client-side SPA that kept everything in the browser's
`localStorage`. That is per-browser-profile: a phone in the garden and a laptop
indoors are two separate datastores that silently diverge. It now runs against a
small self-hosted server, so there is one source of truth.

It is deployed as a **Home Assistant add-on behind HA ingress**, which
authenticates every request against the user's Home Assistant session. That is
why the app has no login of its own, and why both halves are careful to work
under an arbitrary URL prefix.

**The server and its API are complete (phase 1), the client reads and writes
them rather than `localStorage` (phase 3), and the Home Assistant add-on that
ships them is here too (phase 4).** A browser that still holds the old data is
offered a one-time copy across, and never has it deleted. See
[Migration phases](#migration-phases).

## Repository layout

An npm workspace with three packages, plus the add-on that ships them:

```
shared/    domain types shared by both sides   (@hpt/shared)
client/    the Vite + React SPA                (@hpt/client)
server/    the Express 5 + SQLite API          (@hpt/server)
addon/     the Home Assistant add-on
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
| `npm run build:addon` | builds, then stages the result into `addon/`      |
| `npm run check:addon` | verifies the staged copy matches the sources      |
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
| `GET`  | `/api/seeds`            | the full `SeedPacket[]`, plus an `ETag` |
| `PUT`  | `/api/seeds`            | replaces it; requires `If-Match`        |
| `GET`  | `/api/beds`             | the full `GardenBed[]`, plus an `ETag`  |
| `PUT`  | `/api/beds`             | replaces it; requires `If-Match`        |
| `GET`  | `/api/harvests`         | the full `HarvestLog[]`, plus an `ETag` |
| `PUT`  | `/api/harvests`         | replaces it; requires `If-Match`        |
| `POST` | `/api/import`           | first-run migration into an empty garden |

Request and response bodies for the collections are bare JSON arrays. The
version travels in headers, not in an envelope, so the body stays exactly the
shape the views already pass around.

### Why collection-level, and not per-item CRUD

Because it is the shape the app already has. Every view is handed
`(data, setData)` and re-renders from the whole array:

```
BedPlannerView     { beds, setBeds, seeds }
SeedVaultView      { seeds, setSeeds }
HarvestLogView     { harvests, setHarvests, seeds }
```

`GET` is the read half of that pair and `PUT` is the write half, so phase 3
replaced the `useLocalStorage` hook with a fetching one
([`useGardenData`](client/src/hooks/useGardenData.ts)) and no view component
changed at all.

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

### Concurrent edits

Replacing a whole collection has one sharp edge, and it is the reason this app
left `localStorage` in the first place. Two devices are in use — a phone in the
garden and a laptop indoors:

```
09:00  laptop   GET /api/harvests   -> []
14:00  phone    PUT /api/harvests   -> two afternoon harvests
14:05  laptop   PUT /api/harvests   -> saves the empty list it loaded at 09:00
```

Without a check, that last write silently erases the afternoon. No error, no
trace, and nothing to recover from. So each collection carries a version, and a
write has to say which version it is editing.

**Reading.** `GET` returns the version as an `ETag`:

```
GET /api/harvests
200 OK
ETag: "7"

[ ... ]
```

The token is opaque — quotes included. Echo it back verbatim; don't parse it.

**Writing.** `PUT` requires `If-Match`. On success you get the new version back,
so a client can keep writing without a follow-up `GET`:

```
PUT /api/harvests
If-Match: "7"

200 OK
ETag: "8"
```

**Losing.** If the stored version has moved on, the write is refused with `409`
and nothing is saved. The response carries the current version *and* the current
collection, so the client reconciles and retries in one round trip instead of
two:

```json
{
  "error": "version_mismatch",
  "message": "The harvests collection changed since you loaded it, so saving would have discarded that change. Nothing was saved.",
  "currentVersion": "\"8\"",
  "current": [ "...the full current collection..." ],
  "collection": "harvests",
  "expectedVersion": "\"7\""
}
```

`currentVersion` is byte-identical to the `ETag` header, so it can go straight
back into `If-Match` on the retry.

**Not asking.** A `PUT` with no `If-Match` is refused with `428 Precondition
Required` and the same body shape. It is never applied. An unversioned write is
indistinguishable from the stale-tab overwrite above, so treating it as
"probably fine" would leave the hole open for exactly the client most likely to
have the bug. `If-Match: *` is refused too: a collection always exists, so `*`
would match unconditionally and protect nothing.

Three details that matter:

- **The check and the write share one transaction.** Reading the version in one
  statement and writing in another would leave a window where two requests both
  read version 7, both judge themselves current, and both write.
- **Versions are per collection.** Editing seeds does not invalidate an
  in-flight beds write.
- **They live in SQLite** (`collection_versions`), so they survive a restart. An
  in-memory counter would reset to 0 on every reboot and hand every stale tab a
  precondition that matches.

A failed write never advances the version — a version that moved without its
data would be worse than none, because it would then reject the client's
perfectly good retry.

### Errors

Every failure, from any endpoint, has the same shape: `error` is a stable
machine-readable code and `message` is prose for a human. Branch on `error`;
show `message`. Extra fields hang off the same object.

| `error`                  | Status | When                                          |
| ------------------------ | ------ | --------------------------------------------- |
| `validation_failed`      | 400    | payload rejected; adds `issues`               |
| `malformed_json`         | 400    | body was not parseable JSON                   |
| `unsupported_media_type` | 415    | `Content-Type` was not `application/json`     |
| `payload_too_large`      | 413    | body above the 4 MB limit                     |
| `not_found`              | 404    | no such route                                 |
| `precondition_required`  | 428    | `PUT` with no usable `If-Match`               |
| `version_mismatch`       | 409    | `PUT` from a stale version                    |
| `import_not_empty`       | 409    | `POST /api/import` into a garden with data    |
| `internal_error`         | 500    | anything unhandled                            |

### Validation

Every write is validated server-side, on the assumption that the client is
lying. Malformed payloads get a `400` listing every problem found, each with a
path:

```json
{
  "error": "validation_failed",
  "message": "The submitted data was rejected (2 problems). Nothing was saved.",
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

Validation runs *before* the version check, so a payload that was never going to
be accepted gets a `400` explaining why, rather than a `428` sending the client
off to refetch and retry it. That is [RFC 9110
§13.2.1](https://www.rfc-editor.org/rfc/rfc9110#section-13.2.1).

Validation is deliberately slightly looser than the UI in two places. `category`
is not restricted to `SEED_CATEGORIES`, so an export made before or after a
category list change still imports. Bed dimensions are capped at 64 rather than
the UI's 12, so a bed built by hand is not rejected. Both are documented at the
top of [`server/src/validation.ts`](server/src/validation.ts).

### Importing existing browser data

`POST /api/import` takes `{ seeds, beds, harvests }` — the exact shape of the
three `localStorage` values — validates all three the same way, and stores them
in a single transaction. It never merges.

**It only runs into an empty garden.** If any collection already holds rows the
import is refused with `409 import_not_empty` and nothing is saved. There is no
`force` flag.

That is the one guard import needs, and it is deliberately not a version check:
first-run migration happens before the client has ever read a version, so there
is nothing it could put in `If-Match`. Emptiness answers the same question —
"am I about to destroy something?" — without requiring a version the client
cannot have. And unlike a version check it cannot be satisfied by simply
refetching, which is the point: a stale browser snapshot must not be able to
replace a real season's records just because it asked twice.

On success every version is bumped from `0` to `1`, so a tab that read the empty
garden before the import cannot then write over it:

```json
{
  "mode": "replace",
  "message": "Imported the snapshot into an empty garden...",
  "imported": { "seeds": 12, "beds": 4, "harvests": 30 },
  "versions": { "seeds": "\"1\"", "beds": "\"1\"", "harvests": "\"1\"" }
}
```

Those versions are usable `If-Match` values immediately.

If the garden is not empty — she added a bed while looking around before
migrating her other device — the way in is a normal versioned `PUT` per
collection: `GET` it, fold the browser records into what is there, and save.
Nothing is destroyed and the stray bed survives. The `409` message says so.

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

Two so far: `1` builds `seeds`, `beds` and `harvests`; `2` adds
`collection_versions`, the counter behind the `ETag` on every collection.

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

### As a Home Assistant add-on

This repository is also a Home Assistant **add-on repository**. In Home
Assistant:

1. **Settings → Add-ons → Add-on Store**.
2. **⋮ → Repositories**, add `https://github.com/Mptower/home-plot-tracker`,
   then **Close**.
3. Install **The Home Plot Tracker** from the store section that appears.
   Supervisor builds the image on your machine, which takes a minute or two.
4. Turn on **Show in sidebar**, then **Start**. A **Garden** entry appears in
   the sidebar.

There is nothing to configure. See [`addon/DOCS.md`](addon/DOCS.md) for the
user-facing documentation Home Assistant shows on the add-on's Documentation
tab.

### How the add-on is put together

```
repository.yaml            makes this repo an add-on repository
addon/
├── config.yaml            slug, version, ingress, sidebar panel
├── Dockerfile             the image Supervisor builds
├── icon.png, logo.png     store artwork
├── DOCS.md, CHANGELOG.md  what Home Assistant renders in the add-on UI
└── rootfs/
    ├── run.sh             the entrypoint, LF endings, execs Node as PID 1
    └── app/               generated — the staged build, see below
```

Supervisor builds an add-on with **the add-on directory as the Docker build
context**, so `addon/Dockerfile` cannot reach up into `server/` or `client/`.
Everything the image needs has to be inside `addon/` first, and it has to be
committed, because Supervisor clones this repository and builds it as-is — there
is no CI step in between.

[`scripts/build-addon.mjs`](scripts/build-addon.mjs) does that staging:

```bash
npm run build:addon    # build all three packages, then stage into addon/rootfs/app
npm run check:addon    # CI: is the staged copy still in sync?
```

It writes the compiled server (minus source maps), the built client, and a
production-only `package.json`/`package-lock.json` whose single dependency is
Express — `node:sqlite` is part of Node, and `@hpt/shared` is imported only as
types, which the compiler erases. The image then runs `npm ci --omit=dev`, and
nothing in it compiles.

Four things about that image are load-bearing, and each of them cost a debugging
session to find:

- **No `build.yaml`.** Supervisor 2026.08 deprecated it — *"Move build
  parameters into the Dockerfile directly"* — and `ARG BUILD_FROM` without one
  fails with `base name ($BUILD_FROM) should not be blank`. The base image is
  named literally instead.
- **`FROM node:22-alpine`.** It is a multi-arch manifest list, so naming it
  literally still builds on both `amd64` and `aarch64`; the daemon resolves the
  right digest for the architecture it is building for. That is what buys the
  second architecture without a per-arch base or a build argument. It also pins
  Node ≥ 22.6, which `node:sqlite` requires.
- **One Node process serves everything.** The Home Assistant base image's
  busybox has no `httpd` applet, so there is no static file server to lean on —
  which was the plan anyway.
- **`run.sh` must keep LF line endings.** With CRLF the kernel looks for an
  interpreter called `/bin/sh\r` and the container dies with a bare "no such
  file or directory" that names neither the script nor the shell.
  [`.gitattributes`](.gitattributes) forces LF, and `build:addon` refuses to
  stage a file with a carriage return in it.

The entrypoint sets `DATA_DIR=/data` — the volume Home Assistant's own backups
snapshot, so the database is in every backup with no extra configuration — and
leaves `BASE_PATH` at the root, because ingress strips its prefix before
proxying. The add-on declares **no `ports:`**, so the only route in is through
ingress, which has already authenticated the user's Home Assistant session.

### Standalone

```bash
npm ci
npm run build
DATA_DIR=/data NODE_ENV=production npm start
```

One Node process serves both the API and the client.

The only state on disk is `DATA_DIR`, holding the database plus its `-wal` and
`-shm` files. On an add-on that is `/data`, which is what HA's built-in backups
snapshot, so backups need no extra configuration. Elsewhere, back up all three
files, or stop the process first so the WAL is checkpointed into the main file —
shutdown on `SIGTERM`/`SIGINT` closes the database cleanly, which does exactly
that.

There is nothing to compile natively and no `node_modules` rebuild after a Node
upgrade, which is the whole reason for `node:sqlite`. The add-on builds for
`amd64` and `aarch64`.

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
| `api.test.ts`           | each collection round-tripping, order, health, 404s, error shape |
| `validation.test.ts`    | every rejection rule, and the error body shape              |
| `concurrency.test.ts`   | ETags, `If-Match`, 409/428, one winner per race, restart    |
| `import.test.ts`        | the emptiness guard, reported counts, partial payloads      |
| `transactions.test.ts`  | a failed write leaving the previous collection intact       |
| `static.test.ts`        | cache headers, SPA fallback, mounting under a prefix        |

## Migration phases

| Phase | Scope                                                     | Status        |
| ----- | --------------------------------------------------------- | ------------- |
| 1     | workspaces, server, API, tests                            | **done**      |
| 2     | auth and sessions                                         | **cancelled** |
| 3     | client reads and writes the API instead of `localStorage` | **done**      |
| 4     | packaging as a Home Assistant add-on                      | **done**      |

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

## Storage keys and the one-time migration

The API is the only place the app persists anything. These keys are what the
pre-server builds wrote, and what `POST /api/import` exists to ingest:

| Key                 | Contents                            |
| ------------------- | ----------------------------------- |
| `hpt.seeds`         | `SeedPacket[]`                      |
| `hpt.beds`          | `GardenBed[]`                       |
| `hpt.harvests`      | `HarvestLog[]`                      |
| `hpt.serverImport`  | when the copy across was confirmed  |

[`client/src/lib/localSnapshot.ts`](client/src/lib/localSnapshot.ts) reads the
first three by key, so it keeps working now that `useLocalStorage` is gone. On
the first run against an empty garden the app offers to copy what it finds to
the server, reporting exactly what it found ("2 seed packets, 1 bed and 1
harvest entry"). Two rules hold throughout:

1. **Nothing is deleted from the browser** — before or after a successful
   import. It costs a few kilobytes and it is the only fallback if the server is
   lost before its first backup.
2. **Nothing is copied without being asked**, and `hpt.serverImport` is written
   only once the server confirms, so a failed import leaves the offer standing.

`POST /api/import` only lands on a wholly empty garden, and the offer is only
made while the garden reads as empty, so an import never destroys anything. If
another device writes in the moment between, the server answers
`409 import_not_empty` with every collection's current state, which the client
folds the browser copy into with ordinary versioned `PUT`s. Merging is by id, so
a second device offering the same `localStorage` is a no-op rather than a
duplicate. Nothing is ever wiped, and there is no "replace everything" button.

With no browser copy to move, the same card offers the sample garden in
[`client/src/lib/seedData.ts`](client/src/lib/seedData.ts) instead. Both are
opt-in: a tracker that invents rows on first launch is one you cannot trust.

`activeView` is deliberately **not** persisted — the app always opens on the
Bed Planner.

## Architecture

`App` holds every piece of state at the top level and passes it down as props;
the views are presentational and mutate through the setters they receive. The
state itself comes from [`useGardenData`](client/src/hooks/useGardenData.ts),
which keeps the `(data, setData)` contract the views already had.

```
App
├── Sidebar            { activeView, onChange, status, onRetry }
├── SyncBanner         { status, onRetry }
├── ConflictChooser    { conflicts, onResolve, onResolveAll }
├── FirstRunCard       { local, phase, onImport, onDismiss }
├── BedPlannerView     { beds, setBeds, seeds }
├── SeedVaultView      { seeds, setSeeds }
└── HarvestLogView     { harvests, setHarvests, seeds }
```

### Talking to the API

Three modules, in layers:

- [`client/src/lib/api.ts`](client/src/lib/api.ts) — resolves URLs against the
  document base. Use it for every request rather than writing a path by hand;
  an absolute `/api/...` breaks under ingress.
- [`client/src/lib/apiClient.ts`](client/src/lib/apiClient.ts) — the only module
  that speaks HTTP. Classifies failures (`network`, `stale`, `rejected`,
  `server`, `malformed`) rather than stringifying them, and carries each
  collection's opaque version.
- [`client/src/hooks/useGardenData.ts`](client/src/hooks/useGardenData.ts) —
  loading, optimistic writes, retries and merges.

Every edit lands in local state immediately and is written behind the user's
back, so the UI never waits for a round trip. Writes for one collection are
serialised and rapid edits collapse into the next request. A failed save keeps
the edit on screen and queued; it retries on the next edit, on reconnect, or
when the user asks.

Because `PUT` replaces a whole collection, every write declares the version it
read (`If-Match`) and the server answers `409` rather than letting a stale tab
erase what another device saved. That is routine, not an error: the response
carries the current state, so the client runs an item-level three-way merge
([`client/src/lib/merge.ts`](client/src/lib/merge.ts)) and retries in one round
trip. Only genuinely divergent pairs — the same record changed differently in
both places, or changed here and deleted there — reach the user, and then per
item rather than all-or-nothing, worded as "changed on another device" rather
than in the language of version control.

Shared building blocks:

- `client/src/components/ViewHeader.tsx` — icon + title + description section
  header.
- `client/src/components/ViewSummaryCard.tsx` — card with a headline and stat
  tiles.
- `client/src/lib/id.ts` — `createId(prefix?)`, the single source of ids for new
  records. Use it instead of array indices for React keys.

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
    ├── hooks/useGardenData.ts    API-backed state, optimistic saves, merges
    ├── lib/
    │   ├── api.ts                base-path-aware API URLs
    │   ├── apiClient.ts          typed fetch layer, versions and failures
    │   ├── merge.ts              item-level three-way merge
    │   ├── localSnapshot.ts      the pre-server browser copy, read-only
    │   ├── id.ts                 createId helper
    │   ├── seedData.ts           DEFAULT_SEEDS / DEFAULT_BEDS / DEFAULT_HARVESTS
    │   ├── categoryTheme.ts      shared crop-family colour palette
    │   ├── germination.ts        seed-age and viability estimates
    │   ├── rotation.ts           layout edits + crop-rotation conflicts
    │   └── harvest.ts            day grouping, totals, local date parsing
    └── components/
        ├── Sidebar.tsx           + SyncStatus.tsx (the live save footer)
        ├── SyncBanner.tsx        offline and save-failure notices
        ├── ConflictChooser.tsx   per-item "changed on another device"
        ├── FirstRunCard.tsx      the one-time copy-across offer
        ├── GardenLoading.tsx     quiet skeleton, only after 250ms
        ├── GardenUnavailable.tsx the server could not be reached
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

repository.yaml                   makes this repo an HA add-on repository
addon/
├── config.yaml                   add-on manifest: ingress, panel, version
├── Dockerfile                    node:22-alpine, no build.yaml
├── DOCS.md                       shown on the add-on's Documentation tab
├── CHANGELOG.md                  shown on its Changelog tab
├── icon.png, logo.png            store artwork
└── rootfs/
    ├── run.sh                    entrypoint (LF endings, execs Node as PID 1)
    └── app/                      generated: staged server, client, manifest

scripts/build-addon.mjs           stages the build into addon/rootfs/app
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

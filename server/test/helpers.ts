/**
 * Test rig: a real HTTP server on an ephemeral port, backed by a throwaway
 * SQLite file in a temp directory.
 *
 * Deliberately not using an in-memory database — the file path is part of what
 * is being tested (WAL mode, the file being created, migrations landing on
 * disk), and a file exercises the same code the LXC will run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type {
  GardenBed,
  GardenSettings,
  HarvestLog,
  HomeAssistantBody,
  IntegrationStatusBody,
  SeedPacket,
} from '@hpt/shared';
import { loadConfig } from '../src/config.ts';
import type { ServerConfig } from '../src/config.ts';
import { createApp } from '../src/app.ts';
import { openDatabase } from '../src/db/open.ts';
import type { Database } from '../src/db/open.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { HomeAssistantService } from '../src/ha/service.ts';
import type { FetchLike } from '../src/ha/client.ts';

/** One request the code under test made to Home Assistant. */
export interface HaCall {
  method: string;
  url: string;
  body: unknown;
}

/**
 * A stand-in for the whole of Home Assistant.
 *
 * Every test that touches the integration goes through this rather than a live
 * Home Assistant, which is what makes the interesting rules — the bands, the
 * de-duplication, the quiet hours, the collision guard — testable at all. It
 * also means the suite never opens a socket to anything, so the
 * "degrades to cleanly absent" path is provable: a test can simply assert that
 * `calls` is empty.
 */
export interface FakeHomeAssistant {
  /** Every request, in order. The main assertion surface. */
  calls: HaCall[];
  /** Requests to one path fragment, e.g. `states/sensor.garden_harvest_weight`. */
  callsMatching: (fragment: string) => HaCall[];
  /** Entities the fake pretends already exist, keyed by entity id. */
  states: Map<string, { state: string; attributes: Record<string, unknown> }>;
  /** Overnight lows in °F, newest first, used to build the daily forecast. */
  setDailyLows: (lows: { at: string; lowF: number }[]) => void;
  setHourly: (points: { at: string; tempF: number }[]) => void;
  /** Makes every subsequent request fail, as an unreachable Supervisor would. */
  setUnreachable: (unreachable: boolean) => void;
  /**
   * How the fake misbehaves, for the degraded-path tests.
   *
   * `null` is healthy. The others are the four ways this actually breaks in the
   * field: Supervisor down or the socket dropped (`throw`), a slow start or an
   * overloaded box (`timeout`), Home Assistant restarting behind its proxy
   * (`status`), and an HTML error page where JSON was promised (`malformed`).
   */
  setFailureMode: (mode: FakeFailureMode) => void;
  fetchImpl: FetchLike;
}

export type FakeFailureMode = null | 'throw' | 'timeout' | 'status' | 'malformed';

const OK_BODY = { ok: true, status: 200 };

export function fakeHomeAssistant(
  options: {
    supportedFeatures?: number;
    temperatureUnit?: string;
    /** The one weather entity this fake has. Anything else 404s, as HA would. */
    weatherEntity?: string;
  } = {},
): FakeHomeAssistant {
  const calls: HaCall[] = [];
  const weatherEntity = options.weatherEntity ?? 'weather.forecast_home';
  const states = new Map<string, { state: string; attributes: Record<string, unknown> }>();
  let dailyLows: { at: string; lowF: number }[] = [];
  let hourly: { at: string; tempF: number }[] = [];
  let unreachable = false;
  let failureMode: FakeFailureMode = null;

  const respond = (value: unknown) => ({
    ...OK_BODY,
    json: async () => value,
    text: async () => JSON.stringify(value),
  });

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(init.body);

    calls.push({ method, url, body });

    if (unreachable) throw new Error('supervisor unreachable');

    if (failureMode === 'throw') throw new Error('socket hang up');

    if (failureMode === 'timeout') {
      // Honours the caller's AbortSignal the way a real fetch does, so the
      // client's own timeout is what ends this rather than the test hanging.
      await new Promise((resolve, reject) => {
        const signal = init?.signal;
        const timer = setTimeout(resolve, 30_000);

        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('The operation was aborted'));
        });
      });
    }

    if (failureMode === 'status') {
      return {
        ok: false,
        status: 502,
        json: async () => ({ message: 'Bad gateway' }),
        text: async () => 'Bad gateway',
      };
    }

    if (failureMode === 'malformed') {
      return {
        ...OK_BODY,
        // An HTML error page where JSON was promised. `json()` rejecting is the
        // realistic failure, not a null body.
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
        text: async () => '<html>502 Bad Gateway</html>',
      };
    }

    if (url.includes('/addons/self/info')) {
      return respond({ data: { slug: 'test_home_plot_tracker' } });
    }

    // `weather.get_forecasts` — the only way to read a forecast since 2024.4.
    if (url.includes('/services/weather/get_forecasts')) {
      const type = (body as { type?: string } | undefined)?.type;
      const entityId = (body as { entity_id?: string } | undefined)?.entity_id ?? 'weather.x';

      const forecast =
        type === 'hourly'
          ? hourly.map((point) => ({ datetime: point.at, temperature: point.tempF }))
          : dailyLows.map((day) => ({ datetime: day.at, templow: day.lowF, temperature: 70 }));

      return respond({ service_response: { [entityId]: { forecast } } });
    }

    if (url.includes('/services/')) return respond({});

    const stateMatch = /\/states\/([^/?]+)$/.exec(url);

    if (stateMatch) {
      const entityId = decodeURIComponent(stateMatch[1]!);

      if (method === 'POST') {
        const payload = body as { state: string; attributes: Record<string, unknown> };

        states.set(entityId, payload);

        return respond({ entity_id: entityId, ...payload });
      }

      if (entityId.startsWith('weather.')) {
        // Only the entity this fake claims to have. A renamed or deleted
        // weather entity is a real scenario — she renames things in the Home
        // Assistant UI — and answering every `weather.*` id would make that
        // untestable.
        if (entityId !== weatherEntity) {
          return {
            ok: false,
            status: 404,
            json: async () => ({ message: 'Entity not found.' }),
            text: async () => 'Entity not found.',
          };
        }

        return respond({
          entity_id: entityId,
          state: 'cloudy',
          attributes: {
            temperature_unit: options.temperatureUnit ?? '°F',
            supported_features: options.supportedFeatures ?? 3,
          },
        });
      }

      const existing = states.get(entityId);

      if (!existing) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ message: 'Entity not found.' }),
          text: async () => 'Entity not found.',
        };
      }

      return respond({ entity_id: entityId, ...existing });
    }

    return respond({});
  };

  return {
    calls,
    callsMatching: (fragment) => calls.filter((call) => call.url.includes(fragment)),
    states,
    setDailyLows: (lows) => {
      dailyLows = lows;
    },
    setHourly: (points) => {
      hourly = points;
    },
    setUnreachable: (value) => {
      unreachable = value;
    },
    setFailureMode: (mode) => {
      failureMode = mode;
    },
    fetchImpl,
  };
}

export interface TestServer {
  origin: string;
  config: ServerConfig;
  db: Database;
  clientMounted: boolean;
  tempDir: string;
  /** The faked Home Assistant, when one was asked for. */
  ha: FakeHomeAssistant | null;
  /** The integration, when one was constructed. `null` without a token. */
  haService: HomeAssistantService | null;
  /** Absolute URL for a path *below the configured base path*. */
  url: (pathname: string) => string;
  get: (pathname: string, init?: RequestInit) => Promise<Response>;
  /**
   * `PUT` that fetches the current `ETag` first and sends it as `If-Match`.
   *
   * Almost every test cares about what a write *stores*, not about how it
   * declares its precondition, so the read-then-write dance stays out of them.
   * Tests that are specifically about concurrency use `putRaw` and drive the
   * header themselves.
   */
  putJson: (pathname: string, body: unknown) => Promise<Response>;
  /** `PUT` with exactly the headers given — no `If-Match` unless you supply one. */
  putRaw: (pathname: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
  postJson: (pathname: string, body: unknown) => Promise<Response>;
  /** The current `ETag` of a collection, ready to be used as `If-Match`. */
  etag: (pathname: string) => Promise<string>;
  close: () => Promise<void>;
}

export function tempDir(prefix = 'hpt-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * `GET /api/home-assistant`, typed.
 *
 * The endpoint answers 200 unconditionally — there is no failure branch, by
 * design — so every caller wants the status *and* the body, and none of them
 * should be repeating the cast.
 */
export async function readHomeAssistant(
  server: TestServer,
): Promise<{ status: number; body: HomeAssistantBody }> {
  const response = await server.get('/api/home-assistant');

  return { status: response.status, body: (await response.json()) as HomeAssistantBody };
}

/** `GET /api/home-assistant/status`, typed. Also answers 200 unconditionally. */
export async function readIntegrationStatus(
  server: TestServer,
): Promise<{ status: number; body: IntegrationStatusBody }> {
  const response = await server.get('/api/home-assistant/status');

  return { status: response.status, body: (await response.json()) as IntegrationStatusBody };
}

/** `GET /api/settings`, typed. */
export async function readSettingsBody(
  server: TestServer,
): Promise<{ status: number; body: GardenSettings }> {
  const response = await server.get('/api/settings');

  return { status: response.status, body: (await response.json()) as GardenSettings };
}

export interface StartServerOptions {
  /**
   * Wire in a faked Home Assistant.
   *
   * Absent by default, and that default is the point: every existing test runs
   * with no integration at all, exactly as the app does on a laptop.
   */
  ha?: FakeHomeAssistant;
  /**
   * Seed the settings row as migration 4 would on a real upgrade.
   *
   * Absent means the defaults, which is what a fresh install gets. Supplying
   * one is how a test stands in for "she was already running 0.2.0 with
   * notifications off".
   */
  settingsSeed?: GardenSettings;
}

export async function startServer(
  overrides: Record<string, string> = {},
  options: StartServerOptions = {},
): Promise<TestServer> {
  const dir = tempDir();
  const env = {
    HOST: '127.0.0.1',
    PORT: '0',
    LOG_REQUESTS: 'false',
    SERVE_CLIENT: 'false',
    NODE_ENV: 'test',
    DATABASE_PATH: path.join(dir, 'garden.db'),
    // Point the options file at the throwaway directory so a stray
    // /data/options.json on the machine running the tests can never leak in.
    ADDON_OPTIONS_PATH: path.join(dir, 'options.json'),
    // Asking for a fake Home Assistant implies the token Supervisor would have
    // injected. Without one the integration is never constructed at all, which
    // is the default here and is exactly what a laptop looks like.
    ...(options.ha ? { SUPERVISOR_TOKEN: 'test-supervisor-token' } : {}),
    ...overrides,
  } as NodeJS.ProcessEnv;

  const config = loadConfig(env);
  const db = openDatabase(config.databasePath);
  runMigrations(
    db,
    undefined,
    options.settingsSeed ? { settingsSeed: options.settingsSeed } : undefined,
  );

  const haService = HomeAssistantService.create({
    db,
    env: config.homeAssistant,
    fetchImpl: options.ha?.fetchImpl,
    log: () => {},
    warn: () => {},
  });

  const { app, clientMounted } = createApp({
    db,
    config,
    homeAssistant: haService
      ? {
          onGardenChanged: () => haService.onGardenChanged(),
          homeAssistant: () => haService.snapshot(),
          integrationStatus: () => haService.status(),
        }
      : undefined,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  const url = (pathname: string): string =>
    `${origin}${config.basePath}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;

  const sendJson =
    (method: string) =>
    (pathname: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(url(pathname), {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });

  const putRaw = sendJson('PUT');

  const etag = async (pathname: string): Promise<string> => {
    const response = await fetch(url(pathname));
    const tag = response.headers.get('etag');

    if (tag === null) {
      throw new Error(`GET ${pathname} returned no ETag (status ${response.status})`);
    }

    return tag;
  };

  return {
    origin,
    config,
    db,
    clientMounted,
    tempDir: dir,
    ha: options.ha ?? null,
    haService,
    url,
    get: (pathname, init) => fetch(url(pathname), init),
    putRaw,
    async putJson(pathname, body) {
      return putRaw(pathname, body, { 'If-Match': await etag(pathname) });
    },
    postJson: (pathname, body) => sendJson('POST')(pathname, body),
    etag,
    async close() {
      haService?.stop();

      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      db.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

/** A minimal stand-in for `client/dist`, with a hashed asset and a public file. */
export function writeFakeClientBundle(root: string): string {
  const clientDir = path.join(root, 'client-dist');
  fs.mkdirSync(path.join(clientDir, 'assets'), { recursive: true });

  fs.writeFileSync(
    path.join(clientDir, 'index.html'),
    [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <title>The Home Plot Tracker</title>',
      '    <script type="module" crossorigin src="./assets/index-abc12345.js"></script>',
      '  </head>',
      '  <body><div id="root"></div></body>',
      '</html>',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(clientDir, 'assets', 'index-abc12345.js'), 'console.log("bundle")\n');
  fs.writeFileSync(path.join(clientDir, 'leaf.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');

  return clientDir;
}

export function seed(overrides: Partial<SeedPacket> = {}): SeedPacket {
  return {
    id: 'seed_cherokee_purple',
    category: 'Nightshade',
    variety: 'Cherokee Purple',
    brand: 'Baker Creek',
    purchaseYear: 2025,
    notes: 'Dusky heirloom slicer.',
    ...overrides,
  };
}

export function bed(overrides: Partial<GardenBed> = {}): GardenBed {
  return {
    id: 'bed_raised_north',
    name: 'Bed 1 - Raised',
    rows: 2,
    columns: 3,
    layout: [
      ['Cherokee Purple', null, null],
      [null, null, 'Genovese Basil'],
    ],
    lastYearCategory: 'Nightshade',
    ...overrides,
  };
}

export function harvest(overrides: Partial<HarvestLog> = {}): HarvestLog {
  return {
    id: 'harvest_2026_08_12_tomato',
    date: '2026-08-12',
    variety: 'Cherokee Purple',
    weightLbs: 3.4,
    count: 5,
    ...overrides,
  };
}

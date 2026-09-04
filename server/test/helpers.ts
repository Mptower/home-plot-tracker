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
import type { GardenBed, HarvestLog, SeedPacket } from '@hpt/shared';
import { loadConfig } from '../src/config.ts';
import type { ServerConfig } from '../src/config.ts';
import { createApp } from '../src/app.ts';
import { openDatabase } from '../src/db/open.ts';
import type { Database } from '../src/db/open.ts';
import { runMigrations } from '../src/db/migrate.ts';

export interface TestServer {
  origin: string;
  config: ServerConfig;
  db: Database;
  clientMounted: boolean;
  tempDir: string;
  /** Absolute URL for a path *below the configured base path*. */
  url: (pathname: string) => string;
  get: (pathname: string, init?: RequestInit) => Promise<Response>;
  putJson: (pathname: string, body: unknown) => Promise<Response>;
  postJson: (pathname: string, body: unknown) => Promise<Response>;
  close: () => Promise<void>;
}

export function tempDir(prefix = 'hpt-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function startServer(
  overrides: Record<string, string> = {},
): Promise<TestServer> {
  const dir = tempDir();
  const env = {
    HOST: '127.0.0.1',
    PORT: '0',
    LOG_REQUESTS: 'false',
    SERVE_CLIENT: 'false',
    NODE_ENV: 'test',
    DATABASE_PATH: path.join(dir, 'garden.db'),
    ...overrides,
  } as NodeJS.ProcessEnv;

  const config = loadConfig(env);
  const db = openDatabase(config.databasePath);
  runMigrations(db);

  const { app, clientMounted } = createApp({ db, config });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  const url = (pathname: string): string =>
    `${origin}${config.basePath}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;

  const sendJson = (method: string) => (pathname: string, body: unknown) =>
    fetch(url(pathname), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    origin,
    config,
    db,
    clientMounted,
    tempDir: dir,
    url,
    get: (pathname, init) => fetch(url(pathname), init),
    putJson: sendJson('PUT'),
    postJson: sendJson('POST'),
    async close() {
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

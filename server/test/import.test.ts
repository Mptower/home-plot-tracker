import test from 'node:test';
import assert from 'node:assert/strict';
import { bed, harvest, seed, startServer } from './helpers.ts';

interface ImportResponse {
  mode: string;
  message: string;
  replaced: { seeds: number; beds: number; harvests: number };
  imported: { seeds: number; beds: number; harvests: number };
}

const snapshot = {
  seeds: [seed(), seed({ id: 'seed_basil', variety: 'Genovese Basil', category: 'Herb' })],
  beds: [bed()],
  harvests: [harvest(), harvest({ id: 'harvest_two', date: '2026-09-02', weightLbs: 4.2, count: 7 })],
};

test('an import loads a whole browser export in one call', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.postJson('/api/import', snapshot);
  assert.equal(response.status, 200);

  const body = (await response.json()) as ImportResponse;
  assert.equal(body.mode, 'replace');
  assert.deepEqual(body.imported, { seeds: 2, beds: 1, harvests: 2 });
  assert.deepEqual(body.replaced, { seeds: 0, beds: 0, harvests: 0 });

  assert.deepEqual(await server.get('/api/seeds').then((r) => r.json()), snapshot.seeds);
  assert.deepEqual(await server.get('/api/beds').then((r) => r.json()), snapshot.beds);
  assert.deepEqual(await server.get('/api/harvests').then((r) => r.json()), snapshot.harvests);
});

test('the response states plainly that it replaced rather than merged', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.postJson('/api/import', snapshot);

  const second = await server.postJson('/api/import', {
    seeds: [seed({ id: 'only_survivor' })],
    beds: [],
    harvests: [],
  });
  const body = (await second.json()) as ImportResponse;

  assert.equal(body.mode, 'replace');
  assert.match(body.message, /Replaced all existing data/);
  assert.match(body.message, /Nothing was merged/);
  assert.deepEqual(body.replaced, { seeds: 2, beds: 1, harvests: 2 }, 'reports what it displaced');
  assert.deepEqual(body.imported, { seeds: 1, beds: 0, harvests: 0 });

  const seeds = (await server.get('/api/seeds').then((r) => r.json())) as { id: string }[];
  assert.deepEqual(seeds.map((item) => item.id), ['only_survivor']);
  assert.deepEqual(await server.get('/api/beds').then((r) => r.json()), []);
  assert.deepEqual(await server.get('/api/harvests').then((r) => r.json()), []);
});

test('an import is validated exactly like a collection write', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.postJson('/api/import', {
    seeds: [seed({ purchaseYear: 'recently' as never })],
    beds: [bed({ rows: 2, columns: 2, layout: [[null, null]] })],
    harvests: [harvest({ date: '2026-13-01' })],
  });

  assert.equal(response.status, 400);

  const body = (await response.json()) as { issues: { path: string }[] };
  assert.deepEqual(
    body.issues.map((issue) => issue.path).sort(),
    ['body.beds[0].layout', 'body.harvests[0].date', 'body.seeds[0].purchaseYear'],
  );
});

test('all three collections are required', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.postJson('/api/import', { seeds: [], beds: [] });
  assert.equal(response.status, 400);

  const body = (await response.json()) as { issues: { path: string }[] };
  assert.deepEqual(body.issues.map((issue) => issue.path), ['body.harvests']);
});

test('unknown top-level keys in an import are rejected', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.postJson('/api/import', { ...snapshot, settings: {} });
  assert.equal(response.status, 400);

  const body = (await response.json()) as { issues: { path: string }[] };
  assert.deepEqual(body.issues.map((issue) => issue.path), ['body.settings']);
});

test('a rejected import changes nothing at all', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.postJson('/api/import', snapshot);

  // Seeds and beds are fine here; only the harvests are bad. Because the whole
  // import is one transaction, none of it may land.
  const response = await server.postJson('/api/import', {
    seeds: [seed({ id: 'new_seed' })],
    beds: [],
    harvests: [harvest({ weightLbs: 'heavy' as never })],
  });
  assert.equal(response.status, 400);

  assert.deepEqual(await server.get('/api/seeds').then((r) => r.json()), snapshot.seeds);
  assert.deepEqual(await server.get('/api/beds').then((r) => r.json()), snapshot.beds);
  assert.deepEqual(await server.get('/api/harvests').then((r) => r.json()), snapshot.harvests);
});

test('importing empty collections is allowed and clears everything', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.postJson('/api/import', snapshot);
  const response = await server.postJson('/api/import', { seeds: [], beds: [], harvests: [] });

  assert.equal(response.status, 200);
  const body = (await response.json()) as ImportResponse;
  assert.deepEqual(body.imported, { seeds: 0, beds: 0, harvests: 0 });

  for (const collection of ['seeds', 'beds', 'harvests']) {
    assert.deepEqual(await server.get(`/api/${collection}`).then((r) => r.json()), []);
  }
});

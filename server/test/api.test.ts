import test from 'node:test';
import assert from 'node:assert/strict';
import { bed, harvest, seed, startServer } from './helpers.ts';

test('GET /api/health reports the schema version', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.get('/api/health');
  assert.equal(response.status, 200);

  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.status, 'ok');
  assert.equal(body.schemaVersion, 1);
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.equal(typeof body.timestamp, 'string');
});

test('every collection starts empty', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  for (const collection of ['seeds', 'beds', 'harvests']) {
    const response = await server.get(`/api/${collection}`);
    assert.equal(response.status, 200, `GET /api/${collection}`);
    assert.deepEqual(await response.json(), [], `/api/${collection} should start empty`);
  }
});

test('seeds round-trip through PUT and GET', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const payload = [
    seed(),
    seed({ id: 'seed_basil', category: 'Herb', variety: 'Genovese Basil', purchaseYear: 2026 }),
  ];

  const put = await server.putJson('/api/seeds', payload);
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), payload, 'PUT echoes back what was stored');

  const get = await server.get('/api/seeds');
  assert.deepEqual(await get.json(), payload, 'and GET returns the same thing');
});

test('beds round-trip, including the layout grid', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const payload = [
    bed(),
    bed({
      id: 'bed_ground_south',
      name: 'Bed 2 - In Ground',
      rows: 1,
      columns: 2,
      layout: [[null, 'Lacinato Kale']],
      lastYearCategory: '',
    }),
  ];

  const put = await server.putJson('/api/beds', payload);
  assert.equal(put.status, 200);

  const stored = (await server.get('/api/beds').then((r) => r.json())) as typeof payload;
  assert.deepEqual(stored, payload);
  assert.deepEqual(
    stored[0]?.layout,
    [
      ['Cherokee Purple', null, null],
      [null, null, 'Genovese Basil'],
    ],
    'the JSON layout survives the round trip exactly',
  );
});

test('harvests round-trip, including a zero count', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const payload = [
    harvest(),
    harvest({ id: 'harvest_beans', date: '2026-08-30', variety: 'Provider Bush Bean', weightLbs: 1.6, count: 0 }),
    harvest({ id: 'harvest_kale', date: '2026-08-25', variety: 'Lacinato Kale', weightLbs: 0, count: 12 }),
  ];

  await server.putJson('/api/harvests', payload);
  const stored = await server.get('/api/harvests').then((r) => r.json());

  assert.deepEqual(stored, payload);
});

test('array order is preserved rather than sorted by id', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const payload = [
    seed({ id: 'zzz', variety: 'Zucchini' }),
    seed({ id: 'aaa', variety: 'Aubergine' }),
    seed({ id: 'mmm', variety: 'Marrow' }),
  ];

  await server.putJson('/api/seeds', payload);
  const stored = (await server.get('/api/seeds').then((r) => r.json())) as { id: string }[];

  assert.deepEqual(
    stored.map((item) => item.id),
    ['zzz', 'aaa', 'mmm'],
  );
});

test('PUT replaces the whole collection rather than appending', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putJson('/api/seeds', [seed({ id: 'one' }), seed({ id: 'two' })]);
  await server.putJson('/api/seeds', [seed({ id: 'three' })]);

  const stored = (await server.get('/api/seeds').then((r) => r.json())) as { id: string }[];
  assert.deepEqual(stored.map((item) => item.id), ['three']);
});

test('an empty array is a legitimate payload and clears the collection', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putJson('/api/harvests', [harvest()]);
  const put = await server.putJson('/api/harvests', []);

  assert.equal(put.status, 200);
  assert.deepEqual(await server.get('/api/harvests').then((r) => r.json()), []);
});

test('collections are independent of one another', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putJson('/api/seeds', [seed()]);
  await server.putJson('/api/beds', [bed()]);
  await server.putJson('/api/harvests', [harvest()]);
  await server.putJson('/api/beds', []);

  assert.equal(((await server.get('/api/seeds').then((r) => r.json())) as unknown[]).length, 1);
  assert.equal(((await server.get('/api/beds').then((r) => r.json())) as unknown[]).length, 0);
  assert.equal(((await server.get('/api/harvests').then((r) => r.json())) as unknown[]).length, 1);
});

test('unknown API routes answer with JSON, not HTML', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.get('/api/tomatoes');
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);

  const body = (await response.json()) as { error: string };
  assert.match(body.error, /No API route for GET/);
});

test('per-item CRUD is deliberately absent', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putJson('/api/seeds', [seed()]);

  const response = await server.get('/api/seeds/seed_cherokee_purple');
  assert.equal(response.status, 404);
});

test('a write without a JSON content type is refused', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await fetch(server.url('/api/seeds'), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: '[]',
  });

  assert.equal(response.status, 415);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /application\/json/);
});

test('a malformed JSON body is a 400, not a crash', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await fetch(server.url('/api/seeds'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '[{"id": "broken"',
  });

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /not valid JSON/);
});

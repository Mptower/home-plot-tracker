import test from 'node:test';
import assert from 'node:assert/strict';
import type { ImportConflictBody, ImportResultBody } from '@hpt/shared';
import { bed, harvest, seed, startServer } from './helpers.ts';

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

  const body = (await response.json()) as ImportResultBody;
  assert.equal(body.mode, 'replace');
  assert.deepEqual(body.imported, { seeds: 2, beds: 1, harvests: 2 });

  // Every collection is bumped off 0, so a tab that read the empty garden before
  // the import cannot then write over it.
  assert.deepEqual(body.versions, { seeds: '"1"', beds: '"1"', harvests: '"1"' });

  assert.deepEqual(await server.get('/api/seeds').then((r) => r.json()), snapshot.seeds);
  assert.deepEqual(await server.get('/api/beds').then((r) => r.json()), snapshot.beds);
  assert.deepEqual(await server.get('/api/harvests').then((r) => r.json()), snapshot.harvests);
});

test('the versions an import returns are immediately usable as If-Match', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const body = (await server
    .postJson('/api/import', snapshot)
    .then((r) => r.json())) as ImportResultBody;

  // No intervening GET: the point of returning versions is that a client can
  // carry straight on writing.
  const write = await server.putRaw('/api/seeds', [seed({ id: 'added_after_import' })], {
    'If-Match': body.versions.seeds,
  });

  assert.equal(write.status, 200);
  assert.equal(write.headers.get('etag'), '"2"');
});

test('an import into a garden that already holds data is refused', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.postJson('/api/import', snapshot);

  // A stale localStorage snapshot from the other device. Before the emptiness
  // guard this silently replaced a real season's records.
  const second = await server.postJson('/api/import', {
    seeds: [seed({ id: 'would_have_been_the_only_survivor' })],
    beds: [],
    harvests: [],
  });

  assert.equal(second.status, 409);

  const body = (await second.json()) as ImportConflictBody;
  assert.equal(body.error, 'import_not_empty');
  assert.deepEqual(body.nonEmpty, ['seeds', 'beds', 'harvests']);
  assert.deepEqual(body.currentVersion, { seeds: '"1"', beds: '"1"', harvests: '"1"' });
  assert.match(body.message, /already has data/);
  assert.match(body.message, /normal versioned PUT/, 'points at the non-destructive path');

  // The refusal hands back the whole garden, so the client can show what is
  // already there rather than making the user guess.
  assert.deepEqual(body.current, snapshot);

  // And nothing moved.
  assert.deepEqual(await server.get('/api/seeds').then((r) => r.json()), snapshot.seeds);
  assert.deepEqual(await server.get('/api/beds').then((r) => r.json()), snapshot.beds);
  assert.deepEqual(await server.get('/api/harvests').then((r) => r.json()), snapshot.harvests);
});

test('only the collections that actually hold rows are reported as blocking', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putJson('/api/beds', [bed()]);

  const response = await server.postJson('/api/import', snapshot);
  assert.equal(response.status, 409);

  const body = (await response.json()) as ImportConflictBody;
  assert.deepEqual(body.nonEmpty, ['beds'], 'seeds and harvests are empty and not at fault');
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

test('importing empty collections into an empty garden is a no-op that still takes', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.postJson('/api/import', { seeds: [], beds: [], harvests: [] });

  assert.equal(response.status, 200);
  const body = (await response.json()) as ImportResultBody;
  assert.deepEqual(body.imported, { seeds: 0, beds: 0, harvests: 0 });

  // Still bumped: the import happened, it just carried nothing.
  assert.deepEqual(body.versions, { seeds: '"1"', beds: '"1"', harvests: '"1"' });

  for (const collection of ['seeds', 'beds', 'harvests']) {
    assert.deepEqual(await server.get(`/api/${collection}`).then((r) => r.json()), []);
  }
});

test('clearing every collection makes the garden importable again', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.postJson('/api/import', snapshot);
  assert.equal((await server.postJson('/api/import', snapshot)).status, 409);

  // The documented way back in: empty each collection with an ordinary versioned
  // write, then import. This is the recovery path the client offers when someone
  // adds a row before migrating their other device.
  for (const collection of ['seeds', 'beds', 'harvests']) {
    assert.equal((await server.putJson(`/api/${collection}`, [])).status, 200);
  }

  const retry = await server.postJson('/api/import', snapshot);
  assert.equal(retry.status, 200, 'an emptied garden accepts an import again');

  assert.deepEqual(await server.get('/api/seeds').then((r) => r.json()), snapshot.seeds);
});

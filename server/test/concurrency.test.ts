/**
 * Optimistic concurrency.
 *
 * The scenario every one of these tests is really about: a laptop tab loads the
 * harvests in the morning, a phone adds two entries from the garden in the
 * afternoon, and then the laptop saves. Without a version check that save
 * silently erases the afternoon's work — no error, no trace, and the data loss
 * that moving off `localStorage` was supposed to prevent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { HarvestLog, VersionConflictBody } from '@hpt/shared';
import { harvest, seed, startServer, tempDir } from './helpers.ts';

test('GET returns the collection version as an ETag, starting at 0', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  for (const collection of ['seeds', 'beds', 'harvests']) {
    const response = await server.get(`/api/${collection}`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('etag'), '"0"', `${collection} starts unversioned`);
    assert.deepEqual(await response.json(), [], 'the body is still a bare array');
  }
});

test('a successful write returns the new version, so no follow-up GET is needed', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const first = await server.putRaw('/api/harvests', [harvest()], { 'If-Match': '"0"' });

  assert.equal(first.status, 200);
  assert.equal(first.headers.get('etag'), '"1"');
  assert.deepEqual(await first.json(), [harvest()], 'success stays a bare array');

  // The returned tag is usable immediately.
  const second = await server.putRaw('/api/harvests', [], { 'If-Match': '"1"' });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('etag'), '"2"');
});

test('the stale-tab overwrite is rejected, and the fresh data survives', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  // 9am: the laptop loads the harvests.
  const laptopTag = await server.etag('/api/harvests');
  assert.equal(laptopTag, '"0"');

  // 2pm: the phone logs two harvests.
  const phone = [
    harvest({ id: 'h_sungold', variety: 'Sungold', date: '2026-08-14' }),
    harvest({ id: 'h_cucumber', variety: 'Marketmore', date: '2026-08-14' }),
  ];
  assert.equal((await server.putJson('/api/harvests', phone)).status, 200);

  // 2:05pm: the laptop, still holding the morning's empty list, saves.
  const stale = await server.putRaw('/api/harvests', [harvest({ id: 'h_from_the_laptop' })], {
    'If-Match': laptopTag,
  });

  assert.equal(stale.status, 409);
  assert.equal(stale.headers.get('etag'), '"1"', 'the conflict carries the current tag');

  const body = (await stale.json()) as VersionConflictBody<HarvestLog>;
  assert.equal(body.error, 'version_mismatch');
  assert.equal(body.currentVersion, '"1"');
  assert.equal(body.expectedVersion, '"0"');
  assert.equal(body.collection, 'harvests');

  // The whole point: the client can reconcile from the 409 alone.
  assert.deepEqual(body.current, phone, 'the conflict carries the current server state');

  // And the phone's afternoon is still there.
  assert.deepEqual(await server.get('/api/harvests').then((r) => r.json()), phone);
});

test('the happy path: refetch after a conflict, merge, and retry succeeds', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const laptopTag = await server.etag('/api/harvests');
  const phone = [harvest({ id: 'h_from_the_phone' })];
  await server.putJson('/api/harvests', phone);

  const laptopEdit = harvest({ id: 'h_from_the_laptop' });
  const conflict = await server.putRaw('/api/harvests', [laptopEdit], { 'If-Match': laptopTag });
  assert.equal(conflict.status, 409);

  const body = (await conflict.json()) as VersionConflictBody<HarvestLog>;

  // Reconcile using only what the 409 gave us — no second round trip.
  const merged = [...body.current, laptopEdit];
  const retry = await server.putRaw('/api/harvests', merged, {
    'If-Match': body.currentVersion,
  });

  assert.equal(retry.status, 200, 'the retry is accepted');
  assert.equal(retry.headers.get('etag'), '"2"');
  assert.deepEqual(await retry.json(), merged);

  // Nobody lost anything.
  const stored = (await server.get('/api/harvests').then((r) => r.json())) as HarvestLog[];
  assert.deepEqual(
    stored.map((item) => item.id),
    ['h_from_the_phone', 'h_from_the_laptop'],
  );
});

test('of many simultaneous writes from the same version, exactly one wins', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const tag = await server.etag('/api/seeds');

  // Five tabs, all saving from version 0 at once. The version check and the write
  // share one transaction, so there is no window in which two of them can both
  // read 0, both judge themselves current, and both write.
  const attempts = await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      server.putRaw('/api/seeds', [seed({ id: `seed_from_tab_${n}` })], { 'If-Match': tag }),
    ),
  );

  const accepted = attempts.filter((response) => response.status === 200);
  const rejected = attempts.filter((response) => response.status === 409);

  assert.equal(accepted.length, 1, 'exactly one write may be accepted');
  assert.equal(rejected.length, 4, 'every other write must be told it lost');

  assert.equal(await server.etag('/api/seeds'), '"1"', 'one write means one version bump');

  const winner = (await accepted[0]!.json()) as { id: string }[];
  const stored = (await server.get('/api/seeds').then((r) => r.json())) as { id: string }[];

  assert.equal(stored.length, 1);
  assert.deepEqual(stored, winner, 'the stored collection is exactly what the winner sent');
});

test('a write with no If-Match is refused rather than applied', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const existing = [harvest({ id: 'h_precious' })];
  await server.putJson('/api/harvests', existing);

  const response = await server.putRaw('/api/harvests', []);

  assert.equal(response.status, 428, 'a missing precondition is 428 Precondition Required');
  assert.equal(response.headers.get('etag'), '"1"');

  const body = (await response.json()) as VersionConflictBody<HarvestLog>;
  assert.equal(body.error, 'precondition_required');
  assert.equal(body.currentVersion, '"1"');
  assert.equal(body.collection, 'harvests');
  assert.deepEqual(body.current, existing, '428 carries the state too, like a 409');
  assert.equal(body.expectedVersion, undefined, 'there was no declared version to report');
  assert.match(body.message, /must declare the version/);

  assert.deepEqual(
    await server.get('/api/harvests').then((r) => r.json()),
    existing,
    'an unversioned write must never clobber',
  );
});

test('If-Match: * is refused, because it would match unconditionally', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const existing = [harvest({ id: 'h_precious' })];
  await server.putJson('/api/harvests', existing);

  const response = await server.putRaw('/api/harvests', [], { 'If-Match': '*' });

  assert.equal(response.status, 428);

  const body = (await response.json()) as VersionConflictBody<HarvestLog>;
  assert.equal(body.error, 'precondition_required');
  assert.match(body.message, /"\*" is rejected/);

  assert.deepEqual(await server.get('/api/harvests').then((r) => r.json()), existing);
});

test('a nonsense If-Match is refused, not treated as version 0', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  for (const value of ['banana', '"-1"', '"1.5"', '""', 'W/""']) {
    const response = await server.putRaw('/api/seeds', [], { 'If-Match': value });

    assert.equal(response.status, 428, `If-Match: ${value} must be refused`);

    const body = (await response.json()) as VersionConflictBody<unknown>;
    assert.equal(body.error, 'precondition_required');
  }
});

test('If-Match is accepted quoted, bare, or weak', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  // The idiomatic client echoes the ETag verbatim; curl and proxies produce the
  // other two. All three name the same version.
  for (const [index, value] of ['"0"', '1', 'W/"2"'].entries()) {
    const response = await server.putRaw('/api/seeds', [seed({ id: `s_${index}` })], {
      'If-Match': value,
    });

    assert.equal(response.status, 200, `If-Match: ${value} should be understood`);
    assert.equal(response.headers.get('etag'), `"${index + 1}"`);
  }
});

test('versions are per collection, so one write does not invalidate another', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const bedsTag = await server.etag('/api/beds');

  // Someone edits seeds repeatedly...
  for (let n = 0; n < 3; n += 1) {
    await server.putJson('/api/seeds', [seed({ id: `s_${n}` })]);
  }

  assert.equal(await server.etag('/api/seeds'), '"3"');
  assert.equal(await server.etag('/api/beds'), bedsTag, 'beds were untouched');

  // ...and an in-flight beds write from before all that is still valid.
  const response = await server.putRaw('/api/beds', [], { 'If-Match': bedsTag });
  assert.equal(response.status, 200);
});

test('a rejected payload is a 400 even without a precondition', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  // RFC 9110 s13.2.1: a request that would fail anyway should say so, rather
  // than sending the client off to refetch and retry a payload that was never
  // going to be accepted.
  const response = await server.putRaw('/api/seeds', [{ nope: true }]);

  assert.equal(response.status, 400);

  const body = (await response.json()) as { issues: unknown[] };
  assert.ok(Array.isArray(body.issues), 'it is a validation error, not a precondition one');
});

test('a rejected payload does not bump the version', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putJson('/api/seeds', [seed()]);
  assert.equal(await server.etag('/api/seeds'), '"1"');

  const response = await server.putRaw('/api/seeds', [{ nope: true }], { 'If-Match': '"1"' });
  assert.equal(response.status, 400);

  assert.equal(await server.etag('/api/seeds'), '"1"', 'a failed write is not a write');
});

test('a conditional GET still returns the body, because fetch defeats revalidation', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putJson('/api/seeds', [seed()]);
  const tag = await server.etag('/api/seeds');

  const response = await server.get('/api/seeds', { headers: { 'If-None-Match': tag } });

  // Documenting a trap rather than a feature. Setting an ETag looks as though it
  // buys a free 304 for a polling client, and it does not: per the Fetch spec, a
  // request carrying `If-None-Match` is downgraded to cache mode "no-store" and
  // sent with `Cache-Control: no-cache`, which Express's freshness check honours
  // by refusing to answer 304. Both `undici` and browsers do this. So a
  // conditional GET costs a full body every time.
  //
  // Left as-is deliberately: nothing needs 304s today, and hand-rolling
  // revalidation that ignores the client's own cache directive is not worth it
  // for three small arrays. If polling ever arrives, compare the ETag
  // client-side instead.
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), tag, 'the ETag is still there to compare yourself');
  assert.deepEqual(await response.json(), [seed()]);
});

test('versions survive a restart', async (t) => {
  // The counter has to live in the database. If it were in memory, every restart
  // would reset it to 0 and hand every stale tab a precondition that matches.
  const dir = tempDir('hpt-restart-');
  const databasePath = path.join(dir, 'garden.db');

  const stored = [seed({ id: 'survives_restart' })];

  const before = await startServer({ DATABASE_PATH: databasePath });
  await before.putJson('/api/seeds', stored);
  await before.putJson('/api/beds', []);
  assert.equal(await before.etag('/api/seeds'), '"1"');
  assert.equal(await before.etag('/api/beds'), '"1"');
  await before.close();

  const after = await startServer({ DATABASE_PATH: databasePath });

  // Removing the directory has to happen after the database handle is closed, or
  // Windows refuses with EBUSY.
  t.after(async () => {
    await after.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  assert.equal(await after.etag('/api/seeds'), '"1"', 'the version came back off disk');
  assert.deepEqual(await after.get('/api/seeds').then((r) => r.json()), stored);

  // The decisive check: a tab holding the pre-restart version 0 must still lose.
  const stale = await after.putRaw('/api/seeds', [], { 'If-Match': '"0"' });
  assert.equal(stale.status, 409, 'a restart must not forgive a stale write');
  assert.deepEqual(
    await after.get('/api/seeds').then((r) => r.json()),
    stored,
    'and the data is intact',
  );

  // Writing still continues from where it left off rather than restarting at 1.
  const next = await after.putRaw('/api/seeds', [], { 'If-Match': '"1"' });
  assert.equal(next.status, 200);
  assert.equal(next.headers.get('etag'), '"2"');
});

test('the version bump and the write commit or roll back together', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const stored = [seed({ id: 's_kept' })];
  await server.putJson('/api/seeds', stored);

  // A payload that passes validation but blows up on insert, to prove the bump
  // is inside the same transaction as the rows and cannot outlive a failed
  // write. A version that advanced without the data would be worse than no
  // version at all: it would reject the client's correct retry.
  const beforeVersion = await server.etag('/api/seeds');

  const response = await server.putRaw(
    '/api/seeds',
    [seed({ id: 's_a' }), seed({ id: 's_a' })],
    { 'If-Match': beforeVersion },
  );

  assert.equal(response.status, 400, 'duplicate ids are rejected');
  assert.equal(await server.etag('/api/seeds'), beforeVersion, 'the version did not move');
  assert.deepEqual(await server.get('/api/seeds').then((r) => r.json()), stored);
});

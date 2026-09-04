import test from 'node:test';
import assert from 'node:assert/strict';
import { bed, harvest, seed, startServer } from './helpers.ts';

interface ErrorBody {
  error: string;
  issues?: { path: string; message: string }[];
}

async function reject(
  server: Awaited<ReturnType<typeof startServer>>,
  pathname: string,
  body: unknown,
): Promise<ErrorBody> {
  const response = await server.putJson(pathname, body);
  assert.equal(response.status, 400, `expected ${pathname} to reject ${JSON.stringify(body)}`);

  const parsed = (await response.json()) as ErrorBody;
  assert.ok(Array.isArray(parsed.issues) && parsed.issues.length > 0, 'issues should be listed');
  assert.match(parsed.error, /Nothing was saved/);

  return parsed;
}

function paths(body: ErrorBody): string[] {
  return (body.issues ?? []).map((issue) => issue.path);
}

test('the body must be an array', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const body = await reject(server, '/api/seeds', { seeds: [] });
  assert.deepEqual(paths(body), ['body']);
  assert.match(body.issues?.[0]?.message ?? '', /expected an array, received object/);

  await reject(server, '/api/seeds', 'not an array');
  await reject(server, '/api/seeds', 42);
  await reject(server, '/api/seeds', null);
});

test('unknown fields are rejected rather than silently dropped', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const body = await reject(server, '/api/seeds', [{ ...seed(), isFavourite: true }]);
  assert.deepEqual(paths(body), ['body[0].isFavourite']);
  assert.match(body.issues?.[0]?.message ?? '', /unknown field/);
});

test('missing fields are named individually', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const { brand: _brand, notes: _notes, ...incomplete } = seed();
  const body = await reject(server, '/api/seeds', [incomplete]);

  assert.deepEqual(paths(body).sort(), ['body[0].brand', 'body[0].notes']);
});

test('wrong types are rejected', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const numeric = await reject(server, '/api/seeds', [seed({ purchaseYear: '2025' as never })]);
  assert.match(numeric.issues?.[0]?.message ?? '', /expected a number, received string/);

  const stringy = await reject(server, '/api/seeds', [seed({ variety: 12 as never })]);
  assert.match(stringy.issues?.[0]?.message ?? '', /expected a string, received number/);

  await reject(server, '/api/seeds', [seed({ notes: null as never })]);
  await reject(server, '/api/seeds', [seed({ id: '' })]);
  await reject(server, '/api/seeds', [seed({ variety: '   ' })]);
});

test('non-finite and non-integer numbers are rejected', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  // JSON has no literal for these, so they arrive as a raw body.
  const response = await fetch(server.url('/api/harvests'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '[{"id":"h","date":"2026-08-12","variety":"Tomato","weightLbs":1e999,"count":1}]',
  });
  assert.equal(response.status, 400);
  const infinite = (await response.json()) as ErrorBody;
  assert.deepEqual(paths(infinite), ['body[0].weightLbs']);
  assert.match(infinite.issues?.[0]?.message ?? '', /finite/);

  const fractional = await reject(server, '/api/harvests', [harvest({ count: 2.5 })]);
  assert.match(fractional.issues?.[0]?.message ?? '', /whole number/);

  await reject(server, '/api/harvests', [harvest({ weightLbs: -1 })]);
  await reject(server, '/api/seeds', [seed({ purchaseYear: 20.5 })]);
});

test('a layout that disagrees with rows or columns is rejected', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const tooFewRows = await reject(server, '/api/beds', [
    bed({ rows: 3, columns: 3, layout: [[null, null, null], [null, null, null]] }),
  ]);
  assert.deepEqual(paths(tooFewRows), ['body[0].layout']);
  assert.match(tooFewRows.issues?.[0]?.message ?? '', /exactly 3 rows/);

  const raggedRow = await reject(server, '/api/beds', [
    bed({ rows: 2, columns: 3, layout: [[null, null, null], [null, null]] }),
  ]);
  assert.deepEqual(paths(raggedRow), ['body[0].layout[1]']);
  assert.match(raggedRow.issues?.[0]?.message ?? '', /exactly 3 cells/);

  const badCell = await reject(server, '/api/beds', [
    bed({ rows: 1, columns: 2, layout: [[42 as never, null]] }),
  ]);
  assert.deepEqual(paths(badCell), ['body[0].layout[0][0]']);

  await reject(server, '/api/beds', [bed({ rows: 0, columns: 3, layout: [] })]);
  await reject(server, '/api/beds', [bed({ layout: 'nope' as never })]);
});

test('dates must be real yyyy-mm-dd calendar dates', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  for (const bad of ['12/08/2026', '2026-8-12', '2026-08-12T00:00:00Z', 'yesterday', '']) {
    const body = await reject(server, '/api/harvests', [harvest({ date: bad })]);
    assert.deepEqual(paths(body), ['body[0].date'], `date ${JSON.stringify(bad)}`);
  }

  const impossible = await reject(server, '/api/harvests', [harvest({ date: '2026-02-30' })]);
  assert.match(impossible.issues?.[0]?.message ?? '', /not a real calendar date/);

  // A leap day in a leap year is fine.
  const leap = await server.putJson('/api/harvests', [harvest({ date: '2028-02-29' })]);
  assert.equal(leap.status, 200);
});

test('duplicate ids within a collection are rejected', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const body = await reject(server, '/api/seeds', [seed({ id: 'same' }), seed({ id: 'same' })]);
  assert.deepEqual(paths(body), ['body[1].id']);
  assert.match(body.issues?.[0]?.message ?? '', /duplicate id/);
});

test('a prototype-polluting key is treated as an unknown field', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await fetch(server.url('/api/seeds'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '[{"id":"a","category":"Herb","variety":"Basil","brand":"b","purchaseYear":2025,"notes":"","__proto__":{"polluted":true}}]',
  });

  assert.equal(response.status, 400);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('every problem in a payload is reported at once', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const body = await reject(server, '/api/seeds', [
    seed({ id: '' }),
    seed({ id: 'ok', purchaseYear: 'nope' as never }),
  ]);

  assert.ok((body.issues?.length ?? 0) >= 2, 'a single response should name both problems');
  assert.deepEqual(paths(body).sort(), ['body[0].id', 'body[1].purchaseYear']);
});

test('a rejected write leaves the stored collection untouched', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const good = [seed({ id: 'keep_me' })];
  await server.putJson('/api/seeds', good);

  await reject(server, '/api/seeds', [seed({ id: 'first_is_fine' }), { nonsense: true }]);

  assert.deepEqual(
    await server.get('/api/seeds').then((r) => r.json()),
    good,
    'nothing from the rejected payload may reach the database',
  );
});

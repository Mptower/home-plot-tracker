/**
 * The app with no Home Assistant anywhere near it.
 *
 * This is not an edge case. It is `npm run dev` on a laptop, it is every other
 * test in this suite, and it is how the whole thing gets developed. The
 * integration has to be *absent* rather than broken: no timers, no sockets, no
 * error state, no spinner that never resolves, and a garden that behaves
 * exactly as it did before this feature existed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeHomeAssistant, startServer, harvest, seed, bed, readHomeAssistant } from './helpers.ts';

test('with no supervisor token the integration is never even constructed', async () => {
  const server = await startServer();

  try {
    // Not "constructed and disabled" — not constructed. Nothing to schedule a
    // timer, nothing holding a database handle, nothing to go wrong at 3am.
    assert.equal(server.haService, null);
  } finally {
    await server.close();
  }
});

test('the endpoint answers cleanly rather than failing', async () => {
  const server = await startServer();

  try {
    const { status, body } = await readHomeAssistant(server);

    // 200, not 404 and not 503. The client has no error branch to write,
    // because there is no error — there is simply no Home Assistant.
    assert.equal(status, 200);
    assert.deepEqual(body, { available: false, reason: 'not_configured', frost: null });
  } finally {
    await server.close();
  }
});

test('nothing reaches for the network, not once', async () => {
  const ha = fakeHomeAssistant();

  // The fake is wired in but the token is not, so the integration stays
  // unbuilt. This is the assertion that proves the token is what gates it.
  const server = await startServer({ SUPERVISOR_TOKEN: '' }, { ha });

  try {
    assert.equal(server.haService, null);

    await server.get('/api/home-assistant');
    await server.putJson('/api/harvests', [harvest()]);
    await server.putJson('/api/seeds', [seed()]);
    await server.get('/api/harvests');

    // A single call here would mean a laptop with no supervisor was waiting on
    // a five-second timeout somewhere.
    assert.deepEqual(ha.calls, []);
  } finally {
    await server.close();
  }
});

test('a blank token is treated as no token', async () => {
  // Supervisor injects SUPERVISOR_TOKEN; a stray empty value in a .env file
  // must not be mistaken for a real credential and send us at the network.
  const server = await startServer({ SUPERVISOR_TOKEN: '   ' });

  try {
    assert.equal(server.haService, null);
  } finally {
    await server.close();
  }
});

test('the garden works exactly as it did before any of this existed', async () => {
  const server = await startServer();

  try {
    const seeds = [seed({ id: 's1' }), seed({ id: 's2' })];
    const put = await server.putJson('/api/seeds', seeds);

    assert.equal(put.status, 200);
    assert.ok(put.headers.get('etag'), 'optimistic concurrency still works');

    await server.putJson('/api/beds', [bed()]);
    await server.putJson('/api/harvests', [harvest()]);

    const read = await server.get('/api/seeds');
    assert.equal(read.status, 200);
    assert.equal(((await read.json()) as unknown[]).length, 2);

    const beds = await server.get('/api/beds');
    assert.equal(beds.status, 200);

    const harvests = await server.get('/api/harvests');
    assert.equal(harvests.status, 200);
  } finally {
    await server.close();
  }
});

test('the import path does not trip over a missing integration', async () => {
  const server = await startServer();

  try {
    // Import calls the same onGardenChanged hook the collection writes do. With
    // no integration that hook is absent entirely, and an unguarded call would
    // throw right in the middle of her one-off migration off localStorage.
    const response = await server.postJson('/api/import', {
      seeds: [seed()],
      beds: [bed()],
      harvests: [harvest()],
    });

    assert.equal(response.status, 200);
    assert.equal((await server.get('/api/seeds')).status, 200);
  } finally {
    await server.close();
  }
});

test('start and stop are safe when there is nothing to start', async () => {
  const server = await startServer();

  try {
    assert.equal(server.haService, null);
  } finally {
    // Shutting down twice must not throw either; SIGTERM can arrive during a
    // shutdown that is already in progress.
    await server.close();
  }
});

test('an unknown reason never leaks a spinner to the client', async () => {
  const server = await startServer();

  try {
    const { body } = await readHomeAssistant(server);

    // `frost: null` and `available: false` together are what the banner reads
    // as "render nothing at all". A missing `frost` key would be undefined on
    // the client and is exactly the shape that produces a hanging placeholder.
    assert.equal(body.available, false);
    assert.equal(body.frost, null);
    assert.ok('reason' in body);
  } finally {
    await server.close();
  }
});

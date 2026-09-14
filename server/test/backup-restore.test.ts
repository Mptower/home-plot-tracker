/**
 * `POST /api/restore` — the dangerous one.
 *
 * Four properties are load-bearing here, and each is worth more than the
 * feature's convenience:
 *
 * 1. It is **atomic**. A half-applied restore is worse than a failed one.
 * 2. It takes a **safety copy first**, and that copy can be put back.
 * 3. It **refuses bad input by name**, never partially.
 * 4. A second device holding stale ETags **cannot silently undo it**.
 *
 * The fourth is the subtle one, and the last three tests in this file exist for
 * it specifically.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  GardenBackupDocument,
  HarvestLog,
  RestoreResultBody,
  SafetyCopySummary,
  SeedPacket,
} from '@hpt/shared';
import { bed, harvest, seed, startServer } from './helpers.ts';
import type { TestServer } from './helpers.ts';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from '../src/backup/document.ts';
import { MAX_SAFETY_COPIES } from '../src/db/snapshots.ts';

/** Her actual garden, as it stands on her Home Assistant today. */
const HER_SEED = seed({
  id: 'seed_cherry_tomato',
  category: 'Leafy Green',
  variety: 'Cherry Tomato',
  brand: '',
  purchaseYear: 2026,
  notes: '',
});

const HER_BED = bed({
  id: 'bed_tomato',
  name: 'Tomato bed',
  rows: 3,
  columns: 6,
  layout: [
    ['Cherry Tomato', null, null, null, null, null],
    [null, null, null, null, null, null],
    [null, null, null, null, null, null],
  ],
  lastYearCategory: '',
});

const HER_HARVEST = harvest({
  id: 'harvest_2026_09_04_tomato',
  date: '2026-09-04',
  variety: 'Tomato',
  weightLbs: 0,
  count: 10,
});

function document(overrides: Partial<GardenBackupDocument> = {}): GardenBackupDocument {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: '2026-09-14T16:05:00.000Z',
    counts: { seeds: 1, beds: 1, harvests: 1 },
    seeds: [HER_SEED],
    beds: [HER_BED],
    harvests: [HER_HARVEST],
    ...overrides,
  };
}

/** Puts something in the garden that a restore will have to displace. */
async function seedSomethingElse(server: TestServer): Promise<void> {
  assert.equal((await server.putJson('/api/seeds', [seed({ id: 'seed_old' })])).status, 200);
  assert.equal((await server.putJson('/api/beds', [bed({ id: 'bed_old' })])).status, 200);
  assert.equal(
    (
      await server.putJson('/api/harvests', [
        harvest({ id: 'harvest_old_a' }),
        harvest({ id: 'harvest_old_b' }),
      ])
    ).status,
    200,
  );
}

async function readJson<T>(server: TestServer, pathname: string): Promise<T> {
  const response = await server.get(pathname);

  assert.equal(response.status, 200, `GET ${pathname}`);

  return (await response.json()) as T;
}

test('restore replaces the garden and reports what is actually in it', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);

  const response = await server.postJson('/api/restore', document());

  assert.equal(response.status, 200);

  const body = (await response.json()) as RestoreResultBody;

  assert.equal(body.mode, 'replace');
  assert.deepEqual(body.restored, { seeds: 1, beds: 1, harvests: 1 });
  assert.deepEqual(body.replaced, { seeds: 1, beds: 1, harvests: 2 });

  // The counts in the response must be what an independent read finds — not a
  // restatement of the file we were handed. A restore that silently wrote
  // nothing would echo the file's numbers just as confidently.
  assert.deepEqual(await readJson<SeedPacket[]>(server, '/api/seeds'), [HER_SEED]);
  assert.deepEqual(await readJson<HarvestLog[]>(server, '/api/harvests'), [HER_HARVEST]);
  assert.equal((await readJson<unknown[]>(server, '/api/beds')).length, body.restored.beds);
});

test('restore replaces rather than merges, so old rows do not linger', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);
  await server.postJson('/api/restore', document());

  const harvests = await readJson<HarvestLog[]>(server, '/api/harvests');

  // The two pre-existing harvests are gone, not merged in beside the restored
  // one. Merging during a recovery is how a season ends up with duplicated
  // harvests nobody can audit.
  assert.deepEqual(
    harvests.map((row) => row.id),
    ['harvest_2026_09_04_tomato'],
  );
});

test('restoring into an empty garden works — the disaster case', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  // Exactly the situation this feature exists for: `/data` was deleted, the
  // add-on came back with nothing, and she has a file.
  const response = await server.postJson('/api/restore', document());

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson<SeedPacket[]>(server, '/api/seeds'), [HER_SEED]);
});

test('a bare ha-tools snapshot restores with no conversion', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  // The shape `session-state/.../ha-tools/export-garden.mjs` emits: three
  // collections, no envelope, no `format`, no `exportedAt`. These files are
  // currently the only copies of her garden anybody is certain exist, so this
  // test is the difference between them being usable by her and usable only by
  // the person with the script.
  const bare = { seeds: [HER_SEED], beds: [HER_BED], harvests: [HER_HARVEST] };

  const response = await server.postJson('/api/restore', bare);

  assert.equal(response.status, 200);

  const body = (await response.json()) as RestoreResultBody;

  assert.deepEqual(body.restored, { seeds: 1, beds: 1, harvests: 1 });
  assert.equal(body.settingsRestored, false, 'a bare snapshot carries no settings');
  assert.deepEqual(await readJson<SeedPacket[]>(server, '/api/seeds'), [HER_SEED]);
});

test('a missing format marker is not treated as a wrong one', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  /*
   * A file that says nothing about its format is read on its merits; a file
   * that claims a different format is contradicted by name. Collapsing the two
   * would tell the maintainer's bare snapshots — the oldest copies of this
   * garden anybody is certain exist — that they "are not a Home Plot Tracker
   * backup", which is both false and the one sentence that would stop her
   * restoring the only thing she has.
   *
   * The client refuses both of these before they are ever sent. This test is
   * the server's own answer, because `POST /api/restore` is reachable directly
   * from a script and does not get to assume a browser ran first.
   */
  const silent = await server.postJson('/api/restore', {
    seeds: [HER_SEED],
    beds: [HER_BED],
    harvests: [HER_HARVEST],
  });

  assert.equal(silent.status, 200);

  const wrong = await server.postJson('/api/restore', {
    format: 'some-other-app.export',
    seeds: [HER_SEED],
    beds: [HER_BED],
    harvests: [HER_HARVEST],
  });

  assert.equal(wrong.status, 422);

  const body = (await wrong.json()) as { error: string; message: string };

  assert.equal(body.error, 'unsupported_backup');
  assert.match(body.message, /some-other-app\.export/);
  assert.match(body.message, /not a Home Plot Tracker backup/);

  // The refused file changed nothing, so the garden is still the one the silent
  // file put there.
  assert.deepEqual(await readJson<SeedPacket[]>(server, '/api/seeds'), [HER_SEED]);
});

test('a file without settings leaves her existing settings alone', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putRaw('/api/settings', {
    frostNotifications: true,
    quietHoursStart: '23:00',
    quietHoursEnd: '05:00',
  });

  await server.postJson('/api/restore', document());

  // Restoring a garden must not quietly switch her frost warnings off.
  assert.deepEqual(await readJson(server, '/api/settings'), {
    frostNotifications: true,
    quietHoursStart: '23:00',
    quietHoursEnd: '05:00',
  });
});

test('a file with settings restores them too', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.postJson(
    '/api/restore',
    document({
      settings: { frostNotifications: true, quietHoursStart: '21:45', quietHoursEnd: '07:15' },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as RestoreResultBody).settingsRestored, true);
  assert.deepEqual(await readJson(server, '/api/settings'), {
    frostNotifications: true,
    quietHoursStart: '21:45',
    quietHoursEnd: '07:15',
  });
});

test('one corrupt record fails the whole restore and changes nothing', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);

  const before = await readJson<HarvestLog[]>(server, '/api/harvests');

  const response = await server.postJson(
    '/api/restore',
    document({
      harvests: [HER_HARVEST, { ...harvest({ id: 'harvest_bad' }), date: 'sometime in August' }],
    }),
  );

  assert.equal(response.status, 400);

  const body = (await response.json()) as { error: string; issues: { path: string }[] };

  assert.equal(body.error, 'validation_failed');
  assert.ok(
    body.issues.some((issue) => issue.path === 'file.harvests[1].date'),
    `the bad field should name itself: ${JSON.stringify(body.issues)}`,
  );

  // Not one row of the good data was applied. This is the property that makes
  // a failed restore recoverable rather than a second disaster.
  assert.deepEqual(await readJson<HarvestLog[]>(server, '/api/harvests'), before);
});

test('a failed restore leaves no safety copy behind', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);
  // Cast deliberately: the point of the test is a payload the type system would
  // never let the client construct, which is exactly what a hand-edited file is.
  await server.postJson('/api/restore', {
    ...document(),
    seeds: [{ ...HER_SEED, purchaseYear: 'no' }],
  } as unknown as GardenBackupDocument);

  const status = await readJson<{ safetyCopies: SafetyCopySummary[] }>(
    server,
    '/api/backup/status',
  );

  // Nothing needed saving from, because nothing happened. A safety copy for a
  // restore that never ran would be clutter she has to reason about at exactly
  // the wrong moment.
  assert.deepEqual(status.safetyCopies, []);
});

test('a file from a newer version is refused by name, not as a validation error', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.postJson(
    '/api/restore',
    document({ formatVersion: BACKUP_FORMAT_VERSION + 1 }),
  );

  assert.equal(response.status, 422);

  const body = (await response.json()) as { error: string; message: string };

  assert.equal(body.error, 'unsupported_backup');
  // The words matter as much as the code. Telling her a file "has a problem"
  // when it was written by a newer app sends her editing JSON to fix something
  // that was never broken.
  assert.match(body.message, /newer version/i);
  assert.match(body.message, /Nothing has been changed/i);
});

test('someone else’s JSON file is refused by name', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);

  const response = await server.postJson('/api/restore', {
    format: 'some-other-app.export',
    seeds: [],
    beds: [],
    harvests: [],
  });

  assert.equal(response.status, 422);

  const body = (await response.json()) as { error: string; message: string };

  assert.equal(body.error, 'unsupported_backup');
  assert.match(body.message, /not a Home Plot Tracker backup/i);
  assert.equal((await readJson<SeedPacket[]>(server, '/api/seeds')).length, 1);
});

test('a JSON file that is not a garden says so, rather than listing missing fields', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.postJson('/api/restore', {
    name: 'home-plot-tracker',
    version: '0.4.0',
    dependencies: {},
  });

  assert.equal(response.status, 400);

  const body = (await response.json()) as { issues: { path: string; message: string }[] };

  // One sentence she can act on, not three "required field is missing" lines
  // that leave her unsure whether she opened the wrong file or her garden is
  // damaged.
  assert.equal(body.issues.length, 1);
  assert.match(body.issues[0]!.message, /no seeds, beds or harvests/i);
});

test('a file missing one collection is refused — absent is not empty', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const { harvests: _omitted, ...withoutHarvests } = document();
  const response = await server.postJson('/api/restore', withoutHarvests);

  assert.equal(response.status, 400);

  const body = (await response.json()) as { issues: { path: string }[] };

  // Deliberately not treated as "restore an empty harvest log". A restore
  // replaces everything, so guessing here is the difference between keeping a
  // season of records and deleting them.
  assert.ok(body.issues.some((issue) => issue.path === 'file.harvests'));
});

test('a file with an unreadable settings block fails the whole restore', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);

  const response = await server.postJson(
    '/api/restore',
    document({
      settings: { frostNotifications: true, quietHoursStart: '9pm', quietHoursEnd: '07:15' },
    }),
  );

  assert.equal(response.status, 400);

  // Applying the garden and quietly dropping the settings would be a partial
  // restore, which is the one outcome this feature promises never to produce.
  assert.equal((await readJson<SeedPacket[]>(server, '/api/seeds'))[0]?.id, 'seed_old');
});

test('a lying counts block is ignored, not obeyed', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.postJson(
    '/api/restore',
    document({ counts: { seeds: 99, beds: 99, harvests: 99 } }),
  );

  assert.equal(response.status, 200);

  // `counts` is advisory: it exists so a person reading the file knows what is
  // in it. The restore counts the arrays itself, so a hand-edited number just
  // becomes wrong rather than becoming dangerous.
  assert.deepEqual(((await response.json()) as RestoreResultBody).restored, {
    seeds: 1,
    beds: 1,
    harvests: 1,
  });
});

test('a restore takes a safety copy that can be put back', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);

  const before = await readJson<HarvestLog[]>(server, '/api/harvests');

  const restore = (await (
    await server.postJson('/api/restore', document())
  ).json()) as RestoreResultBody;

  assert.equal(restore.safetyCopy.reason, 'pre-restore');
  assert.deepEqual(restore.safetyCopy.counts, { seeds: 1, beds: 1, harvests: 2 });

  // The undo: fetch the copy as a file and post it straight back. It is the
  // same document shape an export emits, which is what makes this possible with
  // no conversion step anywhere.
  const copy = await server.get(`/api/backup/safety-copies/${restore.safetyCopy.id}`);

  assert.equal(copy.status, 200);
  assert.match(copy.headers.get('content-disposition') ?? '', /before-restore\.json"$/);

  const undo = await server.postJson('/api/restore', JSON.parse(await copy.text()));

  assert.equal(undo.status, 200);
  assert.deepEqual(await readJson<HarvestLog[]>(server, '/api/harvests'), before);
});

test('safety copies are listed newest first and pruned to a sensible number', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  for (let index = 0; index < MAX_SAFETY_COPIES + 3; index += 1) {
    const response = await server.postJson(
      '/api/restore',
      document({ seeds: [seed({ id: `seed_${index}` })] }),
    );

    assert.equal(response.status, 200);
  }

  const status = await readJson<{ safetyCopies: SafetyCopySummary[] }>(
    server,
    '/api/backup/status',
  );

  assert.equal(status.safetyCopies.length, MAX_SAFETY_COPIES);

  const ids = status.safetyCopies.map((copy) => copy.id);

  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'newest first');
});

test('a pruned or invented safety copy 404s in words she can act on', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const missing = await server.get('/api/backup/safety-copies/9999');

  assert.equal(missing.status, 404);
  assert.match(((await missing.json()) as { message: string }).message, /pruned|no safety copy/i);

  const nonsense = await server.get('/api/backup/safety-copies/banana');

  assert.equal(nonsense.status, 400);
});

/* -------------------------------------------------------------------------- */
/* The stale second device                                                     */
/* -------------------------------------------------------------------------- */

test('a restore voids every open tab’s ETag', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);

  // Her laptop has the harvests view open and is holding this version.
  const laptopTag = await server.etag('/api/harvests');

  await server.postJson('/api/restore', document());

  // She edits on the laptop and saves. The precondition it was holding no
  // longer matches, so the write is refused rather than applied.
  const write = await server.putRaw('/api/harvests', [harvest({ id: 'harvest_typed_on_laptop' })], {
    'If-Match': laptopTag,
  });

  assert.equal(write.status, 409);

  const conflict = (await write.json()) as { collection: string; current: HarvestLog[] };

  // And the 409 carries the *restored* rows, so the client has what it needs to
  // reconcile in one round trip.
  assert.equal(conflict.collection, 'harvests');
  assert.deepEqual(conflict.current, [HER_HARVEST]);
});

test('a restore bumps versions even when a collection’s contents did not change', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);

  const current = await readJson<{ seeds: SeedPacket[] }>(server, '/api/export');
  const laptopTag = await server.etag('/api/seeds');

  // Restore a file whose seeds are byte-identical to what is already stored.
  const response = await server.postJson('/api/restore', {
    ...current,
    harvests: [],
  });

  assert.equal(response.status, 200);

  // This is the whole reason the bump is unconditional. With a "only bump if
  // something changed" optimisation, seeds would still be at the laptop's
  // version, the laptop's next save would match, and her pre-restore seeds
  // would go silently back in — undoing a restore nobody would ever know had
  // been undone.
  const write = await server.putRaw('/api/seeds', [seed({ id: 'seed_stale' })], {
    'If-Match': laptopTag,
  });

  assert.equal(write.status, 409, 'an unchanged collection must still void old ETags');
});

test('a stale write that lands before a restore still loses to it', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);

  // The other ordering: the laptop saves first, then the restore lands. SQLite
  // takes one writer at a time, so there is no interleaving — the restore sees
  // a committed garden and replaces it whole.
  assert.equal((await server.putJson('/api/seeds', [seed({ id: 'seed_laptop' })])).status, 200);

  const response = await server.postJson('/api/restore', document());

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson<SeedPacket[]>(server, '/api/seeds'), [HER_SEED]);
});

test('restore hands back the new versions, so the restoring device can write on', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedSomethingElse(server);

  const body = (await (
    await server.postJson('/api/restore', document())
  ).json()) as RestoreResultBody;

  // Without this she would have to reload before her next edit — on the one
  // screen where an unexpected conflict dialog would be most alarming.
  for (const collection of ['seeds', 'beds', 'harvests'] as const) {
    assert.equal(body.versions[collection], await server.etag(`/api/${collection}`));
  }

  const write = await server.putRaw('/api/seeds', [HER_SEED, seed({ id: 'seed_added_after' })], {
    'If-Match': body.versions.seeds,
  });

  assert.equal(write.status, 200);
});

test('restore does not disturb the frost notifier’s bookkeeping', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const before = server.db.prepare('SELECT key, value FROM ha_state').all();

  await server.postJson('/api/restore', document({ settings: undefined }));

  // Traced, not assumed. `decideNotification` returns `nothing_at_risk` before
  // it ever loads this state, and `recordNotification` only runs after a real
  // send — so a night with nothing tender planted leaves no record to suppress
  // a post-restore warning. Clearing the table would instead re-alarm her about
  // a night she has already covered her beds for.
  assert.deepEqual(server.db.prepare('SELECT key, value FROM ha_state').all(), before);
});

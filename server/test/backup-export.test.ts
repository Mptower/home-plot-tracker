/**
 * `GET /api/export` — the file she can keep.
 *
 * The thing under test is not really "does it return JSON". It is: does the
 * file contain everything, does it contain *only* things that are safe to
 * email, and can a person open it and read it. Those are the three properties
 * that decide whether this feature is worth having.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { GardenBackupDocument } from '@hpt/shared';
import { bed, harvest, seed, startServer } from './helpers.ts';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupFilename,
  prettyJson,
} from '../src/backup/document.ts';

/**
 * Her actual garden, as it stands on her Home Assistant today.
 *
 * Used as the fixture in preference to anything invented, because it is the
 * shape real data takes rather than the shape a test author reaches for: one
 * seed filed under a category that is plainly wrong but perfectly valid, a bed
 * that is mostly empty with no `lastYearCategory`, and a harvest recorded by
 * count with no weight. A backup feature that only handles tidy data is not a
 * backup feature.
 */
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

async function seedHerGarden(server: Awaited<ReturnType<typeof startServer>>): Promise<void> {
  assert.equal((await server.putJson('/api/seeds', [HER_SEED])).status, 200);
  assert.equal((await server.putJson('/api/beds', [HER_BED])).status, 200);
  assert.equal((await server.putJson('/api/harvests', [HER_HARVEST])).status, 200);
}

test('export returns the whole garden, with a format marker and a timestamp', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedHerGarden(server);

  const before = Date.now();
  const response = await server.get('/api/export');
  const after = Date.now();

  assert.equal(response.status, 200);

  const text = await response.text();
  const document = JSON.parse(text) as GardenBackupDocument;

  assert.equal(document.format, BACKUP_FORMAT);
  assert.equal(document.formatVersion, BACKUP_FORMAT_VERSION);
  assert.deepEqual(document.seeds, [HER_SEED]);
  assert.deepEqual(document.beds, [HER_BED]);
  assert.deepEqual(document.harvests, [HER_HARVEST]);

  // Bracketed rather than frozen: this proves the timestamp is the real clock
  // at the moment of the request, which a stubbed clock could not.
  const exportedAt = Date.parse(document.exportedAt ?? '');
  assert.ok(exportedAt >= before && exportedAt <= after, `exportedAt ${document.exportedAt}`);
});

test('export names every top-level key deliberately, so a secret cannot drift in', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedHerGarden(server);

  const document = (await (await server.get('/api/export')).json()) as GardenBackupDocument;

  // Asserted as an exact set rather than "does not contain a token". A future
  // field that carries something private would slip past a denylist; it cannot
  // slip past this, because adding a key fails the test and makes somebody
  // decide on purpose whether it belongs in a file she might email.
  assert.deepEqual(Object.keys(document).sort(), [
    'beds',
    'counts',
    'exportedAt',
    'format',
    'formatVersion',
    'harvests',
    'seeds',
    'settings',
  ]);

  const text = JSON.stringify(document).toLowerCase();

  for (const forbidden of ['supervisor', 'token', 'weather_entity', 'notify_service', 'password']) {
    assert.ok(!text.includes(forbidden), `export must not mention ${forbidden}`);
  }
});

test('export includes her settings but not the add-on options', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await server.putRaw('/api/settings', {
    frostNotifications: true,
    quietHoursStart: '22:30',
    quietHoursEnd: '06:15',
  });

  const document = (await (await server.get('/api/export')).json()) as GardenBackupDocument;

  assert.deepEqual(document.settings, {
    frostNotifications: true,
    quietHoursStart: '22:30',
    quietHoursEnd: '06:15',
  });
});

test('export offers itself as a dated file download', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const response = await server.get('/api/export');
  const disposition = response.headers.get('content-disposition') ?? '';

  // `Content-Disposition` from the server, not an `<a download>` attribute:
  // Home Assistant's companion app renders ingress in a native WebView, and a
  // plain http(s) URL carrying its own filename is what survives being handed
  // to a platform download manager.
  assert.match(disposition, /^attachment; filename="home-plot-tracker-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('an exported empty garden is still a valid file', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const document = (await (await server.get('/api/export')).json()) as GardenBackupDocument;

  assert.deepEqual(document.counts, { seeds: 0, beds: 0, harvests: 0 });
  assert.deepEqual(document.seeds, []);

  // It restores, too. "Nothing yet" is a legitimate state to save and return
  // to, and a file that refuses to load because the garden was empty when it
  // was taken would be a trap.
  const restored = await server.postJson('/api/restore', document);
  assert.equal(restored.status, 200);
});

test('the file is readable by a person, and a bed layout keeps its shape', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedHerGarden(server);

  const text = await (await server.get('/api/export')).text();

  // Indented, not one enormous line.
  assert.ok(text.includes('\n  "seeds": ['), 'top-level keys should be on their own lines');

  // The property that motivates the custom printer: each row of the bed is one
  // line, so the grid in the file looks like the grid in the app. At plain
  // two-space indent this bed would be 18 lines of `null,`.
  assert.ok(
    text.includes('["Cherry Tomato", null, null, null, null, null]'),
    `a bed row should stay on one line:\n${text}`,
  );

  assert.ok(text.endsWith('\n'), 'file should end with a newline');
});

test('pretty-printing round-trips anything JSON.stringify would accept', () => {
  const awkward = {
    quote: 'she said "tomato"',
    newline: 'line one\nline two',
    bracket: ']}',
    unicode: 'Ährenkranz 🌱 日本',
    controls: '\u0000\u001f',
    empty: {},
    emptyArray: [],
    nested: [[1, 2], [3]],
    mixed: [1, { a: 2 }, null],
    holes: [null, null],
    zero: 0,
    negative: -1.5,
    yes: true,
    nothing: null,
  };

  assert.deepEqual(JSON.parse(prettyJson(awkward)), awkward);
});

test('pretty-printing matches JSON.stringify on undefined, which never round-trips', () => {
  // `undefined` cannot appear in parsed JSON, but it can appear in an object
  // built in TypeScript from an optional field. The printer must agree with
  // `JSON.stringify` about it — drop the key in an object, write `null` in an
  // array — or the file would not parse back to what was exported.
  assert.equal(prettyJson({ a: 1, b: undefined }).trim(), '{\n  "a": 1\n}');
  assert.equal(prettyJson([1, undefined, 2]).trim(), '[1, null, 2]');
});

test('the filename is the day the copy was taken', () => {
  assert.equal(backupFilename('2026-09-14T16:05:00.000Z'), 'home-plot-tracker-2026-09-14.json');
  // Never throws on a timestamp it does not recognise: a filename is not worth
  // failing an export over.
  assert.equal(backupFilename('not a date'), 'home-plot-tracker-export.json');
});

test('export records when a copy was last saved, but only once the file is fully sent', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const before = (await (await server.get('/api/backup/status')).json()) as {
    lastExportAt: string | null;
  };

  assert.equal(before.lastExportAt, null, 'a fresh install has never saved a copy');

  // Read to completion, which is what makes the `finish` handler fire.
  await (await server.get('/api/export')).text();

  const after = (await (await server.get('/api/backup/status')).json()) as {
    lastExportAt: string | null;
  };

  assert.ok(after.lastExportAt, 'saving a copy should be remembered');
  assert.ok(Date.parse(after.lastExportAt) > 0);
});

test('backup status reports what a copy would contain', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  await seedHerGarden(server);

  const status = (await (await server.get('/api/backup/status')).json()) as {
    counts: Record<string, number>;
    safetyCopies: unknown[];
  };

  assert.deepEqual(status.counts, { seeds: 1, beds: 1, harvests: 1 });
  assert.deepEqual(status.safetyCopies, [], 'no restore has happened yet');
});

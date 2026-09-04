/**
 * Transaction behaviour at the storage layer.
 *
 * The HTTP tests prove that a *rejected* payload never reaches the database.
 * These prove the layer underneath: that if a write fails part-way through —
 * after the `DELETE` but before the last `INSERT` — the collection is left
 * exactly as it was, rather than empty or half-populated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SeedPacket } from '@hpt/shared';
import { openDatabase, withTransaction } from '../src/db/open.ts';
import { runMigrations } from '../src/db/migrate.ts';
import {
  listBeds,
  listHarvests,
  listSeeds,
  replaceBeds,
  replaceHarvests,
  replaceSeeds,
} from '../src/db/collections.ts';
import { bed, harvest, seed } from './helpers.ts';

function freshDatabase(): ReturnType<typeof openDatabase> {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

test('a replace that fails half way leaves the previous collection intact', () => {
  const db = freshDatabase();
  const original = [seed({ id: 'a' }), seed({ id: 'b' })];

  withTransaction(db, () => replaceSeeds(db, original));
  assert.deepEqual(listSeeds(db).map((item) => item.id), ['a', 'b']);

  // Two rows sharing a primary key: the DELETE and the first INSERT succeed,
  // the second INSERT violates the constraint. Validation would normally catch
  // this at the edge, which is exactly why it is forced in directly here.
  const conflicting: SeedPacket[] = [seed({ id: 'c' }), seed({ id: 'c' })];

  assert.throws(() => {
    withTransaction(db, () => replaceSeeds(db, conflicting));
  }, /UNIQUE|PRIMARY KEY|constraint/i);

  assert.deepEqual(
    listSeeds(db).map((item) => item.id),
    ['a', 'b'],
    'the rollback must restore the rows the DELETE removed',
  );

  db.close();
});

test('a throw from inside the transaction body also rolls back', () => {
  const db = freshDatabase();
  withTransaction(db, () => replaceHarvests(db, [harvest({ id: 'keep' })]));

  assert.throws(() => {
    withTransaction(db, () => {
      replaceHarvests(db, [harvest({ id: 'gone' })]);
      throw new Error('something went wrong after the write');
    });
  }, /something went wrong/);

  assert.deepEqual(listHarvests(db).map((item) => item.id), ['keep']);

  db.close();
});

test('a multi-collection failure rolls back every collection', () => {
  const db = freshDatabase();

  withTransaction(db, () => {
    replaceSeeds(db, [seed({ id: 'seed_before' })]);
    replaceBeds(db, [bed({ id: 'bed_before' })]);
    replaceHarvests(db, [harvest({ id: 'harvest_before' })]);
  });

  assert.throws(() => {
    withTransaction(db, () => {
      replaceSeeds(db, [seed({ id: 'seed_after' })]);
      replaceBeds(db, [bed({ id: 'bed_after' })]);
      // Fails last, once the other two collections have already been rewritten.
      replaceHarvests(db, [harvest({ id: 'dup' }), harvest({ id: 'dup' })]);
    });
  });

  assert.deepEqual(listSeeds(db).map((item) => item.id), ['seed_before']);
  assert.deepEqual(listBeds(db).map((item) => item.id), ['bed_before']);
  assert.deepEqual(listHarvests(db).map((item) => item.id), ['harvest_before']);

  db.close();
});

test('the transaction is closed after a rollback, so the next write works', () => {
  const db = freshDatabase();

  assert.throws(() => {
    withTransaction(db, () => {
      replaceSeeds(db, [seed({ id: 'x' }), seed({ id: 'x' })]);
    });
  });

  // If ROLLBACK had not run, this would fail with "cannot start a transaction
  // within a transaction".
  withTransaction(db, () => replaceSeeds(db, [seed({ id: 'later' })]));
  assert.deepEqual(listSeeds(db).map((item) => item.id), ['later']);

  db.close();
});

test('withTransaction returns the value its body produced', () => {
  const db = freshDatabase();

  const count = withTransaction(db, () => {
    replaceSeeds(db, [seed({ id: 'a' }), seed({ id: 'b' })]);
    return listSeeds(db).length;
  });

  assert.equal(count, 2);

  db.close();
});

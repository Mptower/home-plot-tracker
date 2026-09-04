/**
 * Configuration, and in particular where the database ends up.
 *
 * The deployment target is a Home Assistant add-on, where `/data` is the
 * persistent volume that HA's backups snapshot. Putting the database anywhere
 * else means the backups quietly contain no garden, which is the kind of thing
 * you discover only when you need the backup, so it is worth a test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CONFIG_DEFAULTS, ConfigError, DATABASE_FILENAME, loadConfig } from '../src/config.ts';
import { openDatabase } from '../src/db/open.ts';

test('the database lives inside DATA_DIR by default', () => {
  const config = loadConfig({ DATA_DIR: '/data' });

  assert.equal(config.dataDir, path.resolve('/data'));
  assert.equal(config.databasePath, path.join(path.resolve('/data'), DATABASE_FILENAME));
});

test('DATA_DIR defaults to ./data for local development', () => {
  const config = loadConfig({});

  assert.equal(CONFIG_DEFAULTS.DATA_DIR, 'data');
  assert.equal(config.dataDir, path.resolve(process.cwd(), 'data'));
  assert.equal(config.databasePath, path.join(path.resolve(process.cwd(), 'data'), DATABASE_FILENAME));
});

test('DATABASE_PATH overrides DATA_DIR outright', () => {
  const config = loadConfig({ DATA_DIR: '/data', DATABASE_PATH: '/elsewhere/other.db' });

  assert.equal(config.dataDir, path.resolve('/data'));
  assert.equal(config.databasePath, path.resolve('/elsewhere/other.db'));
});

test('DATA_DIR is created on boot if it does not exist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hpt-datadir-'));
  const dataDir = path.join(root, 'deeply', 'nested', 'data');

  try {
    const config = loadConfig({ DATA_DIR: dataDir });
    assert.ok(!fs.existsSync(dataDir), 'the directory should not exist yet');

    const db = openDatabase(config.databasePath);
    db.close();

    assert.ok(fs.existsSync(dataDir), 'opening the database creates DATA_DIR');
    assert.ok(fs.existsSync(path.join(dataDir, DATABASE_FILENAME)), 'and the database inside it');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a nonsense BASE_PATH is rejected rather than silently ignored', () => {
  assert.throws(() => loadConfig({ BASE_PATH: 'http://evil.example/' }), ConfigError);
});

test('BASE_PATH normalises to the form Express mounts want', () => {
  assert.equal(loadConfig({ BASE_PATH: '/' }).basePath, '');
  assert.equal(loadConfig({ BASE_PATH: '/garden/' }).basePath, '/garden');
  assert.equal(loadConfig({ BASE_PATH: 'garden' }).basePath, '/garden');
});

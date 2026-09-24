import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_SETTINGS, SettingsStore, sanitizeSettings } from '../src/main/settings.js';

describe('sanitizeSettings', () => {
  it('returns defaults for junk input', () => {
    assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(sanitizeSettings('nope'), DEFAULT_SETTINGS);
  });

  it('keeps valid values and rejects invalid ones', () => {
    assert.deepEqual(sanitizeSettings({ x: 10, y: -20, pinned: false, compact: true, intervalSec: 120 }), {
      x: 10,
      y: -20,
      pinned: false,
      compact: true,
      intervalSec: 120,
    });
    assert.deepEqual(sanitizeSettings({ x: 1.5, y: '3', pinned: 'yes', intervalSec: 1 }), DEFAULT_SETTINGS);
  });
});

describe('SettingsStore', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cswap-ui-settings-'));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it('falls back to defaults when the file is missing or corrupt', async () => {
    const file = path.join(dir, 'corrupt.json');
    await writeFile(file, '{ not json');
    assert.deepEqual(await new SettingsStore(file).load(), DEFAULT_SETTINGS);
    assert.deepEqual(await new SettingsStore(path.join(dir, 'missing.json')).load(), DEFAULT_SETTINGS);
  });

  it('persists updates and reloads them', async () => {
    const file = path.join(dir, 'nested', 'settings.json');
    const store = new SettingsStore(file);
    await store.load();
    store.update({ compact: true, x: 100, y: 200 });
    store.update({ intervalSec: 300 });
    await store.flush();

    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(saved, { ...DEFAULT_SETTINGS, compact: true, x: 100, y: 200, intervalSec: 300 });
    assert.deepEqual(await new SettingsStore(file).load(), saved);
  });

  it('sanitizes updates', async () => {
    const store = new SettingsStore(path.join(dir, 'sanitize.json'));
    await store.load();
    assert.equal(store.update({ intervalSec: 5 }).intervalSec, DEFAULT_SETTINGS.intervalSec);
    await store.flush();
  });
});

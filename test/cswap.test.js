import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  CswapError,
  CswapSource,
  configSnapshotPath,
  parseListOutput,
  resolveBackupRoot,
} from '../src/main/cswap.js';

const listPayload = (accounts, extra = {}) => JSON.stringify({ schemaVersion: 1, activeAccountNumber: 1, accounts, ...extra });

describe('parseListOutput', () => {
  it('returns accounts and the active slot', () => {
    const out = parseListOutput(listPayload([{ number: 1, email: 'a@example.com' }]));
    assert.equal(out.activeAccountNumber, 1);
    assert.equal(out.accounts.length, 1);
  });

  it('drops malformed account rows', () => {
    const out = parseListOutput(listPayload([{ number: 1 }, null, { number: 'x' }, 'junk']));
    assert.deepEqual(out.accounts, [{ number: 1 }]);
  });

  it('surfaces cswap error envelopes', () => {
    const stdout = JSON.stringify({ schemaVersion: 1, error: { type: 'ClaudeSwitchError', message: 'no accounts' } });
    assert.throws(() => parseListOutput(stdout), { name: 'CswapError', message: 'no accounts' });
  });

  it('rejects invalid JSON, unknown schemas and missing accounts', () => {
    assert.throws(() => parseListOutput('not json'), CswapError);
    assert.throws(() => parseListOutput(listPayload([], { schemaVersion: 2 })), /Unsupported cswap JSON schema/);
    assert.throws(() => parseListOutput(JSON.stringify({ schemaVersion: 1 })), /missing the accounts list/);
  });
});

describe('configSnapshotPath', () => {
  const dir = path.join(os.tmpdir(), 'configs');

  it('builds the cswap snapshot file name', () => {
    assert.equal(
      configSnapshotPath(dir, { number: 2, email: 'a@example.com' }),
      path.join(dir, '.claude-config-2-a@example.com.json'),
    );
  });

  it('refuses identifiers that could escape the directory', () => {
    assert.equal(configSnapshotPath(dir, { number: 1, email: '../../evil' }), null);
    assert.equal(configSnapshotPath(dir, { number: 1, email: 'a/b@example.com' }), null);
    assert.equal(configSnapshotPath(dir, { number: 1, email: 'a\\b@example.com' }), null);
    assert.equal(configSnapshotPath(dir, { number: '1', email: 'a@example.com' }), null);
    assert.equal(configSnapshotPath(dir, { number: 1, email: '' }), null);
  });
});

describe('resolveBackupRoot', () => {
  const home = path.resolve('/home/alex');

  it('honours CSWAP_BACKUP_DIR', () => {
    assert.equal(resolveBackupRoot({ env: { CSWAP_BACKUP_DIR: '/custom' }, platform: 'win32', home }), '/custom');
  });

  it('uses the legacy directory on Windows and macOS', () => {
    for (const platform of ['win32', 'darwin']) {
      assert.equal(resolveBackupRoot({ env: {}, platform, home }), path.join(home, '.claude-swap-backup'));
    }
  });

  it('follows XDG on Linux', () => {
    assert.equal(resolveBackupRoot({ env: {}, platform: 'linux', home }), path.join(home, '.local', 'share', 'claude-swap'));
    const xdg = path.resolve('/data');
    assert.equal(resolveBackupRoot({ env: { XDG_DATA_HOME: xdg }, platform: 'linux', home }), path.join(xdg, 'claude-swap'));
    assert.equal(
      resolveBackupRoot({ env: { XDG_DATA_HOME: 'relative' }, platform: 'linux', home }),
      path.join(home, '.local', 'share', 'claude-swap'),
    );
  });
});

describe('CswapSource', () => {
  let dir;
  let fakeCswap;

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cswap-ui-test-'));
    await mkdir(path.join(dir, 'configs'));
    await writeFile(
      path.join(dir, 'configs', '.claude-config-1-a@example.com.json'),
      JSON.stringify({
        oauthAccount: {
          organizationType: 'claude_max',
          organizationRateLimitTier: 'default_claude_max_20x',
        },
      }),
    );
    fakeCswap = path.join(dir, 'fake-cswap.js');
    const accounts = [
      { number: 1, email: 'a@example.com', usageStatus: 'ok', usage: { fiveHour: { pct: 12 } } },
      { number: 2, email: 'b@example.com', usageStatus: 'ok', usage: { fiveHour: { pct: 34 } } },
    ];
    await writeFile(fakeCswap, `process.stdout.write(${JSON.stringify(listPayload(accounts))});`);
  });

  after(() => rm(dir, { recursive: true, force: true }));

  it('runs cswap and attaches plans from config snapshots', async () => {
    const source = new CswapSource({ binary: process.execPath, binaryArgs: [fakeCswap], backupRoot: dir });
    const snapshot = await source.fetch();
    assert.equal(snapshot.activeAccountNumber, 1);
    assert.equal(snapshot.accounts[0].plan.label, 'Max 20x');
    assert.equal(snapshot.accounts[1].plan, null, 'missing snapshot yields no plan');
    assert.ok(Number.isFinite(snapshot.fetchedAt));
  });

  it('explains a missing cswap binary', async () => {
    const source = new CswapSource({ binary: path.join(dir, 'does-not-exist'), backupRoot: dir });
    await assert.rejects(source.fetch(), { name: 'CswapError', message: /cswap was not found/ });
  });
});

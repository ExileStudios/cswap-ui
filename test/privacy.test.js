import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { demoSnapshot } from '../src/main/demo.js';
import { privateError, privateSnapshot } from '../src/main/privacy.js';
import { displayName, summarize } from '../src/shared/usage.js';

describe('privateSnapshot', () => {
  it('preserves normal mode and handles startup before the first snapshot', () => {
    const snapshot = demoSnapshot();
    assert.equal(privateSnapshot(snapshot, false), snapshot);
    assert.equal(privateSnapshot(null, true), null);
  });

  it('hides emails, aliases, and organizations while keeping usage and plans', () => {
    const snapshot = demoSnapshot();
    const original = structuredClone(snapshot);
    const hidden = privateSnapshot(snapshot, true);
    for (const [i, account] of hidden.accounts.entries()) {
      assert.equal(displayName(account), `Account ${account.number}`);
      assert.equal(account.email, null);
      assert.equal(account.organizationName, null);
      assert.deepEqual(account.usage, snapshot.accounts[i].usage);
      assert.deepEqual(account.lastGoodUsage, snapshot.accounts[i].lastGoodUsage);
      assert.deepEqual(account.plan, snapshot.accounts[i].plan);
    }
    assert.equal(hidden.activeAccountNumber, snapshot.activeAccountNumber);
    assert.equal(hidden.fetchedAt, snapshot.fetchedAt);
    assert.deepEqual(summarize(hidden.accounts), summarize(snapshot.accounts));
    assert.deepEqual(snapshot, original, 'toggling privacy must not alter cached account identities');
    assert.deepEqual(privateSnapshot(snapshot, false), original);
  });

  it('keeps slot labels stable when accounts are reordered or removed', () => {
    const snapshot = demoSnapshot();
    snapshot.accounts = [snapshot.accounts[3], snapshot.accounts[0]];
    assert.deepEqual(privateSnapshot(snapshot, true).accounts.map(displayName), ['Account 4', 'Account 1']);
  });
});

describe('privateError', () => {
  it('hides identifying CLI error details and restores them only outside privacy mode', () => {
    const error = 'Cannot read account alex@acme.example from /home/alex/.claude';
    assert.equal(privateError(error, true), 'Unable to read cswap usage. Turn off privacy mode to see error details.');
    assert.equal(privateError(error, false), error);
    assert.equal(privateError(null, true), null);
  });
});

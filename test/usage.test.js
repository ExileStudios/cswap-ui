import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accountStatus,
  clampPct,
  displayName,
  formatAgo,
  formatDuration,
  levelFor,
  limitsOf,
  msUntil,
  summarize,
  usageOf,
} from '../src/shared/usage.js';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const inHours = (h) => new Date(NOW + h * 3_600_000).toISOString();

const account = (usage, extra = {}) => ({ number: 1, email: 'a@example.com', usageStatus: 'ok', usage, ...extra });

describe('levelFor', () => {
  it('buckets by the warn and danger thresholds', () => {
    assert.equal(levelFor(0), 'ok');
    assert.equal(levelFor(69.9), 'ok');
    assert.equal(levelFor(70), 'warn');
    assert.equal(levelFor(90), 'danger');
    assert.equal(levelFor(100), 'danger');
  });
});

describe('clampPct', () => {
  it('clamps to 0..100 and treats junk as 0', () => {
    assert.equal(clampPct(-5), 0);
    assert.equal(clampPct(150), 100);
    assert.equal(clampPct('42'), 42);
    assert.equal(clampPct(undefined), 0);
    assert.equal(clampPct(NaN), 0);
  });
});

describe('formatDuration', () => {
  it('picks the two most significant units', () => {
    assert.equal(formatDuration(30_000), 'now');
    assert.equal(formatDuration(5 * 60_000), '5m');
    assert.equal(formatDuration((2 * 60 + 5) * 60_000), '2h 5m');
    assert.equal(formatDuration((3 * 24 + 4) * 3_600_000 + 59 * 60_000), '3d 4h');
  });

  it('handles invalid input', () => {
    assert.equal(formatDuration(NaN), 'now');
    assert.equal(formatDuration(-1), 'now');
  });
});

describe('formatAgo', () => {
  it('formats elapsed time', () => {
    assert.equal(formatAgo(2_000), 'just now');
    assert.equal(formatAgo(42_000), '42s ago');
    assert.equal(formatAgo(8 * 60_000), '8m ago');
    assert.equal(formatAgo(3 * 3_600_000), '3h ago');
    assert.equal(formatAgo(2 * 86_400_000), '2d ago');
  });
});

describe('msUntil', () => {
  it('returns remaining ms, never negative', () => {
    assert.equal(msUntil(inHours(1), NOW), 3_600_000);
    assert.equal(msUntil(inHours(-1), NOW), 0);
  });

  it('returns null for missing or invalid timestamps', () => {
    assert.equal(msUntil(undefined, NOW), null);
    assert.equal(msUntil('not a date', NOW), null);
  });
});

describe('displayName', () => {
  it('prefers alias, then email, then slot', () => {
    assert.equal(displayName({ number: 3, email: 'x@example.com', alias: 'work' }), 'work');
    assert.equal(displayName({ number: 3, email: 'x@example.com' }), 'x@example.com');
    assert.equal(displayName({ number: 3 }), 'Account 3');
  });
});

describe('usageOf', () => {
  it('uses live usage when present', () => {
    const u = { fiveHour: { pct: 1 } };
    assert.deepEqual(usageOf({ usage: u, usageAgeSeconds: 4 }), { usage: u, ageSeconds: 4, lastGood: false });
  });

  it('falls back to last-good usage', () => {
    const u = { fiveHour: { pct: 1 } };
    assert.deepEqual(usageOf({ usage: null, lastGoodUsage: u, lastGoodAgeSeconds: 90 }), {
      usage: u,
      ageSeconds: 90,
      lastGood: true,
    });
  });

  it('returns null usage when nothing is available', () => {
    assert.equal(usageOf({ usage: null }).usage, null);
  });
});

describe('limitsOf', () => {
  it('orders 5h, 7d, then per-model limits', () => {
    const rows = limitsOf({
      fiveHour: { pct: 10 },
      sevenDay: { pct: 20 },
      scoped: [{ name: 'Opus', pct: 30 }],
    });
    assert.deepEqual(
      rows.map((r) => [r.key, r.pct, r.scoped]),
      [
        ['5h', 10, false],
        ['7d', 20, false],
        ['Opus', 30, true],
      ],
    );
  });

  it('handles missing usage', () => {
    assert.deepEqual(limitsOf(null), []);
    assert.deepEqual(limitsOf({}), []);
  });
});

describe('accountStatus', () => {
  it('is available below the warn threshold', () => {
    const s = accountStatus(account({ fiveHour: { pct: 10 }, sevenDay: { pct: 20 } }), NOW);
    assert.equal(s.kind, 'ok');
    assert.equal(s.usable, true);
  });

  it('warns and flags danger from the highest shared window', () => {
    assert.equal(accountStatus(account({ fiveHour: { pct: 75 }, sevenDay: { pct: 5 } }), NOW).kind, 'warn');
    const danger = accountStatus(account({ fiveHour: { pct: 5 }, sevenDay: { pct: 95 } }), NOW);
    assert.equal(danger.kind, 'danger');
    assert.equal(danger.usable, true);
  });

  it('is limited until the last exhausted window resets', () => {
    const s = accountStatus(
      account({
        fiveHour: { pct: 100, resetsAt: inHours(1) },
        sevenDay: { pct: 100, resetsAt: inHours(30) },
      }),
      NOW,
    );
    assert.equal(s.kind, 'limited');
    assert.equal(s.usable, false);
    assert.equal(s.label, 'Limited · 1d 6h');
  });

  it('ignores per-model limits for overall availability', () => {
    const s = accountStatus(
      account({ fiveHour: { pct: 0 }, sevenDay: { pct: 10 }, scoped: [{ name: 'Opus', pct: 100 }] }),
      NOW,
    );
    assert.equal(s.kind, 'ok');
  });

  it('reports disabled accounts and non-ok usage states', () => {
    assert.equal(accountStatus(account({ fiveHour: { pct: 0 } }, { disabled: true }), NOW).kind, 'off');
    const expired = accountStatus(account(null, { usageStatus: 'token_expired' }), NOW);
    assert.deepEqual([expired.kind, expired.label, expired.usable], ['unknown', 'Token expired', false]);
    assert.equal(accountStatus(account(null, { usageStatus: 'brand_new_state' }), NOW).label, 'brand new state');
  });

  it('reports no data when usage has no shared windows', () => {
    assert.equal(accountStatus(account({ scoped: [] }), NOW).label, 'No data');
  });
});

describe('summarize', () => {
  it('counts usable accounts', () => {
    const accounts = [
      account({ fiveHour: { pct: 10 }, sevenDay: { pct: 10 } }),
      account({ fiveHour: { pct: 100 }, sevenDay: { pct: 10 } }),
      account(null, { usageStatus: 'token_expired' }),
    ];
    assert.deepEqual(summarize(accounts, NOW), { usable: 1, total: 3 });
  });

  it('tolerates a missing list', () => {
    assert.deepEqual(summarize(undefined), { usable: 0, total: 0 });
  });
});

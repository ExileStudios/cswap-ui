/**
 * Fictional accounts for `--demo`: lets people try the UI (and lets us take
 * screenshots) without cswap installed or real account data on screen.
 */

const HOUR = 3_600_000;
const at = (now, hours) => new Date(now + hours * HOUR).toISOString();

const weekly = (now, pct, hours, expectedPct, extra = {}) => ({
  pct,
  resetsAt: at(now, hours),
  expectedPct,
  aheadOfPace: pct > expectedPct,
  willLastToReset: pct < 100 && pct <= expectedPct + 10,
  ...extra,
});

const team = (multiplier) => ({
  kind: 'team',
  label: `Team Premium ${multiplier}`,
  short: `Team ${multiplier}`,
  multiplier,
  extraUsage: true,
  role: 'user',
});
const max = (multiplier) => ({
  kind: 'max',
  label: `Max ${multiplier}`,
  short: `Max ${multiplier}`,
  multiplier,
  extraUsage: false,
  role: 'admin',
});

export function demoSnapshot(now = Date.now()) {
  return {
    activeAccountNumber: 3,
    fetchedAt: now,
    accounts: [
      {
        number: 1,
        email: 'alex@acme.example',
        organizationName: 'Acme Corp',
        usageStatus: 'ok',
        usage: {
          fiveHour: { pct: 0 },
          sevenDay: weekly(now, 100, 4.1, 97),
          scoped: [{ name: 'Opus', ...weekly(now, 12, 4.1, 97) }],
        },
        usageAgeSeconds: 20,
        plan: team('5x'),
      },
      {
        number: 2,
        email: 'backup@acme.example',
        organizationName: 'Acme Corp',
        usageStatus: 'ok',
        usage: {
          fiveHour: { pct: 93, resetsAt: at(now, 1.6) },
          sevenDay: weekly(now, 41, 86, 49),
          scoped: [{ name: 'Opus', ...weekly(now, 3, 86, 49) }],
          spend: { used: 18, limit: 50, pct: 36, currency: 'USD', resetsAt: at(now, 200) },
        },
        usageAgeSeconds: 35,
        plan: team('5x'),
      },
      {
        number: 3,
        email: 'rivera@home.example',
        organizationName: 'Alex Rivera',
        usageStatus: 'ok',
        usage: {
          fiveHour: { pct: 28, resetsAt: at(now, 3.4) },
          sevenDay: weekly(now, 74, 30, 62),
          scoped: [{ name: 'Opus', ...weekly(now, 38, 30, 62) }],
        },
        usageAgeSeconds: 5,
        plan: max('20x'),
      },
      {
        number: 4,
        email: 'side-project@example.org',
        alias: 'side project',
        organizationName: 'Side Project',
        usageStatus: 'ok',
        usage: {
          fiveHour: { pct: 6, resetsAt: at(now, 4.7) },
          sevenDay: weekly(now, 9, 140, 17),
        },
        usageAgeSeconds: 12,
        plan: max('5x'),
      },
      {
        number: 5,
        email: 'old@example.net',
        organizationName: 'Old Login',
        usageStatus: 'token_expired',
        usage: null,
        lastGoodUsage: {
          fiveHour: { pct: 0 },
          sevenDay: weekly(now, 55, 100, 40),
        },
        lastGoodAgeSeconds: 7_200,
        plan: { kind: 'pro', label: 'Pro', short: 'Pro', multiplier: null, extraUsage: false, role: 'admin' },
      },
    ],
  };
}

export class DemoSource {
  async fetch() {
    return demoSnapshot();
  }
}

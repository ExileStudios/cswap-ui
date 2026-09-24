/**
 * Pure helpers for interpreting `cswap list --json` (schema v1) account rows.
 * Shared by the main process (tray tooltip) and the renderer (UI), and free of
 * any Electron or DOM dependency so it can be unit tested directly.
 */

export const WARN_PCT = 70;
export const DANGER_PCT = 90;
export const STALE_AFTER_SECONDS = 5 * 60;

/** Human labels for cswap's non-"ok" `usageStatus` values. */
const USAGE_STATUS_LABELS = Object.freeze({
  token_expired: 'Token expired',
  api_key: 'API key',
  keychain_unavailable: 'Keychain locked',
  relogin_required: 'Re-login needed',
  foreign_credential: 'Credential mismatch',
  no_credentials: 'No credentials',
  unavailable: 'Usage unavailable',
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** @returns {'ok' | 'warn' | 'danger'} */
export function levelFor(pct) {
  if (pct >= DANGER_PCT) return 'danger';
  if (pct >= WARN_PCT) return 'warn';
  return 'ok';
}

export function clampPct(pct) {
  const n = Number(pct);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

/** Compact duration, e.g. "3d 4h", "2h 5m", "12m", "now". */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < MINUTE) return 'now';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatAgo(ms) {
  if (!Number.isFinite(ms) || ms < 10_000) return 'just now';
  if (ms < MINUTE) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  return `${Math.floor(ms / DAY)}d ago`;
}

/** Milliseconds until an ISO timestamp, or null if absent/invalid. */
export function msUntil(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

export function displayName(account) {
  return account.alias || account.email || `Account ${account.number}`;
}

/**
 * The usage block to display: live usage when present, otherwise cswap's
 * last-good measurement (flagged stale so the UI can dim it).
 */
export function usageOf(account) {
  if (account.usage) {
    return { usage: account.usage, ageSeconds: account.usageAgeSeconds ?? null, lastGood: false };
  }
  if (account.lastGoodUsage) {
    return { usage: account.lastGoodUsage, ageSeconds: account.lastGoodAgeSeconds ?? null, lastGood: true };
  }
  return { usage: null, ageSeconds: null, lastGood: false };
}

/**
 * Flattens a usage block into display rows: the shared 5h and 7d windows,
 * then per-model weekly limits.
 */
export function limitsOf(usage) {
  if (!usage) return [];
  const rows = [];
  if (usage.fiveHour) rows.push({ key: '5h', label: '5-hour window', scoped: false, ...usage.fiveHour });
  if (usage.sevenDay) rows.push({ key: '7d', label: '7-day window', scoped: false, ...usage.sevenDay });
  for (const window of usage.scoped ?? []) {
    const name = window.name || 'Model';
    rows.push({ key: name, label: `${name} weekly limit`, scoped: true, ...window });
  }
  return rows;
}

/**
 * Overall availability of an account. Only the shared 5h/7d windows gate the
 * whole account; per-model limits block just that model, so they are shown
 * but don't mark the account unavailable.
 *
 * @returns {{ kind: 'ok'|'warn'|'danger'|'limited'|'off'|'unknown', label: string, usable: boolean }}
 */
export function accountStatus(account, now = Date.now()) {
  if (account.disabled) return { kind: 'off', label: 'Disabled', usable: false };

  if (account.usageStatus && account.usageStatus !== 'ok') {
    const label = USAGE_STATUS_LABELS[account.usageStatus] ?? String(account.usageStatus).replace(/_/g, ' ');
    return { kind: 'unknown', label, usable: false };
  }

  const shared = [account.usage?.fiveHour, account.usage?.sevenDay].filter(Boolean);
  if (!shared.length) return { kind: 'unknown', label: 'No data', usable: false };

  const exhausted = shared.filter((w) => clampPct(w.pct) >= 100);
  if (exhausted.length) {
    // The account frees up only once every exhausted window has reset.
    const waits = exhausted.map((w) => msUntil(w.resetsAt, now)).filter((ms) => ms != null);
    const label = waits.length ? `Limited · ${formatDuration(Math.max(...waits))}` : 'Limited';
    return { kind: 'limited', label, usable: false };
  }

  const peak = Math.max(...shared.map((w) => clampPct(w.pct)));
  const level = levelFor(peak);
  if (level === 'danger') return { kind: 'danger', label: 'Almost out', usable: true };
  if (level === 'warn') return { kind: 'warn', label: 'Getting close', usable: true };
  return { kind: 'ok', label: 'Available', usable: true };
}

export function summarize(accounts, now = Date.now()) {
  const list = Array.isArray(accounts) ? accounts : [];
  const usable = list.filter((a) => accountStatus(a, now).usable).length;
  return { usable, total: list.length };
}

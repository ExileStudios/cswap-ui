import {
  STALE_AFTER_SECONDS,
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
} from '../shared/usage.js';

const api = window.cswapUI;

const els = {
  app: document.getElementById('app'),
  list: document.getElementById('list'),
  summary: document.getElementById('summary'),
  error: document.getElementById('error'),
  refresh: document.getElementById('btn-refresh'),
  compact: document.getElementById('btn-compact'),
  pin: document.getElementById('btn-pin'),
  menu: document.getElementById('btn-menu'),
  hide: document.getElementById('btn-hide'),
};

const state = {
  snapshot: null,
  error: null,
  loading: false,
  settings: { pinned: true, compact: false },
};

const COUNTDOWN_REFRESH_MS = 30_000;
const SUMMARY_TICK_MS = 5_000;

// ---------------------------------------------------------------------------
// DOM helpers. Content is always inserted as text nodes, never parsed as HTML.

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') Object.assign(el.style, value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...children.flat().filter((c) => c != null && c !== false && c !== ''));
  return el;
}

const money = (amount, currency) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
};

// ---------------------------------------------------------------------------
// Views

function planChip(plan, { short = false } = {}) {
  if (!plan) return null;
  const details = [
    plan.label,
    plan.multiplier && `${plan.multiplier} usage`,
    plan.extraUsage && 'extra usage enabled',
    plan.role?.replace(/_/g, ' '),
  ];
  return h('span', { class: `plan ${plan.kind}`, title: details.filter(Boolean).join(' · ') }, short ? plan.short : plan.label);
}

function track(pct, marker) {
  return h(
    'div',
    { class: 'track' },
    h('div', { class: 'fill', style: { width: `${pct}%` } }),
    marker != null &&
      h('i', { class: 'pace', style: { left: `${clampPct(marker)}%` }, title: `Even pace: ${Math.round(marker)}% by now` }),
  );
}

function limitRow(limit, now) {
  const pct = Math.round(clampPct(limit.pct));
  const wait = msUntil(limit.resetsAt, now);
  const burnsOut = limit.willLastToReset === false && pct < 100;
  return h(
    'div',
    { class: `limit ${levelFor(pct)}${limit.scoped ? ' scoped' : ''}`, title: limit.label },
    h('span', { class: 'k' }, limit.key),
    track(pct, limit.expectedPct),
    h(
      'span',
      { class: 'v' },
      `${pct}%`,
      burnsOut && h('span', { class: 'burn', title: 'At the current rate this runs out before it resets' }, '!'),
    ),
    h(
      'span',
      { class: 'r', title: limit.resetsAt ? `Resets ${new Date(limit.resetsAt).toLocaleString()}` : 'Window not started' },
      wait == null ? '—' : formatDuration(wait),
    ),
  );
}

function spendRow(spend) {
  const pct = Math.round(clampPct(spend.pct));
  return h(
    'div',
    { class: `limit spend ${levelFor(pct)}`, title: 'Extra usage (pay as you go) this month' },
    h('span', { class: 'k' }, 'Extra'),
    track(pct),
    h('span', { class: 'v' }, `${pct}%`),
    h('span', { class: 'r' }, `${money(spend.used, spend.currency)}/${money(spend.limit, spend.currency)}`),
  );
}

function staleNote(ageSeconds, lastGood) {
  if (!lastGood && !(ageSeconds > STALE_AFTER_SECONDS)) return null;
  const age = ageSeconds == null ? 'old data' : formatAgo(ageSeconds * 1000);
  return h('span', { class: 'stale', title: 'Showing the last successful measurement' }, lastGood ? `last seen ${age}` : age);
}

function fullCard(account, status, active, now) {
  const { usage, ageSeconds, lastGood } = usageOf(account);
  const org = account.organizationName && account.organizationName !== account.email ? account.organizationName : null;
  const rows = limitsOf(usage).map((limit) => limitRow(limit, now));
  if (usage?.spend) rows.push(spendRow(usage.spend));

  return h(
    'article',
    { class: `card ${status.kind}${active ? ' active' : ''}${lastGood ? ' last-good' : ''}` },
    h(
      'div',
      { class: 'head' },
      h('span', { class: 'dot', title: status.label }),
      h(
        'div',
        { class: 'id' },
        h('div', { class: 'email', title: account.email }, displayName(account)),
        h('div', { class: 'org' }, planChip(account.plan), h('span', { class: 'org-name' }, org), staleNote(ageSeconds, lastGood)),
      ),
      h(
        'div',
        { class: 'tags' },
        active && h('span', { class: 'tag active-tag' }, 'Active'),
        h('span', { class: 'tag status' }, status.label),
        h('span', { class: 'slot', title: 'cswap slot' }, `#${account.number}`),
      ),
    ),
    rows.length > 0 && h('div', { class: 'limits' }, rows),
  );
}

function miniBar(limit) {
  const pct = Math.round(clampPct(limit.pct));
  return h(
    'div',
    { class: `mini ${levelFor(pct)}`, title: `${limit.label}: ${pct}%` },
    h('span', { class: 'k' }, limit.key),
    track(pct),
    h('span', { class: 'v' }, String(pct)),
  );
}

function compactCard(account, status, active) {
  const { usage, lastGood } = usageOf(account);
  const name = account.alias || String(account.email ?? '').split('@')[0] || displayName(account);
  const org = account.organizationName ? ` · ${account.organizationName}` : '';
  return h(
    'article',
    {
      class: `card compact ${status.kind}${active ? ' active' : ''}${lastGood ? ' last-good' : ''}`,
      title: `${displayName(account)}${org}\n${status.label}`,
    },
    h('span', { class: 'dot' }),
    h('span', { class: 'slot' }, String(account.number)),
    h('span', { class: 'who' }, name),
    planChip(account.plan, { short: true }),
    h('div', { class: 'minis' }, limitsOf(usage).filter((l) => !l.scoped).map(miniBar)),
  );
}

function renderList() {
  const now = Date.now();
  const snapshot = state.snapshot;
  let content;
  if (!snapshot) {
    content = state.error ? [] : [h('div', { class: 'empty' }, 'Reading cswap…')];
  } else if (!snapshot.accounts.length) {
    content = [h('div', { class: 'empty' }, 'cswap has no accounts yet. Run ', h('code', {}, 'cswap add'), ' to add one.')];
  } else {
    content = snapshot.accounts.map((account) => {
      const status = accountStatus(account, now);
      const active = account.active === true || account.number === snapshot.activeAccountNumber;
      return state.settings.compact ? compactCard(account, status, active) : fullCard(account, status, active, now);
    });
  }
  els.list.replaceChildren(...content);
}

function renderSummary() {
  const accounts = state.snapshot?.accounts;
  if (!accounts?.length) {
    els.summary.textContent = state.loading ? 'Loading…' : '';
    return;
  }
  const { usable, total } = summarize(accounts);
  const updated = state.loading ? 'refreshing…' : `updated ${formatAgo(Date.now() - state.snapshot.fetchedAt)}`;
  els.summary.replaceChildren(h('b', { class: usable ? '' : 'none' }, `${usable}/${total}`), ` available · ${updated}`);
}

function renderChrome() {
  const { compact, pinned } = state.settings;
  document.body.classList.toggle('compact', compact);
  els.compact.classList.toggle('on', compact);
  els.compact.setAttribute('aria-pressed', String(compact));
  els.pin.classList.toggle('on', pinned);
  els.pin.setAttribute('aria-pressed', String(pinned));
  els.refresh.classList.toggle('spin', state.loading);
  els.error.hidden = !state.error;
  els.error.textContent = state.error ?? '';
}

function render() {
  renderChrome();
  renderList();
  renderSummary();
}

// ---------------------------------------------------------------------------
// Wiring

// Keep the window exactly as tall as the content (body padding included).
let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    const { paddingTop, paddingBottom } = getComputedStyle(document.body);
    api.resize(els.app.getBoundingClientRect().height + parseFloat(paddingTop) + parseFloat(paddingBottom));
  });
}).observe(els.app);

els.refresh.addEventListener('click', () => void api.refresh());
els.compact.addEventListener('click', () => api.toggleSetting('compact'));
els.pin.addEventListener('click', () => api.toggleSetting('pinned'));
els.menu.addEventListener('click', () => api.openMenu());
els.hide.addEventListener('click', () => api.hide());

api.onUsage(({ loading, snapshot, error }) => {
  // Payloads are structured-cloned per message, so compare by fetch time.
  const dataChanged = snapshot?.fetchedAt !== state.snapshot?.fetchedAt || error !== state.error;
  Object.assign(state, { loading, snapshot, error });
  if (dataChanged) render();
  else {
    renderChrome();
    renderSummary();
  }
});

api.onSettings((settings) => {
  state.settings = settings;
  render();
});

// Countdowns advance locally between polls; skip work while hidden.
setInterval(() => document.visibilityState === 'visible' && renderList(), COUNTDOWN_REFRESH_MS);
setInterval(() => document.visibilityState === 'visible' && renderSummary(), SUMMARY_TICK_MS);

state.settings = (await api.getSettings()) ?? state.settings;
render();
api.ready();

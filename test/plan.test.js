import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planFromOAuthAccount, tierMultiplier } from '../src/main/plan.js';

describe('tierMultiplier', () => {
  it('extracts the Max multiplier', () => {
    assert.equal(tierMultiplier('default_claude_max_20x'), '20x');
    assert.equal(tierMultiplier('default_claude_max_5x'), '5x');
  });

  it('returns null for other tiers', () => {
    assert.equal(tierMultiplier('default_raven'), null);
    assert.equal(tierMultiplier(null), null);
    assert.equal(tierMultiplier(42), null);
  });
});

describe('planFromOAuthAccount', () => {
  it('labels Team Premium seats with the per-user tier', () => {
    const plan = planFromOAuthAccount({
      organizationType: 'claude_team',
      organizationRateLimitTier: 'default_raven',
      userRateLimitTier: 'default_claude_max_5x',
      hasExtraUsageEnabled: true,
      organizationRole: 'user',
    });
    assert.deepEqual(plan, {
      kind: 'team',
      label: 'Team Premium 5x',
      short: 'Team 5x',
      multiplier: '5x',
      extraUsage: true,
      role: 'user',
    });
  });

  it('labels Team Standard seats as 1x', () => {
    const plan = planFromOAuthAccount({ organizationType: 'claude_team', userRateLimitTier: null });
    assert.equal(plan.label, 'Team Standard 1x');
    assert.equal(plan.short, 'Team 1x');
  });

  it('labels Max plans from the organization tier', () => {
    const plan = planFromOAuthAccount({
      organizationType: 'claude_max',
      organizationRateLimitTier: 'default_claude_max_20x',
      userRateLimitTier: null,
    });
    assert.equal(plan.kind, 'max');
    assert.equal(plan.label, 'Max 20x');
  });

  it('labels Pro, Enterprise and unknown types', () => {
    assert.equal(planFromOAuthAccount({ organizationType: 'claude_pro' }).label, 'Pro');
    assert.equal(planFromOAuthAccount({ organizationType: 'claude_enterprise' }).label, 'Enterprise');
    assert.equal(planFromOAuthAccount({ organizationType: 'claude_something_new' }).label, 'something new');
  });

  it('returns null without usable data', () => {
    assert.equal(planFromOAuthAccount(null), null);
    assert.equal(planFromOAuthAccount({}), null);
    assert.equal(planFromOAuthAccount('claude_max'), null);
  });
});

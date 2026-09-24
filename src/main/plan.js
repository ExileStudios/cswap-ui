/**
 * Derives a subscription label from the `oauthAccount` block that Claude Code
 * stores in ~/.claude.json (and cswap snapshots per account).
 */

/** "default_claude_max_20x" -> "20x"; anything else -> null. */
export function tierMultiplier(tier) {
  const match = /max_(\d+)x\b/.exec(typeof tier === 'string' ? tier : '');
  return match ? `${match[1]}x` : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} oauth
 * @returns {{ kind: 'team'|'max'|'pro'|'other', label: string, short: string,
 *             multiplier: string|null, extraUsage: boolean, role: string|null } | null}
 */
export function planFromOAuthAccount(oauth) {
  if (!oauth || typeof oauth !== 'object') return null;

  const type = typeof oauth.organizationType === 'string' ? oauth.organizationType : '';
  const userTier = tierMultiplier(oauth.userRateLimitTier);
  const orgTier = tierMultiplier(oauth.organizationRateLimitTier);
  const common = {
    extraUsage: oauth.hasExtraUsageEnabled === true,
    role: typeof oauth.organizationRole === 'string' ? oauth.organizationRole : null,
  };

  switch (type) {
    case 'claude_team': {
      // Premium seats carry a per-user Max tier; standard seats have none (1x).
      const multiplier = userTier ?? '1x';
      const seat = userTier ? 'Premium' : 'Standard';
      return { kind: 'team', label: `Team ${seat} ${multiplier}`, short: `Team ${multiplier}`, multiplier, ...common };
    }
    case 'claude_enterprise': {
      const multiplier = userTier;
      const label = multiplier ? `Enterprise ${multiplier}` : 'Enterprise';
      return { kind: 'team', label, short: label, multiplier, ...common };
    }
    case 'claude_max': {
      const multiplier = orgTier ?? userTier;
      const label = multiplier ? `Max ${multiplier}` : 'Max';
      return { kind: 'max', label, short: label, multiplier, ...common };
    }
    case 'claude_pro':
      return { kind: 'pro', label: 'Pro', short: 'Pro', multiplier: null, ...common };
    case '':
      return null;
    default: {
      const label = type.replace(/^claude_/, '').replace(/_/g, ' ');
      return { kind: 'other', label, short: label, multiplier: null, ...common };
    }
  }
}

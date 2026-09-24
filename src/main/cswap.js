/**
 * Reads account and usage data from the cswap (claude-swap) CLI.
 *
 * Usage comes from `cswap list --json`. The subscription plan isn't part of
 * that output, so it is read from the per-account config snapshot cswap keeps
 * in its backup directory. Only the `oauthAccount` block is used; credential
 * files are never opened.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planFromOAuthAccount } from './plan.js';

export const SUPPORTED_SCHEMA_VERSION = 1;
const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export class CswapError extends Error {
  name = 'CswapError';
}

export function resolveCswapBinary({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.CSWAP_PATH) return env.CSWAP_PATH;
  const local = path.join(home, '.local', 'bin', platform === 'win32' ? 'cswap.exe' : 'cswap');
  return existsSync(local) ? local : 'cswap';
}

/** Mirrors claude_swap.paths.get_backup_root(). */
export function resolveBackupRoot({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.CSWAP_BACKUP_DIR) return env.CSWAP_BACKUP_DIR;
  if (platform === 'linux') {
    const xdg = env.XDG_DATA_HOME?.replace(/^~(?=$|[\\/])/, home);
    if (xdg && path.isAbsolute(xdg)) return path.join(xdg, 'claude-swap');
    return path.join(home, '.local', 'share', 'claude-swap');
  }
  return path.join(home, '.claude-swap-backup');
}

/**
 * Parses and validates `cswap list --json` output.
 * @returns {{ activeAccountNumber: number|null, accounts: object[] }}
 */
export function parseListOutput(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new CswapError('cswap returned output that is not valid JSON.');
  }
  if (payload?.error) {
    throw new CswapError(payload.error.message || payload.error.type || 'cswap reported an error.');
  }
  if (payload?.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new CswapError(
      `Unsupported cswap JSON schema (${payload?.schemaVersion ?? 'missing'}); expected v${SUPPORTED_SCHEMA_VERSION}. Try updating cswap-ui or cswap.`,
    );
  }
  if (!Array.isArray(payload.accounts)) {
    throw new CswapError('cswap output is missing the accounts list.');
  }
  return {
    activeAccountNumber: Number.isInteger(payload.activeAccountNumber) ? payload.activeAccountNumber : null,
    accounts: payload.accounts.filter((a) => a && typeof a === 'object' && Number.isInteger(a.number)),
  };
}

/**
 * The snapshot file cswap writes for an account, or null if the account's
 * identifiers can't safely form a file name inside `configsDir`.
 */
export function configSnapshotPath(configsDir, account) {
  const { number, email } = account;
  if (!Number.isInteger(number) || typeof email !== 'string' || !email) return null;
  // Reject both separators explicitly: path.basename only knows the host OS's.
  if (/[\\/]/.test(email) || email.includes('..')) return null;
  return path.join(configsDir, `.claude-config-${number}-${email}.json`);
}

function execCswap(binary, args) {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { windowsHide: true, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error?.code === 'ENOENT') {
          reject(new CswapError('cswap was not found. Install claude-swap, or set CSWAP_PATH to the cswap executable.'));
        } else if (error?.killed) {
          reject(new CswapError(`cswap did not respond within ${EXEC_TIMEOUT_MS / 1000}s.`));
        } else if (error && !stdout) {
          reject(new CswapError(stderr.trim() || error.message));
        } else {
          // cswap exits non-zero with a JSON error envelope on handled errors,
          // so any stdout is handed to the parser.
          resolve(stdout);
        }
      },
    );
  });
}

export class CswapSource {
  #binary;
  #binaryArgs;
  #configsDir;
  /** @type {Map<string, { mtimeMs: number, plan: object|null }>} */
  #planCache = new Map();

  /**
   * @param {object} [options]
   * @param {string} [options.binary] cswap executable.
   * @param {string[]} [options.binaryArgs] Arguments placed before `list --json` (e.g. a script path).
   * @param {string} [options.backupRoot] cswap's backup directory.
   */
  constructor({ binary = resolveCswapBinary(), binaryArgs = [], backupRoot = resolveBackupRoot() } = {}) {
    this.#binary = binary;
    this.#binaryArgs = binaryArgs;
    this.#configsDir = path.join(backupRoot, 'configs');
  }

  async fetch() {
    const { activeAccountNumber, accounts } = parseListOutput(await execCswap(this.#binary, [...this.#binaryArgs, 'list', '--json']));
    const plans = await Promise.all(accounts.map((account) => this.#planFor(account)));
    return {
      activeAccountNumber,
      accounts: accounts.map((account, i) => ({ ...account, plan: plans[i] })),
      fetchedAt: Date.now(),
    };
  }

  async #planFor(account) {
    const file = configSnapshotPath(this.#configsDir, account);
    if (!file) return null;
    try {
      const { mtimeMs } = await stat(file);
      const cached = this.#planCache.get(file);
      if (cached?.mtimeMs === mtimeMs) return cached.plan;
      const plan = planFromOAuthAccount(JSON.parse(await readFile(file, 'utf8')).oauthAccount);
      this.#planCache.set(file, { mtimeMs, plan });
      return plan;
    } catch {
      // Missing or unreadable snapshot: the plan badge is optional.
      return null;
    }
  }
}

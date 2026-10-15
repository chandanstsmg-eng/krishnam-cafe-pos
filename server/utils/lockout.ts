/**
 * Locks a PIN or password after repeated wrong guesses. The per-IP rate limit alone is not
 * enough once the app is reachable from the internet: a 4-digit PIN has only
 * 10 000 values, and guesses can come from many addresses. Kept in memory —
 * a restart clears it, which is fine for a lock measured in minutes.
 */
import { AppError } from './errors.js';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

const fails = new Map<string, { n: number; until: number }>();

export function assertNotLocked(key: string) {
  const f = fails.get(key);
  if (f && f.until > Date.now()) {
    const mins = Math.ceil((f.until - Date.now()) / 60_000);
    throw new AppError(429, `Too many wrong attempts. Please wait ${mins} minute${mins > 1 ? 's' : ''} and try again.`, 'LOCKED');
  }
}

export function recordFailure(key: string, max = MAX_FAILS) {
  const f = fails.get(key);
  const n = (f && f.until > Date.now() ? 0 : (f?.n ?? 0)) + 1;
  fails.set(key, { n: n >= max ? 0 : n, until: n >= max ? Date.now() + LOCK_MS : 0 });
}

/**
 * Lock keys for one account: per visitor address (5 wrong tries) so a stranger
 * can't lock staff out of their own café, plus an account-wide lock with a much
 * higher limit so guesses spread over many addresses still stop.
 */
const ACCOUNT_WIDE_FAILS = 40;
export const accountLock = (account: string, ip: string | undefined) => ({
  check() {
    assertNotLocked(`${account}@${ip}`);
    assertNotLocked(account);
  },
  fail() {
    recordFailure(`${account}@${ip}`);
    recordFailure(account, ACCOUNT_WIDE_FAILS);
  },
  clear() {
    clearFailures(`${account}@${ip}`);
  },
});

export function clearFailures(key: string) {
  fails.delete(key);
}

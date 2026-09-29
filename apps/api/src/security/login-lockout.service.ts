import { Injectable } from '@nestjs/common';
import { ThrottlerExceptionLike } from './throttle.types';
import { LOGIN_LOCKOUT_THRESHOLD, LOGIN_LOCKOUT_TTL_MS } from './throttle.config';

interface LockoutState {
  failures: number[];
  lockedUntil: number | null;
}

/**
 * In-memory brute-force lockout keyed by `email`. After N failed logins within
 * the TTL window the account is locked (retry-after honored). Success clears
 * the counter. A small LRU cap prevents unbounded growth.
 */
@Injectable()
export class LoginLockoutService {
  private readonly states = new Map<string, LockoutState>();
  private readonly MAX_KEYS = 10_000;

  /** Throws a 423 `TooManyRequests`-style error when the key is locked. */
  assertOpen(key: string, now = Date.now()): void {
    const state = this.states.get(this.normalize(key));
    if (!state) return;
    if (state.lockedUntil !== null && state.lockedUntil > now) {
      const retryAfter = Math.ceil((state.lockedUntil - now) / 1000);
      throw new ThrottlerExceptionLike(retryAfter);
    }
    // Locked window expired — clear it lazily.
    if (state.lockedUntil !== null) {
      state.lockedUntil = null;
      state.failures = [];
    }
  }

  /** Record a failed attempt; locks when the threshold is hit. */
  recordFailure(key: string, now = Date.now()): { locked: boolean; retryAfterMs: number } {
    const k = this.normalize(key);
    let state = this.states.get(k);
    if (!state) {
      state = { failures: [], lockedUntil: null };
      this.states.set(k, state);
    }
    const cutoff = now - LOGIN_LOCKOUT_TTL_MS;
    state.failures = state.failures.filter((t) => t > cutoff);
    state.failures.push(now);

    if (!state.lockedUntil && state.failures.length >= LOGIN_LOCKOUT_THRESHOLD) {
      state.lockedUntil = now + LOGIN_LOCKOUT_TTL_MS;
      state.failures = [];
      this.trim();
      return { locked: true, retryAfterMs: LOGIN_LOCKOUT_TTL_MS };
    }
    return { locked: false, retryAfterMs: 0 };
  }

  reset(key: string): void {
    const k = this.normalize(key);
    const state = this.states.get(k);
    if (state) {
      state.failures = [];
      state.lockedUntil = null;
    }
  }

  isLocked(key: string, now = Date.now()): boolean {
    const state = this.states.get(this.normalize(key));
    return state?.lockedUntil !== null && (state?.lockedUntil ?? 0) > now;
  }

  private normalize(key: string): string {
    return key.toLowerCase().trim();
  }

  private trim(): void {
    if (this.states.size <= this.MAX_KEYS) return;
    for (const k of this.states.keys()) {
      if (this.states.size <= this.MAX_KEYS) break;
      this.states.delete(k);
    }
  }
}
import { Injectable } from '@nestjs/common';

const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_MS = 60_000;

/** Sliding-window rate limiter, in-memory per process (one bucket per key). */
@Injectable()
export class ApiKeyRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = DEFAULT_LIMIT,
    private readonly windowMs = DEFAULT_WINDOW_MS,
  ) {}

  /** Records a hit; returns retry-after seconds (0 = allowed). */
  hit(keyId: string, now = Date.now()): number {
    const recent = (this.hits.get(keyId) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    if (recent.length >= this.limit) {
      this.hits.set(keyId, recent);
      const oldest = recent[0] ?? now;
      return Math.max(1, Math.ceil((this.windowMs - (now - oldest)) / 1000));
    }
    recent.push(now);
    this.hits.set(keyId, recent);
    return 0;
  }
}

/**
 * In-memory rate limiter.
 * Mirrors v0.1.x policy: 5 attempts per 15 minutes per (clientKey).
 *
 * Plugin processes are short-lived (restart on host boot), so a
 * Map-backed limiter is acceptable. We deliberately do NOT pull in
 * express-rate-limit; the plugin server has no Express dependency.
 */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly max: number;

  constructor(opts: RateLimitOptions) {
    this.windowMs = opts.windowMs;
    this.max = opts.max;
  }

  /**
   * Returns true if the request is allowed; false if it should be 429'd.
   * Side effect: increments the bucket on allow.
   */
  check(key: string, now: number = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (b.count >= this.max) {
      return { allowed: false, retryAfterMs: b.resetAt - now };
    }
    b.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Test helper. */
  reset(): void {
    this.buckets.clear();
  }
}

export const accountChangeLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

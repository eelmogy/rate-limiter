import { Redis as IORedis } from 'ioredis';

export type RateLimiterIdentifier = string;

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /**
   * Allows having independent buckets for different use-cases (ex: per-endpoint).
   * If omitted, the limiter uses `default`.
   */
  namespace?: string;
  /**
   * Optional override for Redis key prefix. Defaults to the app Redis prefix.
   */
  keyPrefix?: string;
  /**
   * Hash identifiers before using them in Redis keys.
   * Helps keep keys short and prevents accidental key collisions.
   */
  hashIdentifier?: boolean;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  windowMs: number;
  used: number;
  resetAtMs: number;
  /**
   * Full Redis key used for the decision (useful for debugging/monitoring).
   */
  key: string;
}

/**
 * Minimal Redis surface needed for fixed-window rate limiting.
 * Supports both the Lua-script path (`eval`) and the fallback INCR+PEXPIRE path.
 */
export interface RedisLike {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  eval(
    script: string,
    numkeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}


import crypto from 'crypto';
import {
  RateLimitDecision,
  RateLimitOptions,
  RedisLike,
} from './rate-limiter.types';

export interface DistributedRateLimiterConfig {
  defaultLimit: number;
  defaultWindowMs: number;
  defaultNamespace: string;
  /**
   * Controls behavior if Redis is temporarily unavailable.
   * - `true`  => fail open (allow requests)
   * - `false` => fail closed (deny requests)
   */
  failOpenOnRedisError: boolean;
  keyPrefix: string;
  /** Optional clock injection for tests. */
  now?: () => number;
}

/**
 * Atomically increments a counter and sets its TTL in a single round-trip.
 * If the key doesn't exist, INCR creates it at 1 and PEXPIRE sets the TTL.
 * If it already exists, INCR just bumps the counter.
 *
 * This eliminates the race where a process crashes between INCR and PEXPIRE,
 * which would leave an immortal key that permanently blocks the identifier.
 */
const LUA_INCR_WITH_EXPIRE = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`;

/**
 * Fixed-window counter rate limiter backed by Redis.
 *
 * Algorithm:
 * 1. Pick a time bucket: floor(now / windowMs)
 * 2. Build a Redis key: (prefix:rate_limit:namespace:identifierHash:bucket)
 * 3. Execute a Lua script that atomically runs INCR + PEXPIRE in one round-trip.
 * 4. Allow when `used <= limit`, otherwise reject.
 *
 * Concurrency/consistency:
 * - The Lua script runs atomically inside Redis, so multiple service instances
 *   coordinate correctly without distributed locks.
 *
 * Trade-off:
 * - Fixed windows can allow a brief burst around the boundary of two buckets.
 *   This is acceptable for most use-cases, and the implementation stays simple.
 */
export class DistributedRateLimiter {
  private readonly defaultLimit: number;
  private readonly defaultWindowMs: number;
  private readonly defaultNamespace: string;
  private readonly failOpenOnRedisError: boolean;
  private readonly keyPrefix: string;
  private readonly now: () => number;

  constructor(
    private readonly redis: RedisLike,
    config: DistributedRateLimiterConfig,
  ) {
    this.defaultLimit = config.defaultLimit;
    this.defaultWindowMs = config.defaultWindowMs;
    this.defaultNamespace = config.defaultNamespace;
    this.failOpenOnRedisError = config.failOpenOnRedisError;
    this.keyPrefix = config.keyPrefix;
    this.now = config.now ?? (() => Date.now());
  }

  async check(
    identifier: string,
    overrides: Partial<RateLimitOptions> = {},
  ): Promise<RateLimitDecision> {
    const limit = overrides.limit ?? this.defaultLimit;
    const windowMs = overrides.windowMs ?? this.defaultWindowMs;
    const namespace = overrides.namespace ?? this.defaultNamespace;
    const keyPrefix = overrides.keyPrefix ?? this.keyPrefix;
    const hashIdentifier = overrides.hashIdentifier ?? true;

    if (!identifier || typeof identifier !== 'string') {
      throw new Error('Rate limiter identifier must be a non-empty string');
    }
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error('Rate limiter limit must be a positive number');
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error('Rate limiter windowMs must be a positive number');
    }

    const nowMs = this.now();
    const bucketStartMs = Math.floor(nowMs / windowMs) * windowMs;
    const resetAtMs = bucketStartMs + windowMs;
    const ttlMs = Math.max(1, resetAtMs - nowMs) || windowMs;

    const identifierPart = hashIdentifier ? this.hash(identifier) : identifier;
    const key = `${keyPrefix}:rate_limit:${namespace}:${identifierPart}:${bucketStartMs}`;

    try {
      const used = (await this.redis.eval(
        LUA_INCR_WITH_EXPIRE,
        1,
        key,
        ttlMs,
      )) as number;

      const allowed = used <= limit;
      return { allowed, limit, windowMs, used, resetAtMs, key };
    } catch {
      if (this.failOpenOnRedisError) {
        return { allowed: true, limit, windowMs, used: -1, resetAtMs, key };
      }
      return { allowed: false, limit, windowMs, used: -1, resetAtMs, key };
    }
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}

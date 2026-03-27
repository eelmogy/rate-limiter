import { Inject, Injectable } from '@nestjs/common';
import { appConfig } from 'src/config';
import { RateLimitDecision, RateLimitOptions } from './rate-limiter.types';
import {
  DistributedRateLimiter,
  DistributedRateLimiterConfig,
} from './distributed-rate-limiter';
import { RedisLike } from './rate-limiter.types';
import { RATE_LIMITER_REDIS } from './rate-limiter.constants';

const envNumber = (key: string, fallback: number): number => {
  const value = process.env[key];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

@Injectable()
export class RateLimiterService {
  private readonly limiter: DistributedRateLimiter;

  constructor(@Inject(RATE_LIMITER_REDIS) redis: RedisLike) {
    const config: DistributedRateLimiterConfig = {
      defaultLimit: envNumber('RATE_LIMIT_DEFAULT_LIMIT', 100),
      defaultWindowMs: envNumber('RATE_LIMIT_DEFAULT_WINDOW_MS', 60_000),
      defaultNamespace: 'default',
      failOpenOnRedisError: envNumber('RATE_LIMIT_FAIL_OPEN', 1) === 1,
      keyPrefix: appConfig.redis.prefix,
    };

    this.limiter = new DistributedRateLimiter(redis, config);
  }

  async check(
    identifier: string,
    options: Partial<RateLimitOptions> = {},
  ): Promise<RateLimitDecision> {
    return this.limiter.check(identifier, options);
  }

  async isAllowed(
    identifier: string,
    options: Partial<RateLimitOptions> = {},
  ): Promise<boolean> {
    const decision = await this.limiter.check(identifier, options);
    return decision.allowed;
  }
}


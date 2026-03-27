import { Module, OnModuleDestroy } from '@nestjs/common';
import { RedisConnection, closeRedis } from '@core/redis/redis-connection';
import { RateLimiterService } from '@core/rate-limiter/rate-limiter.service';
import { RATE_LIMITER_REDIS } from '@core/rate-limiter/rate-limiter.constants';
import { RateLimiterController } from './rate-limiter.controller';
import { RateLimitGuard } from '@core/rate-limiter/rate-limit.guard';
import { Reflector } from '@nestjs/core';
import { RateLimitDemoController } from './rate-limit-demo.controller';

@Module({
  controllers: [RateLimiterController, RateLimitDemoController],
  providers: [
    RateLimiterService,
    RateLimitGuard,
    Reflector,
    {
      provide: RATE_LIMITER_REDIS,
      useValue: RedisConnection,
    },
  ],
  exports: [RateLimiterService],
})
export class RateLimiterModule implements OnModuleDestroy {
  async onModuleDestroy() {
    await closeRedis().catch(() => {});
  }
}

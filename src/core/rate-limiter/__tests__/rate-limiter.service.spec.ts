import { RateLimiterService } from '@core/rate-limiter/rate-limiter.service';
import { RATE_LIMITER_REDIS } from '@core/rate-limiter/rate-limiter.constants';
import { Test } from '@nestjs/testing';
import { RedisLike } from '@core/rate-limiter/rate-limiter.types';

class FakeRedis implements RedisLike {
  private readonly store = new Map<string, number>();

  async incr(key: string): Promise<number> {
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }

  async pexpire(): Promise<number> {
    return 1;
  }

  async eval(
    _script: string,
    _numkeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    return this.incr(String(args[0]));
  }
}

describe('RateLimiterService', () => {
  let service: RateLimiterService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        { provide: RATE_LIMITER_REDIS, useValue: new FakeRedis() },
      ],
    }).compile();

    service = module.get(RateLimiterService);
  });

  it('check() returns a full decision object', async () => {
    const decision = await service.check('user-1');
    expect(decision).toHaveProperty('allowed');
    expect(decision).toHaveProperty('limit');
    expect(decision).toHaveProperty('used');
    expect(decision).toHaveProperty('resetAtMs');
    expect(decision).toHaveProperty('key');
    expect(decision.allowed).toBe(true);
    expect(decision.used).toBe(1);
  });

  it('isAllowed() returns a boolean', async () => {
    const result = await service.isAllowed('user-1');
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
  });

  it('isAllowed() returns false once the limit is exceeded', async () => {
    for (let i = 0; i < 100; i++) {
      await service.check('user-2');
    }
    const allowed = await service.isAllowed('user-2');
    expect(allowed).toBe(false);
  });
});

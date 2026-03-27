import { DistributedRateLimiter, DistributedRateLimiterConfig } from '@core/rate-limiter/distributed-rate-limiter';
import { RedisLike } from '@core/rate-limiter/rate-limiter.types';

/**
 * In-memory Redis fake that mirrors the Lua eval script behavior.
 * Supports INCR, PEXPIRE, and the Lua INCR-with-expire script path.
 */
class FakeRedis implements RedisLike {
  private readonly store = new Map<
    string,
    { value: number; expiresAtMs: number | null }
  >();

  constructor(private readonly now: () => number) {}

  async incr(key: string): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    const next = (entry?.value ?? 0) + 1;
    this.store.set(key, { value: next, expiresAtMs: entry?.expiresAtMs ?? null });
    return next;
  }

  async pexpire(key: string, milliseconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) {
      this.store.set(key, { value: 0, expiresAtMs: this.now() + milliseconds });
    } else {
      entry.expiresAtMs = this.now() + milliseconds;
    }
    return 1;
  }

  async eval(
    _script: string,
    _numkeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    const key = String(args[0]);
    const ttlMs = Number(args[1]);
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    const next = (entry?.value ?? 0) + 1;
    const isNew = next === 1;
    this.store.set(key, {
      value: next,
      expiresAtMs: isNew ? this.now() + ttlMs : (entry?.expiresAtMs ?? null),
    });
    return next;
  }

  private evictIfExpired(key: string): void {
    const existing = this.store.get(key);
    if (existing && existing.expiresAtMs !== null && existing.expiresAtMs <= this.now()) {
      this.store.delete(key);
    }
  }
}

class FailingRedis implements RedisLike {
  async incr(): Promise<number> { throw new Error('Redis down'); }
  async pexpire(): Promise<number> { throw new Error('Redis down'); }
  async eval(): Promise<unknown> { throw new Error('Redis down'); }
}

function makeConfig(
  overrides: Partial<DistributedRateLimiterConfig> & { now: () => number },
): DistributedRateLimiterConfig {
  return {
    defaultLimit: 2,
    defaultWindowMs: 1000,
    defaultNamespace: 'default',
    failOpenOnRedisError: true,
    keyPrefix: 'test',
    ...overrides,
  };
}

describe('DistributedRateLimiter', () => {
  it('allows up to limit requests and rejects the rest', async () => {
    let now = 0;
    const redis = new FakeRedis(() => now);
    const limiter = new DistributedRateLimiter(redis, makeConfig({ now: () => now }));

    const d1 = await limiter.check('user-1');
    expect(d1.allowed).toBe(true);
    expect(d1.used).toBe(1);

    const d2 = await limiter.check('user-1');
    expect(d2.allowed).toBe(true);
    expect(d2.used).toBe(2);

    const d3 = await limiter.check('user-1');
    expect(d3.allowed).toBe(false);
    expect(d3.used).toBe(3);
  });

  it('resets counts after the window boundary', async () => {
    let now = 0;
    const redis = new FakeRedis(() => now);
    const limiter = new DistributedRateLimiter(redis, makeConfig({ now: () => now }));

    await limiter.check('user-1');
    await limiter.check('user-1');
    const d3 = await limiter.check('user-1');
    expect(d3.allowed).toBe(false);

    now = 1100;
    const d4 = await limiter.check('user-1');
    expect(d4.allowed).toBe(true);
    expect(d4.used).toBe(1);
    expect(d4.key).not.toBe(d3.key);
  });

  it('isolates different identifiers', async () => {
    const now = 0;
    const redis = new FakeRedis(() => now);
    const limiter = new DistributedRateLimiter(redis, makeConfig({ now: () => now }));

    await limiter.check('user-A');
    await limiter.check('user-A');
    const rejected = await limiter.check('user-A');
    expect(rejected.allowed).toBe(false);

    const other = await limiter.check('user-B');
    expect(other.allowed).toBe(true);
    expect(other.used).toBe(1);
  });

  it('isolates different namespaces for the same identifier', async () => {
    const now = 0;
    const redis = new FakeRedis(() => now);
    const limiter = new DistributedRateLimiter(redis, makeConfig({ now: () => now }));

    await limiter.check('user-1', { namespace: 'endpoint:login' });
    await limiter.check('user-1', { namespace: 'endpoint:login' });
    const loginRejected = await limiter.check('user-1', { namespace: 'endpoint:login' });
    expect(loginRejected.allowed).toBe(false);

    const catalogOk = await limiter.check('user-1', { namespace: 'endpoint:catalog' });
    expect(catalogOk.allowed).toBe(true);
    expect(catalogOk.used).toBe(1);
  });

  it('respects per-call limit overrides', async () => {
    const now = 0;
    const redis = new FakeRedis(() => now);
    const limiter = new DistributedRateLimiter(redis, makeConfig({ now: () => now }));

    for (let i = 0; i < 5; i++) {
      const d = await limiter.check('user-1', { limit: 5 });
      expect(d.allowed).toBe(true);
    }
    const rejected = await limiter.check('user-1', { limit: 5 });
    expect(rejected.allowed).toBe(false);
    expect(rejected.used).toBe(6);
  });

  it('fails open when Redis is unavailable and failOpenOnRedisError=true', async () => {
    const redis = new FailingRedis();
    const limiter = new DistributedRateLimiter(
      redis,
      makeConfig({ now: () => 0, failOpenOnRedisError: true }),
    );

    const d = await limiter.check('user-1');
    expect(d.allowed).toBe(true);
    expect(d.used).toBe(-1);
  });

  it('fails closed when Redis is unavailable and failOpenOnRedisError=false', async () => {
    const redis = new FailingRedis();
    const limiter = new DistributedRateLimiter(
      redis,
      makeConfig({ now: () => 0, failOpenOnRedisError: false }),
    );

    const d = await limiter.check('user-1');
    expect(d.allowed).toBe(false);
    expect(d.used).toBe(-1);
  });

  it('throws on empty identifier', async () => {
    const redis = new FakeRedis(() => 0);
    const limiter = new DistributedRateLimiter(redis, makeConfig({ now: () => 0 }));

    await expect(limiter.check('')).rejects.toThrow('non-empty string');
  });

  it('throws on invalid limit', async () => {
    const redis = new FakeRedis(() => 0);
    const limiter = new DistributedRateLimiter(redis, makeConfig({ now: () => 0 }));

    await expect(limiter.check('user-1', { limit: 0 })).rejects.toThrow('positive number');
    await expect(limiter.check('user-1', { limit: -5 })).rejects.toThrow('positive number');
  });

  it('throws on invalid windowMs', async () => {
    const redis = new FakeRedis(() => 0);
    const limiter = new DistributedRateLimiter(redis, makeConfig({ now: () => 0 }));

    await expect(limiter.check('user-1', { windowMs: 0 })).rejects.toThrow('positive number');
  });

  it('returns correct resetAtMs aligned to window boundary', async () => {
    const now = 500;
    const redis = new FakeRedis(() => now);
    const limiter = new DistributedRateLimiter(redis, makeConfig({ now: () => now }));

    const d = await limiter.check('user-1', { windowMs: 1000 });
    expect(d.resetAtMs).toBe(1000);
  });
});

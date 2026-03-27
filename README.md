# Distributed Rate Limiter (NestJS + Redis)

A distributed, Redis-backed rate limiter.

## Requirements

- Node.js `>=18.19.0`
- Yarn `>=1.22`
- Redis (local or remote)

## Setup

```bash
yarn install
cp .env.example .env   # edit REDIS_URI if needed
```

## Run

```bash
yarn start:dev
```

Service defaults to `http://localhost:3002`.

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Health check |
| `GET /rate-limit/check?userId=...` | Direct rate limit check (configurable `limit`, `windowMs`, `scope`) |
| `GET /rate-limit/demo/fast` | Demo: 10 req / 10s (pass `x-user-id` header) |
| `GET /rate-limit/demo/slow` | Demo: 2 req / 60s (pass `x-user-id` header) |
| `GET /openapi.json` | OpenAPI JSON |
| `GET /docs` | Scalar API reference UI |

## Tests

```bash
yarn test:unit
```

---

# Distributed Rate Limiter (Fixed Window, Redis-backed)

A distributed rate limiter.
It works correctly when multiple service instances sit behind a load balancer.

## Requirements covered

1. **Per-identifier limits** — default: `userId` (header, user object, or IP fallback)
2. **Configurable limits** — via env vars, API query params, or `@RateLimit()` decorator
3. **Rejection on exceed** — HTTP 429 with `Retry-After`, `X-RateLimit-*` headers
4. **Distributed correctness** — all instances coordinate via Redis atomic Lua script
5. **Per-endpoint limits** (extension) — `@RateLimit()` decorator + `RateLimitGuard`

## How it works

The limiter uses a **fixed-window counter** algorithm implemented in `src/core/rate-limiter/distributed-rate-limiter.ts`.

For each request:

1. Compute the current time bucket: `floor(nowMs / windowMs) * windowMs`
2. Build a Redis key: `{prefix}:rate_limit:{namespace}:{sha256(identifier)}:{bucket}`
3. Execute a **Lua script** that atomically runs `INCR` + `PEXPIRE` in a single round-trip
4. Allow when `used <= limit`, reject otherwise

The Lua script ensures that if the process crashes mid-operation, the key either has both
a counter and a TTL, or doesn't exist at all — no orphaned immortal keys.

```lua
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
```

## Why Redis

- **Atomic counters** (`INCR`) coordinate across multiple instances without locks
- **Key expiry** (`PEXPIRE`) prevents unbounded key growth
- **Lua scripts** run atomically inside Redis, eliminating race conditions
- **Low operational overhead** — Redis is a well-understood, battle-tested store

## Concurrency and consistency

- The Lua script runs atomically inside Redis, so `INCR` + `PEXPIRE` cannot be interrupted
- Even under high concurrency across multiple instances, exactly one caller sees `count == 1`
  and sets the TTL — no distributed locks needed
- Identifiers are SHA256-hashed to keep keys compact and prevent collisions

## Behavior under load

Each request performs **1 Redis round-trip** (the Lua script). No pipelining or secondary
commands needed. This keeps the critical path predictable and bounded.

## Trade-offs considered

**Fixed-window vs. sliding-window:**
- Fixed-window is simpler and faster with strong correctness via atomic `INCR`
- It can allow a short burst at bucket boundaries (e.g., near the exact end of a minute)
- For smoother enforcement, a sliding-window log or token bucket with Lua would be the next step

**Fail-open vs. fail-closed:**
- Configurable via `RATE_LIMIT_FAIL_OPEN` (default: fail open)
- Fail-open risks letting traffic through without limits if Redis is down
- Fail-closed risks blocking all traffic if Redis has a transient issue

**`isAllowed()` is async:**
- The assignment example shows `isAllowed(userId): boolean`
- Our version returns `Promise<boolean>` because the distributed check requires I/O to Redis
- This is the correct design for any non-trivial distributed limiter

## Where this might break in production

1. **Redis unavailable** — if Redis fails and `RATE_LIMIT_FAIL_OPEN=1`, rate limiting is
   effectively disabled. A circuit breaker pattern would improve resilience.
2. **High identifier cardinality** — millions of unique identifiers create many short-lived
   Redis keys. Mitigation: SHA256 hashing (enabled by default) and key TTL auto-cleanup.
3. **Burst at window boundaries** — a user could theoretically make `limit` requests at the
   end of one window and `limit` more at the start of the next, briefly doubling throughput.
4. **Clock skew across instances** — the bucket calculation depends on `Date.now()`. If
   instances have significantly different clocks, they may disagree on the current bucket.

## What I'd change with more time

- **Sliding window** — implement a sliding-window log or weighted hybrid to smooth out
  boundary bursts without significantly increasing Redis complexity
- **Redis connection pooling** — use a connection pool with health checks and circuit breaker
  (e.g., `ioredis` Cluster mode) for production resilience
- **Prometheus metrics** — instrument rejection rates, Redis latency percentiles, and key
  counts as Prometheus counters/histograms for real-time monitoring
- **Integration tests** — spin up a real Redis instance (via Docker/testcontainers) and run
  concurrent load tests to validate correctness under true distributed conditions
- **Token bucket alternative** — provide a pluggable algorithm interface so the limiter
  strategy can be swapped without changing the service/guard layer
- **Rate limit response body standardization** — adopt RFC 7807 (Problem Details) for
  structured error responses on 429s

## API endpoint

`GET /rate-limit/check`

| Param      | Required | Default | Description                  |
|------------|----------|---------|------------------------------|
| `userId`   | yes      | —       | Identifier to rate-limit     |
| `limit`    | no       | 100     | Max requests per window      |
| `windowMs` | no       | 60000   | Window duration (ms)         |
| `scope`    | no       | default | Namespace for independent buckets |

```bash
curl 'http://localhost:3002/rate-limit/check?userId=123&limit=5&windowMs=60000'
```

Response headers on every response:
- `X-RateLimit-Limit` — configured limit
- `X-RateLimit-Remaining` — requests left in current window
- `X-RateLimit-Reset` — Unix epoch (seconds) when the window resets

On 429:
- `Retry-After` — seconds until the window resets

## Per-endpoint rate limiting (extension)

Decorator + guard for scoping rate limits per route:

- `@RateLimit({ limit, windowMs, scope?, identifierSource? })` — sets metadata
- `RateLimitGuard` — reads metadata and enforces the limit

Default scope: `endpoint:{ControllerName}.{handlerName}` (stable, URL-independent).

Identifier resolution order: `x-user-id` header → `request.user.id` → `request.ip`.

Demo endpoints:
- `GET /rate-limit/demo/fast` — 10 requests / 10s
- `GET /rate-limit/demo/slow` — 2 requests / 60s

```bash
curl -H 'x-user-id: user123' 'http://localhost:3002/rate-limit/demo/fast'
```

## Monitoring / metrics ideas

In production, track at minimum:
- **Rejection rate** per namespace/scope (counter)
- **Redis latency** per command (histogram, p50/p95/p99)
- **Redis error rate** (counter, alert threshold)
- **Hot identifiers** — sample `used` counts to detect abuse patterns
- **Key memory** — monitor Redis `INFO memory` for rate limiter key pressure

## Assumptions

- Redis is shared by all instances behind the load balancer
- The identifier (default: `userId`) is stable and trustworthy for the caller
- Clock drift between service instances is negligible (< 1s)

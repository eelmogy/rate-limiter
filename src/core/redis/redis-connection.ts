import Redis, { RedisOptions } from 'ioredis';
import { appConfig } from 'src/config';

const options: RedisOptions = {
  connectTimeout: appConfig.redis.timeoutMs,
  maxRetriesPerRequest: appConfig.redis.maxRetriesPerRequest,
  family: 4,
};

const redis: Redis = new Redis(appConfig.redis.uri, options);

redis.on('error', (error: Error): void => {
  // Keep this module dependency-free; callers can wire proper logging if desired.
  // eslint-disable-next-line no-console
  console.error('Redis connection error', error);
});

export function getRedis() {
  return redis;
}

export function closeRedis() {
  return redis.quit();
}

export { redis as RedisConnection };

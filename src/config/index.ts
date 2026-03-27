import 'dotenv/config';

const getEnv = (key: string, defaultValue: string): string =>
  process.env[key] || defaultValue;

const getEnvInt = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

export interface AppConfig {
  nodeEnv: string;
  isDevelopment: boolean;
  port: number;
  redis: {
    uri: string;
    prefix: string;
    timeoutMs: number;
    maxRetriesPerRequest: number;
  };
}

export const appConfig: AppConfig = {
  nodeEnv: getEnv('NODE_ENV', 'development'),
  isDevelopment: getEnv('NODE_ENV', 'development') === 'development',
  port: getEnvInt('PORT', 3002),
  redis: {
    uri: getEnv('REDIS_URI', 'redis://localhost:6379'),
    prefix: getEnv('REDIS_PREFIX', 'app_'),
    timeoutMs: getEnvInt('REDIS_TIMEOUT_MS', 5000),
    maxRetriesPerRequest: getEnvInt('REDIS_MAX_RETRIES', 10),
  },
};

export default () => appConfig;

import { SetMetadata } from '@nestjs/common';

export interface RateLimitMetadata {
  limit?: number;
  windowMs?: number;
  /**
   * Optional custom scope. If omitted, scope defaults to the endpoint identity
   * (`endpoint:{Controller}.{handler}`).
   */
  scope?: string;
  /**
   * Optional override for how we identify the caller.
   * Default: `x-user-id` header, then `request.user.id`, then `request.ip`.
   */
  identifierSource?: 'header' | 'user' | 'ip';
}

export const RATE_LIMIT_METADATA_KEY = 'rate_limit:options';

export const RateLimit = (options: RateLimitMetadata = {}) =>
  SetMetadata(RATE_LIMIT_METADATA_KEY, options);


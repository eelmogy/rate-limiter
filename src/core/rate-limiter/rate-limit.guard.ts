import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimiterService } from './rate-limiter.service';
import {
  RATE_LIMIT_METADATA_KEY,
  RateLimitMetadata,
} from './rate-limit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const handler = context.getHandler();
    const controller = context.getClass();

    const meta: RateLimitMetadata =
      this.reflector.get<RateLimitMetadata>(RATE_LIMIT_METADATA_KEY, handler) ??
      {};

    const scope =
      meta.scope?.trim() ||
      `endpoint:${controller?.name ?? 'UnknownController'}.${handler?.name ?? 'unknown'}`;

    const identifier = this.getIdentifier(request, meta.identifierSource);
    const decision = await this.rateLimiter.check(identifier, {
      limit: meta.limit,
      windowMs: meta.windowMs,
      namespace: scope,
    });

    const remaining = Math.max(0, decision.limit - decision.used);
    const resetEpochSeconds = Math.ceil(decision.resetAtMs / 1000);

    response?.setHeader?.('X-RateLimit-Limit', decision.limit);
    response?.setHeader?.('X-RateLimit-Remaining', remaining);
    response?.setHeader?.('X-RateLimit-Reset', resetEpochSeconds);

    if (!decision.allowed) {
      const retryAfterMs = Math.max(0, decision.resetAtMs - Date.now());
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
      response?.setHeader?.('Retry-After', retryAfterSec.toString());

      throw new HttpException(
        { message: 'Rate limit exceeded', ...decision, scope, identifier },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getIdentifier(
    request: any,
    source: RateLimitMetadata['identifierSource'] = 'header',
  ): string {
    if (source === 'header') {
      const fromHeader =
        request?.headers?.['x-user-id'] ??
        request?.headers?.['X-User-Id'] ??
        request?.headers?.['x-userid'];
      if (typeof fromHeader === 'string' && fromHeader.trim()) {
        return fromHeader.trim();
      }
    }

    if (source === 'user') {
      const fromUser = request?.user?.id ?? request?.user?.userId;
      if (typeof fromUser === 'string' && fromUser.trim()) return fromUser.trim();
      if (typeof fromUser === 'number') return String(fromUser);
    }

    const ip =
      request?.ip ??
      request?.socket?.remoteAddress ??
      request?.connection?.remoteAddress ??
      'unknown';
    return typeof ip === 'string' && ip.trim() ? ip.trim() : 'unknown';
  }
}


import {
  Controller,
  Get,
  HttpStatus,
  HttpException,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { RateLimiterService } from '@core/rate-limiter/rate-limiter.service';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';

class CheckRateLimitQueryDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  windowMs?: number;

  @IsOptional()
  @IsString()
  scope?: string;
}

@ApiTags('rate-limit')
@Controller('rate-limit')
export class RateLimiterController {
  constructor(private readonly rateLimiter: RateLimiterService) {}

  @Get('check')
  @ApiOperation({ summary: 'Check a rate limit for an identifier' })
  @ApiQuery({ name: 'userId', required: true, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'windowMs', required: false, type: Number })
  @ApiQuery({ name: 'scope', required: false, type: String })
  @ApiOkResponse({
    description: 'Allowed. Returns decision details and rate-limit headers.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Rejected. Includes Retry-After and decision details.',
  })
  async check(
    @Query() query: CheckRateLimitQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const namespace = query.scope?.trim() || 'default';
    const decision = await this.rateLimiter.check(query.userId, {
      limit: query.limit,
      windowMs: query.windowMs,
      namespace,
    });

    const remaining = Math.max(0, decision.limit - decision.used);
    const resetEpochSeconds = Math.ceil(decision.resetAtMs / 1000);

    res.setHeader('X-RateLimit-Limit', decision.limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetEpochSeconds);

    if (!decision.allowed) {
      const retryAfterMs = Math.max(0, decision.resetAtMs - Date.now());
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
      res.setHeader('Retry-After', retryAfterSec.toString());

      throw new HttpException(
        { message: 'Rate limit exceeded', ...decision },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return { statusCode: HttpStatus.OK, ...decision };
  }
}

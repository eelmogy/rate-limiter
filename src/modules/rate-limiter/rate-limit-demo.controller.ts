import { Controller, Get, UseGuards } from '@nestjs/common';
import { RateLimit } from '@core/rate-limiter/rate-limit.decorator';
import { RateLimitGuard } from '@core/rate-limiter/rate-limit.guard';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('rate-limit')
@Controller('rate-limit/demo')
@UseGuards(RateLimitGuard)
export class RateLimitDemoController {
  @Get('fast')
  @RateLimit({ limit: 10, windowMs: 10_000 })
  @ApiOperation({ summary: 'Demo endpoint: 10 requests per 10 seconds' })
  fast() {
    return { ok: true, endpoint: 'fast' };
  }

  @Get('slow')
  @RateLimit({ limit: 2, windowMs: 60_000 })
  @ApiOperation({ summary: 'Demo endpoint: 2 requests per 60 seconds' })
  slow() {
    return { ok: true, endpoint: 'slow' };
  }
}

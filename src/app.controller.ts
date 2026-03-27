import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller()
export class AppController {
  constructor() {}

  @Get()
  @ApiOperation({ summary: 'Health check' })
  getAppStatus() {
    return {
      uptime: process.uptime(),
      message: 'Rate limiter service is running',
      timestamp: Date.now(),
    };
  }
}

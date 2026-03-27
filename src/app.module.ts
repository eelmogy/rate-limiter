import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { RateLimiterModule } from '@modules/rate-limiter/rate-limiter.module';

@Module({
  imports: [
    RateLimiterModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}

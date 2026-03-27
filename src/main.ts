import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { appConfig } from 'src/config';
import { closeRedis } from '@core/redis/redis-connection';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Request, Response } from 'express';

export async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
      transformOptions: {
        enableImplicitConversion: true,
        exposeDefaultValues: true,
      },
    }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('Rate Limiter Service')
    .setDescription('Distributed Redis-backed rate limiter (MLS take-home assignment)')
    .setVersion('1.0.0')
    .build();

  const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);

  app.use('/openapi.json', (_req: Request, res: Response) => {
    res.json(openApiDocument);
  });

  app.use(
    '/docs',
    apiReference({
      url: '/openapi.json',
    }),
  );

  return app;
}
bootstrap()
  .then(async (app) => {
    await app.listen(appConfig.port);
    // eslint-disable-next-line no-console
    console.log(`Rate limiter listening on ${await app.getUrl()}`);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await closeRedis().catch(() => {});
    process.exitCode = 1;
  });

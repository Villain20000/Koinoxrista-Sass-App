import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import helmet from 'helmet';

import { AppModule } from './app/app.module';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}

function corsOrigins(): string[] | boolean {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return process.env.NODE_ENV === 'production' ? false : true;
  return raw.split(',').map((origin) => origin.trim());
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? undefined
          : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' ||
    process.env.SWAGGER_ENABLED === '1';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('PolykatoikiaOS API')
      .setDescription('Building management API for Greek apartment blocks')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(`${globalPrefix}/docs`, app, document);
    Logger.log(`📚 Swagger docs available at /${globalPrefix}/docs`);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();

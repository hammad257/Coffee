import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import * as express from 'express';
import rateLimit from 'express-rate-limit';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;

  app.setGlobalPrefix('api/v1');

  // whitelist strips unknown fields; transform auto-converts types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN') ?? '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Browsers / Swagger must be allowed to send this on cross-origin POSTs; Stripe CLI is unaffected.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-refresh-token',
      'stripe-signature',
    ],
    credentials: true,
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Auth hardening: login brute-force protection (5 requests / minute / IP)
  app.use(
    '/api/v1/auth/login',
    rateLimit({
      windowMs: 60_000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: 'Too many login attempts. Try again later.',
    }),
  );

  app.use(
    '/api/v1/auth/signup',
    rateLimit({
      windowMs: 60_000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: 'Too many signup attempts. Try again later.',
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Coffee Shop POS API')
    .setDescription('Élite de Paris — backend API')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste only accessToken here (without "Bearer " prefix).',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

   app.use('/uploads', express.static(join(__dirname, '..', 'uploads')));

  await app.listen(port);
}

void bootstrap();

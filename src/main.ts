import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { join } from 'path';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const configService = app.get(ConfigService);

  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');

  const port = configService.get<number>('PORT', 3000);

  /**
   * نقرأ Origins المسموحة من ملف .env:
   *
   * CORS_ORIGINS=http://localhost:3001,http://127.0.0.1:3001
   */
  const allowedOrigins = configService
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  /**
   * مهم جدًا أن يتم تفعيل CORS قبل تسجيل staticFiles،
   * حتى تحصل صور /uploads على Headers الخاصة بـ CORS.
   */
  app.enableCors({
    origin(origin, callback) {
      /**
       * الطلبات التي لا ترسل Origin مثل:
       * Postman
       * curl
       * Wasender Webhook
       * الاتصالات الداخلية
       */
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked origin: ${origin}`), false);
    },

    credentials: true,

    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Webhook-Signature',
    ],

    exposedHeaders: ['Content-Type', 'Content-Length', 'Content-Disposition'],
  });

  /**
   * السماح باستخدام الصور من Origin مختلف.
   *
   * الفرونت:
   * http://localhost:3001
   *
   * الصور:
   * https://...trycloudflare.com/uploads/...
   */
  await app.register(helmet, {
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
  });

  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
    },
  });

  /**
   * ملفات:
   * uploads/digital-tickets/generated/...
   *
   * تصبح متاحة عبر:
   * /uploads/digital-tickets/generated/...
   */
  await app.register(staticFiles, {
    root: join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
  });

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(port, '0.0.0.0');

  console.log(`Backend running on http://0.0.0.0:${port}`);
  console.log(`Allowed CORS origins:`, allowedOrigins);
}

bootstrap().catch((error) => {
  console.error('Backend bootstrap failed:', error);
  process.exit(1);
});

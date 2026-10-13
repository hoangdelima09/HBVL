import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { sessionMiddleware } from './auth/session.middleware';
import { SessionService } from './auth/session.service';
import { createLogger, PinoNestLogger } from './common/logger';
import { globalRateLimit } from './common/rate-limit';
import { requestContext } from './common/request-context';
import { loadEnv } from './config/env';
import { RedisService } from './redis/redis.service';

export function buildOpenApi(app: INestApplication, cookieName: string) {
  const cfg = new DocumentBuilder()
    .setTitle('HBVL API')
    .setDescription('Học Bổng Vươn Lên — REST API (same-origin, cookie session + CSRF). Request bodies are validated by strict Zod schemas in the controllers.')
    .setVersion('1.0')
    .addCookieAuth(cookieName)
    .build();
  return SwaggerModule.createDocument(app, cfg);
}

export async function createApp(): Promise<INestApplication> {
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL);
  const app = await NestFactory.create(AppModule, { logger: new PinoNestLogger(log), bodyParser: false });
  const http = app.getHttpAdapter().getInstance() as express.Express;

  http.disable('x-powered-by');
  // Only trust X-Forwarded-* from the configured number of proxy hops; 0 = never trust (direct exposure / tests).
  http.set('trust proxy', env.TRUST_PROXY);
  http.set('etag', false);

  app.use(requestContext(log));
  // API responses carry JSON only: lock down everything else; no framing, no sniffing.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: env.COOKIE_SECURE ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.use(globalRateLimit(app.get(RedisService), env, env.GLOBAL_RATE_LIMIT_PER_MIN));
  app.use(sessionMiddleware(app.get(SessionService), env));
  // Authenticated and personal responses must never be stored by shared caches. Public controllers opt in explicitly.
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.setGlobalPrefix('api/v1');
  // No CORS: the browser only ever talks to the same origin (/api/v1 is proxied). CORS is not an authorisation mechanism.

  if (env.ENABLE_OPENAPI) SwaggerModule.setup('api/v1/docs', app, buildOpenApi(app, env.SESSION_COOKIE_NAME), { jsonDocumentUrl: 'api/v1/openapi.json' });
  app.enableShutdownHooks();
  return app;
}

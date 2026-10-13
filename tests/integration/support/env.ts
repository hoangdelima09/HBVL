import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';

// Tests must NEVER send real e-mail, whatever SMTP the developer put in .env (e.g. Gmail): force the local Mailpit sink.
const MAILPIT_SMTP = {
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: process.env.MAILPIT_SMTP_PORT ?? '51025',
  SMTP_SECURE: 'false',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  MAIL_FROM: 'Học Bổng Vươn Lên <no-reply@hbvl.local>',
};

/** Loads the repo-root .env and derives test-only connection settings. Everything is namespaced (hbvl_test DB, Redis db 5, bucket hbvl-test). */
export function loadTestEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      config({ path: resolve(dir, '.env'), quiet: true });
      break;
    }
    dir = dirname(dir);
  }
  const e = process.env;
  const dbName = e.TEST_DB_NAME ?? 'hbvl_test';
  const host = e.POSTGRES_HOST ?? '127.0.0.1';
  const port = e.POSTGRES_PORT ?? '55432';
  const url = (user: string, pw: string) => `postgresql://${user}:${encodeURIComponent(pw)}@${host}:${port}/${dbName}`;
  const redis = new URL(e.REDIS_URL!);
  redis.pathname = '/5';
  return {
    dbName,
    adminUrl: `postgresql://postgres:${encodeURIComponent(e.POSTGRES_ADMIN_PASSWORD!)}@${host}:${port}/postgres`,
    adminDbUrl: `postgresql://postgres:${encodeURIComponent(e.POSTGRES_ADMIN_PASSWORD!)}@${host}:${port}/${dbName}`,
    migratorUrl: url(e.POSTGRES_MIGRATOR_USER ?? 'hbvl_migrator', e.POSTGRES_MIGRATOR_PASSWORD!),
    appUrl: url(e.POSTGRES_APP_USER ?? 'hbvl_app', e.POSTGRES_APP_PASSWORD!),
    redisUrl: redis.toString(),
    appUser: e.POSTGRES_APP_USER ?? 'hbvl_app',
    migratorUser: e.POSTGRES_MIGRATOR_USER ?? 'hbvl_migrator',
  };
}

/** Applied to process.env BEFORE the API is imported (the API reads its configuration once). */
export function applyTestEnv() {
  const t = loadTestEnv();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_ENV: 'ci',
    DATABASE_URL: t.appUrl,
    MIGRATION_DATABASE_URL: t.migratorUrl,
    REDIS_URL: t.redisUrl,
    PUBLIC_ORIGIN: 'http://localhost:3100',
    S3_BUCKET_PRIVATE: 'hbvl-test',
    THROTTLE_DISABLED: process.env.TEST_KEEP_THROTTLE === '1' ? 'false' : 'true',
    LOG_LEVEL: 'silent',
    ENABLE_OPENAPI: 'false',
    ...MAILPIT_SMTP,
    GEMINI_API_KEY: '', // never reach Google from tests; chat.spec.ts points it at a local fake before boot
  });
  return t;
}

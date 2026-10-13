import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';

export const ports = { web: 3200, api: 3201 };

function root(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root not found');
}

// Tests must NEVER send real e-mail, whatever SMTP the developer put in .env (e.g. Gmail): force the local Mailpit sink.
const MAILPIT_SMTP = {
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: process.env.MAILPIT_SMTP_PORT ?? '51025',
  SMTP_SECURE: 'false',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  MAIL_FROM: 'Học Bổng Vươn Lên <no-reply@hbvl.local>',
};

/** Environment for the E2E stack. Secrets are read from the (git-ignored) repo-root .env; nothing is hard-coded. */
export function e2eEnv(): Record<string, string> {
  config({ path: resolve(root(), '.env'), quiet: true });
  const e = process.env as Record<string, string>;
  const host = e.POSTGRES_HOST ?? '127.0.0.1',
    port = e.POSTGRES_PORT ?? '55432';
  const dbName = 'hbvl_e2e';
  const redis = new URL(e.REDIS_URL!);
  redis.pathname = '/6';
  return {
    ...e,
    NODE_ENV: 'production',
    APP_ENV: 'ci',
    COOKIE_SECURE: 'false', // production build, plain-HTTP localhost
    PUBLIC_ORIGIN: `http://localhost:${ports.web}`,
    API_PORT: String(ports.api),
    WEB_PORT: String(ports.web),
    API_INTERNAL_URL: `http://127.0.0.1:${ports.api}`,
    DATABASE_URL: `postgresql://${e.POSTGRES_APP_USER}:${encodeURIComponent(e.POSTGRES_APP_PASSWORD!)}@${host}:${port}/${dbName}`,
    MIGRATION_DATABASE_URL: `postgresql://${e.POSTGRES_MIGRATOR_USER}:${encodeURIComponent(e.POSTGRES_MIGRATOR_PASSWORD!)}@${host}:${port}/${dbName}`,
    REDIS_URL: redis.toString(),
    S3_BUCKET_PRIVATE: 'hbvl-e2e',
    THROTTLE_DISABLED: 'false',
    LOG_LEVEL: 'warn',
    ENABLE_OPENAPI: 'false',
    TRUST_PROXY: '1',
    GLOBAL_RATE_LIMIT_PER_MIN: '12000',
    RATE_LIMIT_MULTIPLIER: '50',
    // E2E must never reach Google: with an empty key the assistant runs in retrieval-only mode (the AI path is covered by the integration test with a fake upstream).
    GEMINI_API_KEY: '',
    ...MAILPIT_SMTP,
    EMAIL_ATTEMPTS: '3',
    EMAIL_BACKOFF_MS: '500',
  };
}
export const repoRoot = root;
export const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? '58025'}/api/v1`;

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'ci', 'staging', 'production']).default('local'),
  PUBLIC_ORIGIN: z.url(),
  EXTRA_ALLOWED_ORIGINS: z.string().default(''),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3101),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(true),
  S3_BUCKET_PRIVATE: z.string().min(3).max(63),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int(),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  MAIL_FROM: z.string().min(3),
  CONTACT_INBOX_EMAIL: z.email(),
  SESSION_COOKIE_NAME: z.string().default('hbvl_sid'),
  CSRF_SECRET: z.string().min(32),
  TOKEN_HASH_PEPPER: z.string().min(32),
  MFA_ENCRYPTION_KEY: z.string().min(40), // base64 of 32 bytes
  COOKIE_SECURE: bool.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENABLE_OPENAPI: bool.default(true),
  /** Test-only: disable per-IP throttling noise; ignored in production. */
  THROTTLE_DISABLED: bool.default(false),
  /** Safety-net ceiling per client IP for ALL requests (SSR forwards the visitor's IP). Specific endpoints have far tighter limits. */
  GLOBAL_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(60).max(1_000_000).default(1200),
  /** Scales every endpoint-specific rate limit (E2E/load tests raise it; production keeps 1). */
  RATE_LIMIT_MULTIPLIER: z.coerce.number().min(1).max(10_000).default(1),
  /** AI site assistant (Gemini). Empty key ⇒ the assistant still answers, in retrieval-only mode. The key stays server-side. */
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().min(1).default('gemini-flash-latest'),
  /** Tried when the primary model is overloaded (429/5xx) or times out. Same as GEMINI_MODEL ⇒ no second attempt. */
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_API_BASE: z.url().default('https://generativelanguage.googleapis.com/v1beta'),
  CHAT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(20_000),
  EMAIL_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(6),
  EMAIL_BACKOFF_MS: z.coerce.number().int().min(50).max(3_600_000).default(30_000),
});

export type Env = z.infer<typeof schema>;

/** Walk up from cwd to find the repo-root .env (dev/test). In production variables come from the process environment. */
function findDotenv(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate) && existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let cached: Env | undefined;
export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const file = findDotenv();
  if (file && process.env.NODE_ENV !== 'production') loadDotenv({ path: file, quiet: true });
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  const env = parsed.data;
  // Strict only for the real production environment (APP_ENV=production); CI/E2E runs the production build over plain-HTTP localhost.
  if (env.APP_ENV === 'production') {
    if (env.NODE_ENV !== 'production') throw new Error('APP_ENV=production requires NODE_ENV=production');
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (env.PUBLIC_ORIGIN.startsWith('http://')) throw new Error('PUBLIC_ORIGIN must be https in production');
    if (/CHANGE_ME/i.test(JSON.stringify(env))) throw new Error('Placeholder secrets detected in production configuration');
  }
  if (Object.keys(overrides).length === 0) cached = env;
  return env;
}

/** Test hook: forget the memoised configuration so a test can change process.env and boot another app/worker. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const ENV = Symbol('ENV');

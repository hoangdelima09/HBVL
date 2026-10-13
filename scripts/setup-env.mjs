#!/usr/bin/env node
// Generates a local .env (and .runtime/seaweedfs-s3.json) from .env.example with random secrets.
// Idempotent: refuses to overwrite an existing .env unless --force is given.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const force = process.argv.includes('--force');
if (existsSync(envPath) && !force) {
  console.log('.env already exists — leaving it untouched (use --force to regenerate).');
  process.exit(0);
}

const hex = (bytes = 24) => randomBytes(bytes).toString('hex');
const secrets = {
  POSTGRES_ADMIN_PASSWORD: hex(),
  POSTGRES_APP_PASSWORD: hex(),
  POSTGRES_MIGRATOR_PASSWORD: hex(),
  REDIS_PASSWORD: hex(),
  S3_ACCESS_KEY: 'hbvl' + hex(6),
  S3_SECRET_KEY: hex(24),
  CSRF_SECRET: randomBytes(48).toString('base64'),
  TOKEN_HASH_PEPPER: randomBytes(48).toString('base64'),
  MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  LEGACY_MYSQL_PASSWORD: hex(12),
};

let text = readFileSync(resolve(root, '.env.example'), 'utf8');
for (const [k, v] of Object.entries(secrets)) {
  if (k === 'LEGACY_MYSQL_PASSWORD') continue;
  text = text.replace(new RegExp(`^${k}=CHANGE_ME.*$`, 'm'), `${k}=${v}`);
}
const get = (k) =>
  new RegExp(`^${k}=(.*)$`, 'm')
    .exec(text)[1]
    .replace(/\s+#.*$/, '')
    .trim();
const set = (k, v) => (text = text.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`));
set('DATABASE_URL', `postgresql://${get('POSTGRES_APP_USER')}:${get('POSTGRES_APP_PASSWORD')}@${get('POSTGRES_HOST')}:${get('POSTGRES_PORT')}/${get('POSTGRES_DB')}`);
set(
  'MIGRATION_DATABASE_URL',
  `postgresql://${get('POSTGRES_MIGRATOR_USER')}:${get('POSTGRES_MIGRATOR_PASSWORD')}@${get('POSTGRES_HOST')}:${get('POSTGRES_PORT')}/${get('POSTGRES_DB')}`,
);
set('REDIS_URL', `redis://:${get('REDIS_PASSWORD')}@${get('REDIS_HOST')}:${get('REDIS_PORT')}`);
set('LEGACY_MYSQL_URL', `mysql://root:${secrets.LEGACY_MYSQL_PASSWORD}@127.0.0.1:33061/sampleweb_wp`);

writeFileSync(envPath, text, { mode: 0o600 });
mkdirSync(resolve(root, '.runtime'), { recursive: true });
const s3ConfigPath = resolve(root, '.runtime/seaweedfs-s3.json');
writeFileSync(
  s3ConfigPath,
  JSON.stringify(
    {
      identities: [
        {
          name: 'hbvl',
          credentials: [{ accessKey: get('S3_ACCESS_KEY'), secretKey: get('S3_SECRET_KEY') }],
          actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
        },
      ],
    },
    null,
    2,
  ),
  { mode: 0o644 },
);
// Bind-mounted read-only into the SeaweedFS container, which runs as a different uid than the host user
// (e.g. GitHub runner uid 1001 vs container uid 1000): a 0600 file is unreadable there. Dev-only credentials.
chmodSync(s3ConfigPath, 0o644);
console.log('Wrote .env and .runtime/seaweedfs-s3.json (both git-ignored).');

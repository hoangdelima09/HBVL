#!/usr/bin/env node
// Creates an empty, fully migrated + reference-seeded database for rehearsals (e.g. a WordPress migration dry run on realistic data)
// without touching the main one:   pnpm db:create hbvl_migration     (add --drop to recreate)
// Uses the admin/migrator/app roles from the repository .env.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const env = { ...readEnv(resolve(root, '.env')), ...process.env };
function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => /^([A-Z0-9_]+)=([^#]*?)\s*(#.*)?$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
}
const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9_]{2,40}$/.test(name)) {
  console.error('usage: create-db.mjs <database_name> [--drop]');
  process.exit(2);
}
const need = (k) => env[k] || (console.error(`${k} missing in .env`), process.exit(2));
const host = need('POSTGRES_HOST');
const port = need('POSTGRES_PORT');
const url = (user, pw, db) => `postgresql://${user}:${encodeURIComponent(pw)}@${host}:${port}/${db}`;
const admin = new pg.Client({ connectionString: url('postgres', need('POSTGRES_ADMIN_PASSWORD'), 'postgres') });
await admin.connect();
const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount > 0;
if (exists && process.argv.includes('--drop')) {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [name]);
  await admin.query(`DROP DATABASE ${name}`);
}
if (!exists || process.argv.includes('--drop')) await admin.query(`CREATE DATABASE ${name} OWNER ${need('POSTGRES_MIGRATOR_USER')}`);
await admin.end();
const db = new pg.Client({ connectionString: url('postgres', need('POSTGRES_ADMIN_PASSWORD'), name) });
await db.connect();
const mig = env.POSTGRES_MIGRATOR_USER;
const app = env.POSTGRES_APP_USER;
for (const sql of [
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  'CREATE EXTENSION IF NOT EXISTS pgcrypto',
  `ALTER SCHEMA public OWNER TO ${mig}`,
  `GRANT CONNECT ON DATABASE ${name} TO ${app}`,
  `GRANT USAGE ON SCHEMA public TO ${app}`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE ${mig} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE ${mig} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}`,
])
  await db.query(sql);
await db.end();
const childEnv = { ...process.env, MIGRATION_DATABASE_URL: url(mig, need('POSTGRES_MIGRATOR_PASSWORD'), name) };
execFileSync('pnpm', ['--filter', '@hbvl/database', 'exec', 'prisma', 'migrate', 'deploy'], { cwd: root, env: childEnv, stdio: 'inherit' });
execFileSync('pnpm', ['--filter', '@hbvl/database', 'exec', 'tsx', 'prisma/seed.ts'], { cwd: root, env: childEnv, stdio: 'inherit' });
console.log(
  `\nDatabase "${name}" ready.\nApp URL      : postgresql://${app}:<POSTGRES_APP_PASSWORD>@${host}:${port}/${name}\nMigrator URL : postgresql://${mig}:<POSTGRES_MIGRATOR_PASSWORD>@${host}:${port}/${name}`,
);

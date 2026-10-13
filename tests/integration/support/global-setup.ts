import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { loadTestEnv } from './env';

/** Creates a clean `hbvl_test` database (same engine/version as production), applies the real migrations, seeds reference data. */
export default async function setup() {
  const t = loadTestEnv();
  const admin = new pg.Client({ connectionString: t.adminUrl });
  await admin.connect();
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${t.dbName}'`);
  await admin.query(`DROP DATABASE IF EXISTS ${t.dbName}`);
  await admin.query(`CREATE DATABASE ${t.dbName} OWNER ${t.migratorUser}`);
  await admin.end();

  const db = new pg.Client({ connectionString: t.adminDbUrl });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await db.query(`ALTER SCHEMA public OWNER TO ${t.migratorUser}`);
  await db.query(`GRANT CONNECT ON DATABASE ${t.dbName} TO ${t.appUser}`);
  await db.query(`GRANT USAGE ON SCHEMA public TO ${t.appUser}`);
  await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${t.migratorUser} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${t.appUser}`);
  await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${t.migratorUser} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${t.appUser}`);
  await db.end();

  const repo = resolve(__dirname, '../../..');
  const env = { ...process.env, MIGRATION_DATABASE_URL: t.migratorUrl };
  execFileSync('pnpm', ['--filter', '@hbvl/database', 'exec', 'prisma', 'migrate', 'deploy'], { cwd: repo, env, stdio: 'pipe' });
  execFileSync('pnpm', ['--filter', '@hbvl/database', 'exec', 'tsx', 'prisma/seed.ts'], { cwd: repo, env, stdio: 'pipe' });
}

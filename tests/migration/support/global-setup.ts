import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { migrationTestEnv } from './env';

/**
 * Prepares (1) an empty, migrated and reference-seeded PostgreSQL database `hbvl_migtest` and (2) a throw-away MariaDB container holding the
 * SYNTHETIC fixture dump. The real WordPress dump is never used by automated tests.
 */
export default function setup() {
  const t = migrationTestEnv();
  const env = { ...process.env, ...t.baseEnv };
  execFileSync('node', [resolve(t.repoRoot, 'packages/database/scripts/create-db.mjs'), t.dbName, '--drop'], { cwd: t.repoRoot, env, stdio: 'pipe' });
  execFileSync('node', [resolve(t.repoRoot, 'scripts/migration/restore-legacy.mjs')], {
    cwd: t.repoRoot,
    stdio: 'pipe',
    env: {
      ...env,
      LEGACY_SQL_DUMP: t.fixture,
      LEGACY_CONTAINER: t.legacy.container,
      LEGACY_DB_NAME: t.legacy.db,
      LEGACY_MYSQL_URL: `mysql://root:${encodeURIComponent(t.legacy.password)}@127.0.0.1:${t.legacy.port}/${t.legacy.db}`,
      LEGACY_MYSQL_PASSWORD: t.legacy.password,
    },
  });
  return () => {
    try {
      execFileSync('docker', ['rm', '-f', t.legacy.container], { stdio: 'pipe' });
    } catch {
      /* already gone */
    }
  };
}

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const repoRoot = resolve(__dirname, '../../..');

function dotenv(): Record<string, string> {
  const file = resolve(repoRoot, '.env');
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => /^([A-Z0-9_]+)=([^#]*?)\s*(#.*)?$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1]!, m[2]!]),
  );
}

/** Everything the migration tests need, derived from the repository .env (local throw-away services only). */
export function migrationTestEnv() {
  const e = { ...dotenv(), ...process.env } as Record<string, string>;
  const need = (k: string) =>
    e[k] ??
    (() => {
      throw new Error(`${k} missing — run \`pnpm setup:env\` and start the compose services first`);
    })();
  const dbName = 'hbvl_migtest';
  const pgUrl = (user: string, pw: string, db: string) => `postgresql://${user}:${encodeURIComponent(pw)}@${need('POSTGRES_HOST')}:${need('POSTGRES_PORT')}/${db}`;
  const legacyPw = decodeURIComponent(new URL(need('LEGACY_MYSQL_URL')).password);
  const legacyPort = e.LEGACY_TEST_MYSQL_PORT ?? '33062';
  return {
    repoRoot,
    dbName,
    bucket: 'hbvl-migtest',
    migratorUrl: pgUrl(need('POSTGRES_MIGRATOR_USER'), need('POSTGRES_MIGRATOR_PASSWORD'), dbName),
    appUrl: pgUrl(need('POSTGRES_APP_USER'), need('POSTGRES_APP_PASSWORD'), dbName),
    adminDbUrl: pgUrl('postgres', need('POSTGRES_ADMIN_PASSWORD'), dbName),
    legacy: {
      container: 'hbvl-wp-restore-test',
      port: legacyPort,
      db: 'legacy_fixture',
      password: legacyPw,
      rootUrl: `mysql://root:${encodeURIComponent(legacyPw)}@127.0.0.1:${legacyPort}/legacy_fixture`,
    },
    fixture: resolve(repoRoot, 'tests/fixtures/legacy/mini.sql'),
    baseEnv: e,
  };
}

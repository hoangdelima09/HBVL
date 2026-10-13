#!/usr/bin/env node
// Restores a WordPress SQL dump into a THROWAWAY MariaDB container so the migration can read it with plain SELECTs.
// The dump itself is never modified and never copied into this repository. The container is bound to 127.0.0.1 only.
//
//   LEGACY_SQL_DUMP=/path/to/dump.sql node scripts/migration/restore-legacy.mjs [--drop]
//
// Port/password come from .env (LEGACY_MYSQL_URL / LEGACY_MYSQL_PASSWORD). `--drop` removes the container and exits.
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = { ...readDotEnv(resolve(root, '.env')), ...process.env };
const NAME = env.LEGACY_CONTAINER || 'hbvl-wp-restore';
const IMAGE = env.LEGACY_MARIADB_IMAGE || 'mariadb:11.4';
const DB = env.LEGACY_DB_NAME || 'sampleweb_wp';
const url = new URL(env.LEGACY_MYSQL_URL || 'mysql://root:x@127.0.0.1:33061/' + DB);
const PORT = url.port || '33061';
const PASSWORD = env.LEGACY_MYSQL_PASSWORD || decodeURIComponent(url.password);

function readDotEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=([^#]*?)\s*(#.*)?$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opts });

docker(['rm', '-f', NAME]);
if (process.argv.includes('--drop')) {
  console.log(`removed ${NAME}`);
  process.exit(0);
}

const dump = env.LEGACY_SQL_DUMP;
if (!dump || !existsSync(dump)) {
  console.error('LEGACY_SQL_DUMP must point at an existing .sql file (outside this repository).');
  process.exit(2);
}
if (!PASSWORD) {
  console.error('LEGACY_MYSQL_PASSWORD is empty — run `pnpm setup:env` first.');
  process.exit(2);
}

const run = docker([
  'run',
  '-d',
  '--name',
  NAME,
  '-p',
  `127.0.0.1:${PORT}:3306`,
  '-e',
  `MARIADB_ROOT_PASSWORD=${PASSWORD}`,
  '-e',
  `MARIADB_DATABASE=${DB}`,
  '--label',
  'hbvl.purpose=legacy-restore',
  IMAGE,
  '--character-set-server=utf8mb4',
  '--collation-server=utf8mb4_unicode_520_ci',
  '--max-allowed-packet=64M',
]);
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(1);
}

const mysql = (args, input) =>
  docker(['exec', ...(input ? ['-i'] : []), '-e', `MYSQL_PWD=${PASSWORD}`, NAME, 'mariadb', '-uroot', '--default-character-set=utf8mb4', ...args], input ? { input } : {});
for (let i = 0; ; i++) {
  if (mysql(['-e', 'SELECT 1']).status === 0) break;
  if (i > 90) {
    console.error('MariaDB did not become ready');
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

await new Promise((resolveP, reject) => {
  const p = spawn('docker', ['exec', '-i', '-e', `MYSQL_PWD=${PASSWORD}`, NAME, 'mariadb', '-uroot', '--default-character-set=utf8mb4', DB], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  createReadStream(dump).pipe(p.stdin);
  p.on('exit', (c) => (c === 0 ? resolveP() : reject(new Error(`import exited ${c}`))));
});
// Read-only account for the migration (SELECT only); the migration never needs to write to the restore DB.
const readerPw = PASSWORD;
mysql(['-e', `CREATE USER IF NOT EXISTS 'hbvl_reader'@'%' IDENTIFIED BY '${readerPw}'; GRANT SELECT ON ${DB}.* TO 'hbvl_reader'@'%'; FLUSH PRIVILEGES;`]);
const tables = mysql(['-N', '-e', `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB}'`]).stdout.trim();
console.log(`restored into ${NAME} (${IMAGE}) on 127.0.0.1:${PORT}: ${tables} tables. Read-only user: hbvl_reader.`);

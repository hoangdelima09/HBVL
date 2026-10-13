#!/usr/bin/env node
// `pnpm test:load` — builds nothing (run `pnpm build` first). Creates a throw-away database `hbvl_load` with ~300 published posts and 5 members,
// starts the PRODUCTION build (API + worker + Next standalone, one process each), and drives it with k6 (Docker image, pinned).
//   VUS=100 DURATION=5m (defaults) · K6_IMAGE=grafana/k6:2.3.0 · REPORT_DIR=reports/load
// NOTE: every virtual user shares one IP, so the per-IP rate limits are raised for this run only (GLOBAL_RATE_LIMIT_PER_MIN, RATE_LIMIT_MULTIPLIER).
// Production limits are unchanged and are covered by the rate-limit integration tests.
import { execFileSync, spawn } from 'node:child_process';
import { openSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const argon2 = require('argon2');
const pg = require('pg');
const { Redis } = require('ioredis');
const dotenv = Object.fromEntries(
  readFileSync(resolve(root, '.env'), 'utf8')
    .split('\n')
    .map((l) => /^([A-Z0-9_]+)=([^#]*?)\s*(#.*)?$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const WEB = 3400;
const API = 3401;
const DB = 'hbvl_load';
const VUS = process.env.VUS ?? '100';
const DURATION = process.env.DURATION ?? '5m';
const K6_IMAGE = process.env.K6_IMAGE ?? 'grafana/k6:2.3.0';
const reportDir = resolve(root, process.env.REPORT_DIR ?? 'reports/load');
mkdirSync(reportDir, { recursive: true });

const pgUrl = (user, pw, db = DB) => `postgresql://${user}:${encodeURIComponent(pw)}@${dotenv.POSTGRES_HOST}:${dotenv.POSTGRES_PORT}/${db}`;
const redis = new URL(dotenv.REDIS_URL);
redis.pathname = '/10';
const env = {
  ...process.env,
  ...dotenv,
  NODE_ENV: 'production',
  APP_ENV: 'ci',
  COOKIE_SECURE: 'false',
  PUBLIC_ORIGIN: `http://localhost:${WEB}`,
  API_PORT: String(API),
  API_INTERNAL_URL: `http://127.0.0.1:${API}`,
  DATABASE_URL: pgUrl(dotenv.POSTGRES_APP_USER, dotenv.POSTGRES_APP_PASSWORD),
  MIGRATION_DATABASE_URL: pgUrl(dotenv.POSTGRES_MIGRATOR_USER, dotenv.POSTGRES_MIGRATOR_PASSWORD),
  REDIS_URL: redis.toString(),
  S3_BUCKET_PRIVATE: 'hbvl-load',
  LOG_LEVEL: 'warn',
  ENABLE_OPENAPI: 'false',
  TRUST_PROXY: '1',
  GLOBAL_RATE_LIMIT_PER_MIN: '1000000',
  RATE_LIMIT_MULTIPLIER: '1000',
};
for (const f of ['apps/api/dist/main.js', 'apps/web/.next/standalone/apps/web/server.js']) {
  if (!existsSync(resolve(root, f))) {
    console.error(`Missing ${f} — run \`pnpm build\` first.`);
    process.exit(2);
  }
}

console.log('Preparing the load database …');
execFileSync('node', [resolve(root, 'packages/database/scripts/create-db.mjs'), DB, '--drop'], { cwd: root, env, stdio: 'pipe' });
// A recreated database must not be served from a previous run's cache entries (new UUIDs, same slugs).
{
  const r = new Redis(env.REDIS_URL);
  await r.flushdb();
  r.disconnect();
}
execFileSync('pnpm', ['--filter', '@hbvl/api', 'exec', 'tsx', 'src/cli/storage-init.ts'], { cwd: root, env, stdio: 'pipe' });
execFileSync('pnpm', ['--filter', '@hbvl/api', 'exec', 'tsx', 'src/cli/seed-dev.ts'], { cwd: root, env: { ...env, NODE_ENV: 'development' }, stdio: 'pipe' });

const db = new pg.Client({ connectionString: pgUrl('postgres', dotenv.POSTGRES_ADMIN_PASSWORD) });
await db.connect();
const cats = (await db.query('SELECT id, slug FROM categories WHERE "parentId" IS NOT NULL')).rows;
const author = (await db.query(`SELECT id FROM users LIMIT 1`)).rows[0].id;
const words = 'học bổng vươn lên đông du sinh viên quê hương sách hay kiến thức chuyến đi hành trình bản đồ thành viên'.split(' ');
const para = (n) => Array.from({ length: n }, (_, i) => words[(i * 7 + n) % words.length]).join(' ');
const slugs = [];
for (let i = 0; i < 300; i++) {
  const title = `Bài tải thử ${i} ${para(4)}`;
  const slug = `tai-thu-${i}`;
  slugs.push(slug);
  const html = Array.from({ length: 6 }, (_, k) => `<p>${para(60 + k)}</p>`).join('');
  const r = await db.query(
    `INSERT INTO posts (id, kind, slug, "authorId", status, title, "contentHtml", "contentText", "searchText", "publishedAt", "updatedAt", origin)
     VALUES (gen_random_uuid(),'POST',$1,$2,'PUBLISHED',$3,$4,$5,$6, now() - ($7 || ' minutes')::interval, now(), 'SEED_DEMO') RETURNING id`,
    [
      slug,
      author,
      title,
      html,
      para(200),
      `bai tai thu ${i} ${para(40)}`
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/đ/g, 'd'),
      String(i * 10),
    ],
  );
  await db.query(`INSERT INTO post_categories ("postId","categoryId","isPrimary") VALUES ($1,$2,true)`, [r.rows[0].id, cats[i % cats.length].id]);
}
const members = [];
for (let i = 0; i < 5; i++) {
  const username = `load_member_${i}`;
  const password = `Load-${Math.random().toString(36).slice(2, 12)}-Pw1`;
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const r = await db.query(
    `INSERT INTO users (id, username, "usernameNormalized", email, "emailNormalized", "displayName", "passwordHash", role, status, "emailVerifiedAt", "updatedAt")
     VALUES (gen_random_uuid(), $1::text, $1::text, $2::text, $2::text, $3, $4, 'MEMBER', 'ACTIVE', now(), now()) RETURNING id`,
    [username, `${username}@load.example.test`, `Load ${i}`, hash],
  );
  await db.query(`INSERT INTO user_profiles ("userId", "updatedAt") VALUES ($1, now())`, [r.rows[0].id]);
  members.push({ username, password });
}
await db.end();

console.log('Starting the production stack …');
const procs = [
  spawn(process.execPath, ['apps/api/dist/main.js'], {
    detached: true,
    cwd: root,
    env: { ...env, LOG_LEVEL: process.env.LOAD_LOGS ? 'info' : 'warn' },
    stdio: process.env.LOAD_LOGS ? ['ignore', openSync(resolve(reportDir, 'api.log'), 'w'), 'inherit'] : 'ignore',
  }),
  spawn(process.execPath, ['apps/api/dist/worker.js'], { detached: true, cwd: root, env, stdio: 'ignore' }),
  spawn(process.execPath, ['.next/standalone/apps/web/server.js'], {
    detached: true,
    cwd: resolve(root, 'apps/web'),
    env: { ...env, PORT: String(WEB), HOSTNAME: '0.0.0.0' },
    stdio: 'ignore',
  }),
];
const waitFor = async (url) => {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
};
let code = 1;
try {
  await waitFor(`http://127.0.0.1:${API}/api/v1/health/ready`);
  await waitFor(`http://127.0.0.1:${WEB}/`);
  // warm-up (JIT, connection pools) so the measured run is steady-state
  for (const p of ['/', '/category/tin-tuc', `/bai-viet/${slugs[0]}`]) await fetch(`http://127.0.0.1:${WEB}${p}`);

  // RSS (MiB) summed over every process whose command line mentions `needle` (Next runs its server in a renamed child process).
  const rssOf = (needle) => {
    let total = 0;
    for (const d of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try {
        if (!readFileSync(`/proc/${d}/cmdline`, 'utf8').includes(needle)) continue;
        total += Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${d}/status`, 'utf8'))?.[1] ?? 0) / 1024;
      } catch {
        /* process vanished */
      }
    }
    return total;
  };
  const needles = { api: 'apps/api/dist/main.js', worker: 'apps/api/dist/worker.js', web: 'next-server' };
  const peak = { api: 0, worker: 0, web: 0 };
  const sampler = setInterval(() => {
    for (const [k, needle] of Object.entries(needles)) peak[k] = Math.max(peak[k], rssOf(needle));
  }, 2000);

  console.log(`Running k6 (${VUS} VUs, ${DURATION}) …`);
  const summaryName = 'summary.json';
  const args = [
    'run',
    '--rm',
    '--network',
    'host',
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '-v',
    `${here}:/scripts:ro`,
    '-v',
    `${reportDir}:/out`,
    '-e',
    `BASE=http://localhost:${WEB}`,
    '-e',
    `VUS=${VUS}`,
    '-e',
    `DURATION=${DURATION}`,
    '-e',
    `MEMBERS=${JSON.stringify(members)}`,
    '-e',
    `POST_SLUGS=${JSON.stringify(slugs)}`,
    K6_IMAGE,
    'run',
    '--summary-export',
    `/out/${summaryName}`,
    '/scripts/hbvl.js',
  ];
  // async spawn: a blocking call would starve the RSS sampler above
  rmSync(resolve(reportDir, summaryName), { force: true }); // never report a stale file
  const run = { status: await new Promise((res) => spawn('docker', args, { stdio: 'inherit' }).on('exit', (c) => res(c ?? 1))) };
  clearInterval(sampler);
  const summary = JSON.parse(readFileSync(resolve(reportDir, summaryName), 'utf8'));
  const m = summary.metrics;
  const out = {
    when: new Date().toISOString(),
    image: K6_IMAGE,
    vus: Number(VUS),
    duration: DURATION,
    machine: { cpus: (await import('node:os')).cpus().length },
    requests: m.http_reqs.count,
    rps: Math.round(m.http_reqs.rate * 10) / 10,
    failedRate: m.http_req_failed.value ?? m.http_req_failed.rate,
    checksPassRate: m.checks.value ?? m.checks.rate,
    latencyMs: {
      p50: m.http_req_duration.med,
      p90: m.http_req_duration['p(90)'],
      p95: m.http_req_duration['p(95)'],
      p99: m.http_req_duration['p(99)'],
      max: m.http_req_duration.max,
    },
    pageP95: m['http_req_duration{kind:page}']?.['p(95)'],
    apiP95: m['http_req_duration{kind:api}']?.['p(95)'],
    peakRssMiB: Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, Math.round(v)])),
    thresholdsPassed: run.status === 0,
  };
  writeFileSync(resolve(reportDir, 'result.json'), JSON.stringify(out, null, 2));
  console.log('\nLOAD RESULT\n' + JSON.stringify(out, null, 2));
  code = run.status === 0 ? 0 : 1;
} catch (e) {
  console.error(e);
} finally {
  for (const p of procs) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {
      p.kill('SIGTERM');
    }
  }
}
process.exit(code);

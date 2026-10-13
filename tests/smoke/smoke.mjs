#!/usr/bin/env node
// Production-build smoke test (`pnpm test:smoke`). Builds nothing: run `pnpm build` first.
// Creates a throw-away database `hbvl_smoke`, applies the REAL migrations, seeds reference data + labelled demo content (dev seed),
// starts the compiled API + worker + Next standalone server exactly like production (NODE_ENV=production), then probes them over HTTP.
// Also proves the safe-bootstrap rules: the dev seed refuses to run in production mode and the first admin comes from the CLI only.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { Redis } = createRequire(import.meta.url)('ioredis');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dotenv = Object.fromEntries(
  readFileSync(resolve(root, '.env'), 'utf8')
    .split('\n')
    .map((l) => /^([A-Z0-9_]+)=([^#]*?)\s*(#.*)?$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const WEB = 3300;
const API = 3301;
const DB = 'hbvl_smoke';
const pgUrl = (user, pw) => `postgresql://${user}:${encodeURIComponent(pw)}@${dotenv.POSTGRES_HOST}:${dotenv.POSTGRES_PORT}/${DB}`;
const redis = new URL(dotenv.REDIS_URL);
redis.pathname = '/9';
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
  S3_BUCKET_PRIVATE: 'hbvl-smoke',
  LOG_LEVEL: 'warn',
  ENABLE_OPENAPI: 'false',
  TRUST_PROXY: '1',
  // Never send real e-mail or call Google from a test run, whatever the developer put in .env.
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: process.env.MAILPIT_SMTP_PORT ?? '51025',
  SMTP_SECURE: 'false',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  MAIL_FROM: 'Học Bổng Vươn Lên <no-reply@hbvl.local>',
  GEMINI_API_KEY: '',
};
const results = [];
const procs = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push([name, true]);
    console.log(`  ✔ ${name}`);
  } catch (e) {
    results.push([name, false, e]);
    console.log(`  ✘ ${name}\n      ${String(e.message).split('\n')[0]}`);
  }
};
const waitFor = async (url, ms = 60_000) => {
  const end = Date.now() + ms;
  let last = 'no response';
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = String(e.cause?.code ?? e.cause?.message ?? e.message);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url} (last: ${last})`);
};
for (const f of ['apps/api/dist/main.js', 'apps/web/.next/standalone/apps/web/server.js']) {
  if (!existsSync(resolve(root, f))) {
    console.error(`Missing ${f} — run \`pnpm build\` first.`);
    process.exit(2);
  }
}

console.log('Preparing database and storage …');
execFileSync('node', [resolve(root, 'packages/database/scripts/create-db.mjs'), DB, '--drop'], { cwd: root, env, stdio: 'pipe' });
// A recreated database must not be served from a previous run's cache entries (new UUIDs, same slugs).
{
  const r = new Redis(env.REDIS_URL);
  await r.flushdb();
  r.disconnect();
}
execFileSync('pnpm', ['--filter', '@hbvl/api', 'exec', 'tsx', 'src/cli/storage-init.ts'], { cwd: root, env, stdio: 'pipe' });
// Safe bootstrap: the first administrator comes from the CLI only (a second bootstrap is refused while an admin exists).
const bootstrap = (email, username, password) =>
  spawnSync('pnpm', ['--filter', '@hbvl/api', 'exec', 'tsx', 'src/cli/bootstrap-admin.ts'], {
    cwd: root,
    env: { ...env, BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_USERNAME: username, BOOTSTRAP_ADMIN_PASSWORD: password },
    encoding: 'utf8',
  });
const boot = bootstrap('boss@smoke.example.org', 'smokeadmin', 'Smoke-Admin-Pass-123');
const second = bootstrap('second@smoke.example.org', 'second', 'Smoke-Admin-Pass-456');
// The dev seed must work for local/CI …
const devEnv = { ...env, NODE_ENV: 'development' };
execFileSync('pnpm', ['--filter', '@hbvl/api', 'exec', 'tsx', 'src/cli/seed-dev.ts'], { cwd: root, env: devEnv, stdio: 'pipe' });

console.log('Starting API, worker and web in production mode …');
const quiet = { stdio: process.env.SMOKE_LOGS ? 'inherit' : 'ignore' };
procs.push(spawn(process.execPath, ['apps/api/dist/main.js'], { detached: true, cwd: root, env, ...quiet }));
procs.push(spawn(process.execPath, ['apps/api/dist/worker.js'], { detached: true, cwd: root, env, ...quiet }));
procs.push(
  spawn(process.execPath, ['.next/standalone/apps/web/server.js'], {
    detached: true,
    cwd: resolve(root, 'apps/web'),
    env: { ...env, PORT: String(WEB), HOSTNAME: '0.0.0.0' },
    ...quiet,
  }),
);
let exitCode = 1;
try {
  await waitFor(`http://127.0.0.1:${API}/api/v1/health/ready`);
  await waitFor(`http://127.0.0.1:${WEB}/`);
  const web = (p, init) => fetch(`http://127.0.0.1:${WEB}${p}`, { redirect: 'manual', ...init });
  console.log('Probing:');

  await step('API liveness and readiness (database + Redis)', async () => {
    assert.equal((await fetch(`http://127.0.0.1:${API}/api/v1/health/live`)).status, 200);
    const r = await (await fetch(`http://127.0.0.1:${API}/api/v1/health/ready`)).json();
    assert.deepEqual(r.checks, { database: 'up', redis: 'up' });
  });
  await step('home (vi): 200, one <h1>, lang=vi, security headers, nonce CSP, NO cookies for anonymous visitors', async () => {
    const r = await web('/');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<html[^>]*lang="vi"/);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
    const csp = r.headers.get('content-security-policy') ?? '';
    assert.match(csp, /script-src[^;]*'nonce-/);
    assert.doesNotMatch(csp, /'unsafe-eval'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('referrer-policy'));
    assert.equal(r.headers.get('set-cookie'), null, 'anonymous HTML must be cacheable: no Set-Cookie');
  });
  await step('English home under /en: 200, lang=en', async () => {
    const r = await web('/en');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<html[^>]*lang="en"/);
  });
  await step('category, search, province, map pages render', async () => {
    for (const p of ['/category/tin-tuc', '/tim-kiem?q=hoc+bong', '/tinh/ha-noi', '/category/dong-du-ky/ban-do-vuon-len', '/lien-he', '/gui-y-kien', '/thong-bao']) {
      const r = await web(p);
      assert.ok(r.status === 200 || r.status === 307, `${p} → ${r.status}`);
    }
  });
  await step('unknown URL → real 404 (not a soft 200, not a blanket redirect to home)', async () => {
    const r = await web('/khong-ton-tai-123');
    assert.equal(r.status, 404);
  });
  await step('robots.txt and sitemap.xml', async () => {
    const robots = await (await web('/robots.txt')).text();
    assert.match(robots, /Disallow: \/admin/);
    assert.match(robots, /Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/, robots);
    const sm = await (await web('/sitemap.xml')).text();
    assert.match(sm, /<urlset/);
    assert.match(sm, /\/category\/tin-tuc/);
  });
  await step('same-origin API proxy serves public JSON; media of unpublished content is 404', async () => {
    const posts = await (await web('/api/v1/posts?pageSize=2')).json();
    assert.ok(Array.isArray(posts.items));
    assert.equal((await web('/api/v1/media/00000000-0000-4000-8000-000000000000/large')).status, 404);
  });
  await step('consoles and admin APIs refuse anonymous visitors', async () => {
    // The console pages are a client shell (authorisation is enforced by the API, never by hiding UI): anonymous visitors get no data and no indexing.
    for (const p of ['/admin', '/cong-tac-vien']) {
      const r = await web(p);
      assert.equal(r.status, 200);
      const html = await r.text();
      assert.match(html, /<meta name="robots" content="noindex, nofollow"/, `${p} must be noindex`);
      assert.doesNotMatch(html, /"role":"ADMIN"|Quản trị viên.*@/s);
    }
    assert.equal((await web('/api/v1/admin/users')).status, 401);
    assert.equal((await web('/api/v1/staff/review-queue')).status, 401);
    assert.equal((await web('/api/v1/me/posts')).status, 401);
  });
  await step('state-changing requests without CSRF/Origin are refused', async () => {
    const r = await web('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
  });
  await step('no source, env or dependency files are reachable', async () => {
    for (const p of ['/.env', '/package.json', '/pnpm-lock.yaml', '/.git/config', '/_next/../.env', '/sampleweb_wp_export.sql', '/wp-config.php'])
      assert.equal((await web(p)).status, 404, p);
  });
  await step('dev seed REFUSES to run in production mode (no default accounts can reach production)', async () => {
    const r = spawnSync('pnpm', ['--filter', '@hbvl/api', 'exec', 'tsx', 'src/cli/seed-dev.ts'], {
      cwd: root,
      env: { ...env, APP_ENV: 'production', COOKIE_SECURE: 'true', PUBLIC_ORIGIN: 'https://example.invalid' },
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0);
    assert.match(`${r.stdout}${r.stderr}`, /refuses to run/);
  });
  await step('first administrator is created only by the CLI; a second bootstrap is refused; MFA is required before /admin APIs work', async () => {
    assert.equal(boot.status, 0, boot.stderr);
    assert.notEqual(second.status, 0, 'a second bootstrap must be refused while an admin exists');
    const base = `http://localhost:${WEB}`;
    const jar = new Map();
    const call = async (path, init = {}) => {
      const r = await fetch(`${base}/api/v1${path}`, {
        ...init,
        redirect: 'manual',
        headers: { origin: base, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(init.headers ?? {}) },
      });
      for (const c of r.headers.getSetCookie()) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        jar.set(kv.slice(0, i), kv.slice(i + 1));
      }
      return r;
    };
    const { csrfToken } = await (await call('/auth/csrf')).json();
    const login = await call('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ portal: 'ADMIN', identifier: 'smokeadmin', password: 'Smoke-Admin-Pass-123' }),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.role, 'ADMIN');
    const adminCall = await call('/admin/users');
    assert.ok([401, 403].includes(adminCall.status), `admin API without a completed MFA step must be refused, got ${adminCall.status}`);
  });

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
  exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error(e);
  console.error('process exit codes (api, worker, web):', procs.map((p) => p.exitCode ?? p.signalCode ?? 'running').join(', '));
} finally {
  for (const p of procs) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {
      p.kill('SIGTERM');
    }
  }
}
process.exit(exitCode);

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { foldVietnamese } from '@hbvl/contracts';
import { Redis } from 'ioredis';
import pg from 'pg';
import { encrypt } from '../../../apps/api/src/auth/crypto';
import { generateSecret } from '../../../apps/api/src/auth/totp';
import { e2eEnv, ports, repoRoot } from './env';

export interface E2EUsers {
  [k: string]: { username: string; email: string; password: string; role: string; mfaSecret?: string; verified: boolean; recoveryCodes?: string[] };
}

/** Fresh database + Redis namespace + storage bucket, real migrations, reference seed, and deterministic test accounts (random passwords). */
const procs: ChildProcess[] = [];

async function waitFor(url: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((x) => setTimeout(x, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
}

export default async function globalSetup() {
  const env = e2eEnv();
  const host = env.POSTGRES_HOST ?? '127.0.0.1',
    port = env.POSTGRES_PORT ?? '55432';
  const admin = new pg.Client({ connectionString: `postgresql://postgres:${encodeURIComponent(env.POSTGRES_ADMIN_PASSWORD!)}@${host}:${port}/postgres` });
  await admin.connect();
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'hbvl_e2e'`);
  await admin.query('DROP DATABASE IF EXISTS hbvl_e2e');
  await admin.query(`CREATE DATABASE hbvl_e2e OWNER ${env.POSTGRES_MIGRATOR_USER}`);
  await admin.end();
  const db = new pg.Client({ connectionString: `postgresql://postgres:${encodeURIComponent(env.POSTGRES_ADMIN_PASSWORD!)}@${host}:${port}/hbvl_e2e` });
  await db.connect();
  for (const q of [
    'CREATE EXTENSION IF NOT EXISTS pg_trgm',
    'CREATE EXTENSION IF NOT EXISTS pgcrypto',
    `ALTER SCHEMA public OWNER TO ${env.POSTGRES_MIGRATOR_USER}`,
    `GRANT CONNECT ON DATABASE hbvl_e2e TO ${env.POSTGRES_APP_USER}`,
    `GRANT USAGE ON SCHEMA public TO ${env.POSTGRES_APP_USER}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${env.POSTGRES_MIGRATOR_USER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${env.POSTGRES_APP_USER}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${env.POSTGRES_MIGRATOR_USER} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${env.POSTGRES_APP_USER}`,
  ])
    await db.query(q);
  const root = repoRoot();
  execFileSync('pnpm', ['--filter', '@hbvl/database', 'exec', 'prisma', 'migrate', 'deploy'], { cwd: root, env, stdio: 'pipe' });
  execFileSync('pnpm', ['--filter', '@hbvl/database', 'exec', 'tsx', 'prisma/seed.ts'], { cwd: root, env, stdio: 'pipe' });
  execFileSync('pnpm', ['--filter', '@hbvl/api', 'exec', 'tsx', 'src/cli/storage-init.ts'], { cwd: root, env, stdio: 'pipe' });
  const r = new Redis(env.REDIS_URL!);
  await r.flushdb();
  r.disconnect();
  await fetch(`http://127.0.0.1:${env.MAILPIT_UI_PORT ?? '58025'}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);

  const users: E2EUsers = {};
  const mk = async (key: string, role: string, opts: { mfa?: boolean; verified?: boolean } = {}) => {
    const password = `E2e-${key}-${Math.random().toString(36).slice(2, 10)}-Pw1`;
    const username = `e2e_${key}`;
    const email = `${username}@example.test`;
    const secret = opts.mfa ? generateSecret() : undefined;
    const verified = opts.verified !== false;
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const res = await db.query(
      `INSERT INTO users (id, username, "usernameNormalized", email, "emailNormalized", "displayName", "passwordHash", role, status, "emailVerifiedAt", "mfaEnabled", "mfaSecretEnc", "updatedAt")
       VALUES (gen_random_uuid(), $1::text, lower($1::text), $2::text, lower($2::text), $3, $4, $5::"Role", 'ACTIVE', $6, $7, $8, now()) RETURNING id`,
      [username, email, `E2E ${key}`, hash, role, verified ? new Date() : null, !!secret, secret ? encrypt(secret, env.MFA_ENCRYPTION_KEY!) : null],
    );
    await db.query(`INSERT INTO user_profiles ("userId", "updatedAt") VALUES ($1, now())`, [res.rows[0].id]);
    // Single-use recovery codes let many sign-ins happen inside one TOTP window (a TOTP step can be used once).
    const recoveryCodes = secret ? Array.from({ length: 60 }, (_, i) => `e2e${String(i).padStart(2, '0')}-${Math.random().toString(36).slice(2, 7)}`) : undefined;
    if (recoveryCodes)
      for (const c of recoveryCodes)
        await db.query(`INSERT INTO mfa_recovery_codes (id, "userId", "codeHash") VALUES (gen_random_uuid(), $1, $2)`, [
          res.rows[0].id,
          createHash('sha256').update(c.toLowerCase()).digest('hex'),
        ]);
    users[key] = { username, email, password, role, mfaSecret: secret, verified, recoveryCodes };
  };
  await mk('admin', 'ADMIN', { mfa: true });
  await mk('ctv', 'COLLABORATOR');
  await mk('memberA', 'MEMBER');
  await mk('memberB', 'MEMBER');
  await mk('memberC', 'MEMBER'); // the account restricted/blocked by the moderation tests
  await mk('unverified', 'MEMBER', { verified: false });
  await mk('resetUser', 'MEMBER'); // its password is changed by the reset-flow test
  // Published fixtures for the public-site tests (the workflow tests create their own through the UI).
  const cat = async (slug: string) => (await db.query('SELECT id FROM categories WHERE slug = $1', [slug])).rows[0].id as string;
  const author = (await db.query(`SELECT id FROM users WHERE username = 'e2e_memberA'`)).rows[0].id as string;
  const fixtures: [string, string, string][] = [
    ['Học bổng Đồng Tháp năm nay', 'hoc-bong-dong-thap-nam-nay', 'chuyen-vuon-len'],
    ['Hành trình Quảng Ngãi', 'hanh-trinh-quang-ngai', 'nhat-ky-chuyen-di'],
    ['Bài hát sinh hoạt vui', 'bai-hat-sinh-hoat-vui', 'tong-hop-bai-hat'],
  ];
  for (const [title, slug, c] of fixtures) {
    const r = await db.query(
      `INSERT INTO posts (id, kind, slug, "authorId", status, title, "contentHtml", "contentText", "searchText", "publishedAt", "updatedAt") VALUES (gen_random_uuid(),'POST',$1::text,$2,'PUBLISHED',$3::text,'<p>Nội dung thử nghiệm.</p>','Nội dung thử nghiệm.',$4::text,now() - interval '1 hour',now()) RETURNING id`,
      [slug, author, title, foldVietnamese(title)],
    );
    await db.query(`INSERT INTO post_categories ("postId","categoryId","isPrimary") VALUES ($1,$2,true)`, [r.rows[0].id, await cat(c)]);
  }
  const prov = async (slug: string) => (await db.query(`SELECT id FROM provinces WHERE system='LEGACY_63' AND slug=$1`, [slug])).rows[0].id as string;
  for (const [name, slug] of [
    ['ĐOÀN TRUNG NHÂN', 'dong-thap'],
    ['NGUYỄN MINH QUÂN', 'da-nang'],
    ['TRẦN THỊ B', 'tuyen-quang'],
    ['LÊ C', 'ha-giang'],
  ] as const) {
    await db.query(
      `INSERT INTO scholarship_members (id,"fullName","normalizedName","legacyProvinceId","sourceIdentity","updatedAt") VALUES (gen_random_uuid(),$1::text,$2::text,$3,encode(sha256(convert_to($1::text||'e2e','UTF8')),'hex'),now())`,
      [name, foldVietnamese(name), await prov(slug)],
    );
  }
  await db.end();
  mkdirSync(resolve(root, '.runtime'), { recursive: true });
  rmSync(resolve(root, '.runtime/recovery-idx.json'), { force: true });
  rmSync(resolve(root, '.runtime/recovery-idx.json.lock'), { recursive: true, force: true });
  writeFileSync(resolve(root, '.runtime/e2e-users.json'), JSON.stringify(users), { mode: 0o600 });
  // Servers start AFTER the database exists (Playwright's webServer would start them before globalSetup).
  const log = process.env.E2E_SERVER_LOGS ? 'inherit' : 'ignore';
  procs.push(spawn(process.execPath, ['apps/api/dist/main.js'], { detached: true, cwd: root, env, stdio: log }));
  procs.push(spawn(process.execPath, ['apps/api/dist/worker.js'], { detached: true, cwd: root, env, stdio: log }));
  procs.push(
    spawn(process.execPath, ['.next/standalone/apps/web/server.js'], {
      detached: true,
      cwd: resolve(root, 'apps/web'),
      env: { ...env, PORT: String(ports.web), HOSTNAME: '0.0.0.0' },
      stdio: log,
    }),
  );
  await waitFor(`http://127.0.0.1:${ports.api}/api/v1/health/ready`);
  await waitFor(`http://127.0.0.1:${ports.web}/`);
  return async () => {
    for (const p of procs) {
      try {
        process.kill(-p.pid!, 'SIGTERM'); // whole process group: Next renames and re-parents its server process
      } catch {
        p.kill('SIGTERM');
      }
    }
  };
}

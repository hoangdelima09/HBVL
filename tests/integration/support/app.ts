import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import pg from 'pg';
import { createPrismaClient, seedReferenceData } from '@hbvl/database';
import { Redis } from 'ioredis';
import request from 'supertest';
import { encrypt } from '../../../apps/api/src/auth/crypto';
import { base32Decode, generateSecret, hotp, totpCounter } from '../../../apps/api/src/auth/totp';
import { applyTestEnv } from './env';

export const ORIGIN = 'http://localhost:3100';

const t = applyTestEnv();

export interface TestApp {
  app: INestApplication;
  http: ReturnType<INestApplication['getHttpServer']>;
  admin: pg.Client;
  newClient(): Promise<Client>;
  makeUser(opts?: Partial<UserSpec>): Promise<TestUser>;
  loginAs(user: TestUser, opts?: { portal?: 'ADMIN' | 'COLLABORATOR' | 'MEMBER' }): Promise<Client>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export interface UserSpec {
  role: 'ADMIN' | 'COLLABORATOR' | 'MEMBER';
  verified: boolean;
  password: string;
  username: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_RESET';
  mfa: boolean;
}
export interface TestUser {
  id: string;
  username: string;
  email: string;
  password: string;
  role: UserSpec['role'];
  mfaSecret?: string;
  mfaUses?: number;
}

const RESET_KEEP = new Set(['categories', 'category_translations', 'provinces', 'province_mappings', 'site_settings', '_prisma_migrations']);

export class Client {
  csrf = '';
  constructor(private readonly http: TestApp['http']) {}
  agent = () => this._agent;
  /** A browser re-reads the CSRF cookie before each write; tests call this after anything that may have re-minted it. */
  async refreshCsrf() {
    this.csrf = (await this._agent.get('/api/v1/auth/csrf')).body.csrfToken;
  }
  private _agent!: ReturnType<typeof request.agent>;
  async init() {
    this._agent = request.agent(this.http);
    const r = await this._agent.get('/api/v1/auth/csrf');
    this.csrf = r.body.csrfToken;
    return this;
  }
  private w(req: request.Test, extra: Record<string, string> = {}) {
    req.set('Origin', ORIGIN).set('X-CSRF-Token', this.csrf);
    for (const [k, v] of Object.entries(extra)) req.set(k, v);
    return req;
  }
  get(path: string, extra: Record<string, string> = {}) {
    const r = this._agent.get(`/api/v1${path}`);
    for (const [k, v] of Object.entries(extra)) r.set(k, v);
    return r;
  }
  async post(path: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await this.w(this._agent.post(`/api/v1${path}`), extra).send(body as object);
    if (res.body?.csrfToken) this.csrf = res.body.csrfToken;
    return res;
  }
  put(path: string, body?: unknown, extra: Record<string, string> = {}) {
    return this.w(this._agent.put(`/api/v1${path}`), extra).send(body as object);
  }
  patch(path: string, body?: unknown, extra: Record<string, string> = {}) {
    return this.w(this._agent.patch(`/api/v1${path}`), extra).send(body as object);
  }
  delete(path: string, extra: Record<string, string> = {}) {
    return this.w(this._agent.delete(`/api/v1${path}`), extra);
  }
  /** Raw agent request WITHOUT CSRF/Origin headers (to test that they are enforced). */
  raw() {
    return this._agent;
  }
}

let counter = 0;

export async function createTestApp(): Promise<TestApp> {
  const { createApp } = await import('../../../apps/api/src/bootstrap');
  const app = await createApp();
  await app.init();
  const http = app.getHttpServer();
  http.setMaxListeners(200);
  const admin = new pg.Client({ connectionString: t.adminDbUrl });
  await admin.connect();
  const redis = new Redis(t.redisUrl);
  const migrator = createPrismaClient({ connectionString: t.migratorUrl, poolMax: 2 });

  const api: TestApp = {
    app,
    http,
    admin,
    async newClient() {
      return new Client(http).init();
    },
    async makeUser(opts = {}) {
      const n = ++counter;
      const spec: UserSpec = {
        role: 'MEMBER',
        verified: true,
        password: `Passw0rd-${n}-correct-horse`,
        username: `user${n}x${Date.now() % 100000}`,
        email: '',
        displayName: `Người dùng ${n}`,
        status: 'ACTIVE',
        mfa: false,
        ...opts,
      };
      spec.email ||= `${spec.username}@example.test`;
      const hash = await argon2.hash(spec.password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
      const r = await admin.query(
        `INSERT INTO users (id, username, "usernameNormalized", email, "emailNormalized", "displayName", "passwordHash", role, status, "emailVerifiedAt", "updatedAt")
         VALUES (gen_random_uuid(), $1::text, lower($1::text), $2::text, lower($2::text), $3, $4, $5::"Role", $6::"UserStatus", $7, now()) RETURNING id`,
        [spec.username, spec.email, spec.displayName, spec.status === 'PENDING_RESET' ? null : hash, spec.role, spec.status, spec.verified ? new Date() : null],
      );
      const id = r.rows[0].id as string;
      await admin.query(`INSERT INTO user_profiles ("userId", "updatedAt") VALUES ($1, now())`, [id]);
      let mfaSecret: string | undefined;
      if (spec.mfa) {
        mfaSecret = generateSecret();
        await admin.query(`UPDATE users SET "mfaEnabled" = true, "mfaSecretEnc" = $2 WHERE id = $1`, [id, encrypt(mfaSecret, process.env.MFA_ENCRYPTION_KEY!)]);
      }
      return { id, username: spec.username, email: spec.email, password: spec.password, role: spec.role, mfaSecret, mfaUses: 0 };
    },
    async loginAs(user, opts = {}) {
      const c = await api.newClient();
      const res = await c.post('/auth/login', { portal: opts.portal ?? user.role, identifier: user.username, password: user.password });
      if (res.status !== 200) throw new Error(`login failed for ${user.username}: ${res.status} ${JSON.stringify(res.body)}`);
      if (res.body.mfaRequired) {
        // TOTP replay protection allows each counter once: walk the ±1 window across successive logins.
        const offsets = [0, -1, 1];
        const off = offsets[(user.mfaUses ?? 0) % 3]!;
        user.mfaUses = (user.mfaUses ?? 0) + 1;
        const code = hotp(base32Decode(user.mfaSecret!), totpCounter(Date.now()) + off);
        const v = await c.post('/auth/mfa/verify', { code });
        if (v.status !== 200) throw new Error(`mfa failed: ${v.status} ${JSON.stringify(v.body)}`);
      }
      return c;
    },
    async reset() {
      const rows = await admin.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
      const tables = rows.rows.map((r) => r.tablename as string).filter((n) => !RESET_KEEP.has(n));
      await admin.query('ALTER TABLE audit_logs DISABLE TRIGGER USER');
      await admin.query(`TRUNCATE ${tables.map((n) => `"${n}"`).join(', ')} RESTART IDENTITY CASCADE`);
      await admin.query('ALTER TABLE audit_logs ENABLE TRIGGER USER');
      await seedReferenceData(migrator); // CASCADE from media_assets also clears provinces; reference data is restored idempotently
      await redis.flushdb();
    },
    async close() {
      await app.close();
      await admin.end();
      redis.disconnect();
      await migrator.$disconnect();
    },
  };
  return api;
}

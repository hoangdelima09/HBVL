import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, ORIGIN, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

describe('registration', () => {
  it('creates a MEMBER only and rejects privileged fields (mass assignment)', async () => {
    const c = await t.newClient();
    const bad = await c.post('/auth/register', {
      displayName: 'A',
      username: 'abc123',
      email: 'a@example.test',
      password: 'long-enough-pass',
      passwordConfirm: 'long-enough-pass',
      role: 'ADMIN',
    });
    expect(bad.status).toBe(400);
    const ok = await c.post('/auth/register', {
      displayName: 'An',
      username: 'abc123',
      email: 'a@example.test',
      password: 'long-enough-pass',
      passwordConfirm: 'long-enough-pass',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.user.role).toBe('MEMBER');
    expect(ok.body.user.emailVerified).toBe(false);
    const row = await t.admin.query(`SELECT role, status, "passwordHash" FROM users WHERE username = 'abc123'`);
    expect(row.rows[0].role).toBe('MEMBER');
    expect(row.rows[0].passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects duplicate username/email with a generic error and short/long passwords', async () => {
    const u = await t.makeUser();
    const c = await t.newClient();
    const dupe = await c.post('/auth/register', {
      displayName: 'X',
      username: u.username.toUpperCase(),
      email: 'other@example.test',
      password: 'long-enough-pass',
      passwordConfirm: 'long-enough-pass',
    });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('REGISTRATION_FAILED');
    const short = await c.post('/auth/register', { displayName: 'X', username: 'newbie1', email: 'n@example.test', password: 'short', passwordConfirm: 'short' });
    expect(short.status).toBe(400);
    const huge = await c.post('/auth/register', { displayName: 'X', username: 'newbie2', email: 'n2@example.test', password: 'x'.repeat(129), passwordConfirm: 'x'.repeat(129) });
    expect(huge.status).toBe(400);
  });

  it('queues a verification e-mail in the outbox (encrypted payload) and verification is single-use', async () => {
    const c = await t.newClient();
    await c.post('/auth/register', { displayName: 'An', username: 'verifyme', email: 'verifyme@example.test', password: 'long-enough-pass', passwordConfirm: 'long-enough-pass' });
    const ob = await t.admin.query(`SELECT payload FROM outbox_events WHERE type = 'EMAIL_SEND'`);
    expect(ob.rows).toHaveLength(1);
    expect(JSON.stringify(ob.rows[0].payload)).not.toContain('token=');
    // issue a known token directly (the raw token only ever exists in the e-mail)
    const { createHmac, randomBytes } = await import('node:crypto');
    const raw = randomBytes(32).toString('base64url');
    const hash = createHmac('sha256', process.env.TOKEN_HASH_PEPPER!).update(raw).digest('hex');
    const u = await t.admin.query(`SELECT id FROM users WHERE username='verifyme'`);
    await t.admin.query(`INSERT INTO auth_tokens (id, "userId", purpose, "tokenHash", "expiresAt") VALUES (gen_random_uuid(), $1, 'VERIFY_EMAIL', $2, now() + interval '1 hour')`, [
      u.rows[0].id,
      hash,
    ]);
    const first = await c.post('/auth/verify-email', { token: raw });
    expect(first.status).toBe(204);
    const second = await c.post('/auth/verify-email', { token: raw });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('TOKEN_INVALID');
    const v = await t.admin.query(`SELECT "emailVerifiedAt" FROM users WHERE username='verifyme'`);
    expect(v.rows[0].emailVerifiedAt).not.toBeNull();
  });
});

describe('CSRF + origin', () => {
  it('rejects writes without Origin / token / with wrong origin', async () => {
    const u = await t.makeUser();
    const c = await t.loginAs(u);
    const noToken = await c.raw().post('/api/v1/auth/logout').set('Origin', ORIGIN);
    expect(noToken.status).toBe(403);
    const badOrigin = await c.raw().post('/api/v1/auth/logout').set('Origin', 'https://evil.example').set('X-CSRF-Token', c.csrf);
    expect(badOrigin.status).toBe(403);
    const noOrigin = await c.raw().post('/api/v1/auth/logout').set('X-CSRF-Token', c.csrf);
    expect(noOrigin.status).toBe(403);
    const ok = await c.post('/auth/logout');
    expect(ok.status).toBe(204);
  });

  it('a CSRF token minted for another session is rejected', async () => {
    const a = await t.loginAs(await t.makeUser());
    const b = await t.loginAs(await t.makeUser());
    const res = await a.raw().post('/api/v1/auth/logout').set('Origin', ORIGIN).set('X-CSRF-Token', b.csrf).set('Cookie', `hbvl_csrf=${b.csrf}`);
    expect(res.status).toBe(403);
  });
});

describe('login portals & sessions', () => {
  it('accepts only the role that belongs to the portal; wrong portal gives the generic error', async () => {
    const m = await t.makeUser({ role: 'MEMBER' });
    const c = await t.newClient();
    const wrong = await c.post('/auth/login', { portal: 'ADMIN', identifier: m.username, password: m.password });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const bad = await c.post('/auth/login', { portal: 'MEMBER', identifier: m.username, password: 'nope-nope-nope' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe(wrong.body.error.message); // no oracle between "bad password" and "wrong portal"
    const ok = await c.post('/auth/login', { portal: 'MEMBER', identifier: m.email, password: m.password });
    expect(ok.status).toBe(200);
    expect(ok.body.redirectTo).toBe('/tai-khoan');
  });

  it('redirects by role and ignores unsafe returnTo (open redirect)', async () => {
    const adm = await t.makeUser({ role: 'ADMIN' });
    const mem = await t.makeUser({ role: 'MEMBER' });
    const col = await t.makeUser({ role: 'COLLABORATOR' });
    const c1 = await t.newClient();
    expect((await c1.post('/auth/login', { portal: 'ADMIN', identifier: adm.username, password: adm.password })).body.redirectTo).toBe('/admin');
    const c2 = await t.newClient();
    expect((await c2.post('/auth/login', { portal: 'COLLABORATOR', identifier: col.username, password: col.password })).body.redirectTo).toBe('/cong-tac-vien');
    for (const evil of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      const c = await t.newClient();
      const r = await c.post('/auth/login', { portal: 'MEMBER', identifier: mem.username, password: mem.password, returnTo: evil });
      expect(r.body.redirectTo).toBe('/tai-khoan');
    }
    const c3 = await t.newClient();
    const r = await c3.post('/auth/login', { portal: 'MEMBER', identifier: mem.username, password: mem.password, returnTo: '/gui-bai' });
    expect(r.body.redirectTo).toBe('/gui-bai');
  });

  it('suspension and role change take effect immediately; logout revokes the session', async () => {
    const m = await t.makeUser();
    const c = await t.loginAs(m);
    expect((await c.get('/auth/me')).body.user.username).toBe(m.username);
    await t.admin.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [m.id]);
    expect((await c.get('/auth/me')).body.user).toBeNull();
    await t.admin.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [m.id]);
    expect((await c.get('/auth/me')).body.user.role).toBe('MEMBER');
    await t.admin.query(`UPDATE users SET role = 'COLLABORATOR' WHERE id = $1`, [m.id]);
    expect((await c.get('/auth/me')).body.user.role).toBe('COLLABORATOR');
    await c.refreshCsrf();
    const out = await c.post('/auth/logout');
    expect(out.status).toBe(204);
    expect((await c.get('/auth/me')).body.user).toBeNull();
  });

  it('login rotates the session (a pre-login cookie never survives)', async () => {
    const m = await t.makeUser();
    const c = await t.loginAs(m);
    const before = await t.admin.query(`SELECT count(*)::int n FROM sessions WHERE "userId" = $1 AND "revokedAt" IS NULL`, [m.id]);
    const again = await c.post('/auth/login', { portal: 'MEMBER', identifier: m.username, password: m.password });
    expect(again.status).toBe(200);
    const after = await t.admin.query(`SELECT count(*)::int n FROM sessions WHERE "userId" = $1 AND "revokedAt" IS NULL`, [m.id]);
    expect(before.rows[0].n).toBe(1);
    expect(after.rows[0].n).toBe(1); // old revoked, new created
  });

  it('locks the account after repeated failures', async () => {
    const m = await t.makeUser();
    const c = await t.newClient();
    for (let i = 0; i < 10; i++) await c.post('/auth/login', { portal: 'MEMBER', identifier: m.username, password: 'wrong-password-x' });
    const locked = await c.post('/auth/login', { portal: 'MEMBER', identifier: m.username, password: m.password });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('password reset', () => {
  it('activates migrated (PENDING_RESET) accounts', async () => {
    const pending = await t.makeUser({ status: 'PENDING_RESET', verified: false });
    const c = await t.newClient();
    expect((await c.post('/auth/forgot-password', { email: pending.email, portal: 'MEMBER' })).status).toBe(202);
    const q = await t.admin.query(`SELECT purpose FROM auth_tokens WHERE "userId" = $1`, [pending.id]);
    expect(q.rows[0].purpose).toBe('ACTIVATE_ACCOUNT');
    // forge a known token to complete the flow
    const { createHmac, randomBytes } = await import('node:crypto');
    const raw = randomBytes(32).toString('base64url');
    await t.admin.query(`UPDATE auth_tokens SET "tokenHash" = $1 WHERE "userId" = $2`, [
      createHmac('sha256', process.env.TOKEN_HASH_PEPPER!).update(raw).digest('hex'),
      pending.id,
    ]);
    const done = await c.post('/auth/reset-password', { token: raw, password: 'brand-new-password-1' });
    expect(done.status).toBe(204);
    const reuse = await c.post('/auth/reset-password', { token: raw, password: 'another-password-22' });
    expect(reuse.status).toBe(400);
    const u = await t.admin.query(`SELECT status, "emailVerifiedAt" FROM users WHERE id = $1`, [pending.id]);
    expect(u.rows[0].status).toBe('ACTIVE');
    expect(u.rows[0].emailVerifiedAt).not.toBeNull();
    const login = await (await t.newClient()).post('/auth/login', { portal: 'MEMBER', identifier: pending.username, password: 'brand-new-password-1' });
    expect(login.status).toBe(200);
  });

  it('each portal sends a reset only to an account of its role; collaborator/member portals refuse other e-mails, the admin portal answers alike', async () => {
    const users = { ADMIN: await t.makeUser({ role: 'ADMIN' }), COLLABORATOR: await t.makeUser({ role: 'COLLABORATOR' }), MEMBER: await t.makeUser({ role: 'MEMBER' }) };
    const portals = Object.keys(users) as (keyof typeof users)[];
    const captchaToken = 'XXXX.DUMMY.TOKEN.XXXX'; // Cloudflare test secret in tests: any token passes (the CAPTCHA gate has its own test)
    for (const portal of portals) {
      for (const owner of portals) {
        const started = Date.now();
        const r = await (await t.newClient()).post('/auth/forgot-password', { email: users[owner].email, portal, captchaToken });
        if (portal === 'ADMIN') {
          expect(r.status).toBe(202);
          expect(r.body).toEqual({ accepted: true });
          expect(Date.now() - started).toBeGreaterThanOrEqual(380); // padded: an admin address cannot be told apart by timing either
        } else if (owner === portal) expect(r.status).toBe(202);
        else {
          expect(r.status).toBe(400);
          expect(r.body.error.details[0]).toEqual({ path: 'email', message: expect.stringContaining('Email không đúng') });
        }
      }
    }
    // the route allows 10 requests per client per hour: 9 above + this one
    expect((await (await t.newClient()).post('/auth/forgot-password', { email: 'nobody@example.test', portal: 'ADMIN' })).body).toEqual({ accepted: true });
    for (const owner of portals) {
      const q = await t.admin.query(`SELECT count(*)::int n FROM auth_tokens WHERE "userId" = $1 AND purpose = 'RESET_PASSWORD'`, [users[owner].id]);
      expect(q.rows[0].n).toBe(1); // only the request through its own portal
    }
    const audited = await t.admin.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'auth.password_reset_wrong_email' AND result = 'DENIED'`);
    expect(audited.rows[0].n).toBe(7);
  });

  it('collaborator/member portals: after 2 wrong e-mails the next request needs a CAPTCHA', async () => {
    const m = await t.makeUser({ role: 'MEMBER' });
    const c = await t.newClient();
    const w1 = await c.post('/auth/forgot-password', { email: 'nobody1@example.test', portal: 'MEMBER' });
    expect(w1.status).toBe(400);
    expect(w1.body.error.details).toHaveLength(1);
    const w2 = await c.post('/auth/forgot-password', { email: 'nobody2@example.test', portal: 'COLLABORATOR' });
    expect(w2.status).toBe(400);
    expect(w2.body.error.details[1]).toEqual({ captcha: 'turnstile', siteKey: expect.any(String) }); // the form shows the CAPTCHA right away
    const noToken = await c.post('/auth/forgot-password', { email: m.email, portal: 'MEMBER' });
    expect(noToken.status).toBe(400);
    expect(noToken.body.error.code).toBe('CAPTCHA_REQUIRED');
    expect(noToken.body.error.details).toEqual({ captcha: 'turnstile', siteKey: expect.any(String) });
    expect((await t.admin.query(`SELECT count(*)::int n FROM auth_tokens WHERE "userId" = $1`, [m.id])).rows[0].n).toBe(0);
    // the admin portal never asks (it reveals nothing)
    expect((await c.post('/auth/forgot-password', { email: 'nobody3@example.test', portal: 'ADMIN' })).status).toBe(202);
    const solved = await c.post('/auth/forgot-password', { email: m.email, portal: 'MEMBER', captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' });
    expect(solved.status).toBe(202);
    expect((await t.admin.query(`SELECT count(*)::int n FROM auth_tokens WHERE "userId" = $1 AND purpose = 'RESET_PASSWORD'`, [m.id])).rows[0].n).toBe(1);
  });

  it('reset revokes every existing session', async () => {
    const m = await t.makeUser();
    const c = await t.loginAs(m);
    const { createHmac, randomBytes } = await import('node:crypto');
    const raw = randomBytes(32).toString('base64url');
    await t.admin.query(
      `INSERT INTO auth_tokens (id, "userId", purpose, "tokenHash", "expiresAt") VALUES (gen_random_uuid(), $1, 'RESET_PASSWORD', $2, now() + interval '1 hour')`,
      [m.id, createHmac('sha256', process.env.TOKEN_HASH_PEPPER!).update(raw).digest('hex')],
    );
    expect((await (await t.newClient()).post('/auth/reset-password', { token: raw, password: 'brand-new-password-1' })).status).toBe(204);
    expect((await c.get('/auth/me')).body.user).toBeNull();
  });

  it('expired token is rejected', async () => {
    const m = await t.makeUser();
    const { createHmac, randomBytes } = await import('node:crypto');
    const raw = randomBytes(32).toString('base64url');
    await t.admin.query(
      `INSERT INTO auth_tokens (id, "userId", purpose, "tokenHash", "expiresAt") VALUES (gen_random_uuid(), $1, 'RESET_PASSWORD', $2, now() - interval '1 minute')`,
      [m.id, createHmac('sha256', process.env.TOKEN_HASH_PEPPER!).update(raw).digest('hex')],
    );
    const r = await (await t.newClient()).post('/auth/reset-password', { token: raw, password: 'brand-new-password-1' });
    expect(r.status).toBe(400);
  });
});

void request;

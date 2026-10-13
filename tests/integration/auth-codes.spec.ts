import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type Client, type TestApp } from './support/app';
import { mailpit } from './support/mailpit';

let t: TestApp;
let worker: INestApplicationContext;

beforeAll(async () => {
  t = await createTestApp();
  const { WorkerModule } = await import('../../apps/api/src/worker/worker.module');
  worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
});
afterAll(async () => {
  await worker.close();
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await mailpit.clear();
});

/** The newest e-mail to `to` whose subject contains `subject`, read like a human would: the 6-digit code from the body. */
async function codeFor(to: string, subject: string): Promise<{ code: string; text: string }> {
  const m = await mailpit.waitFor((x) => x.To[0]?.Address === to && x.Subject.includes(subject));
  expect(m, `mail "${subject}" to ${to}`).toBeDefined();
  const text = await mailpit.fullText(m!.ID);
  const code = /(?:là|:)\s*(\d{6})\b/.exec(text)?.[1] ?? /\b(\d{6})\b/.exec(m!.Subject)?.[1];
  expect(code).toMatch(/^\d{6}$/);
  return { code: code!, text };
}
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');
const register = async (c: Client, name: string) => {
  const r = await c.post('/auth/register', { displayName: name, username: name, email: `${name}@example.test`, password: 'long-enough-pass', passwordConfirm: 'long-enough-pass' });
  expect(r.status).toBe(201);
  return `${name}@example.test`;
};
const verified = async (email: string) => (await t.admin.query(`SELECT "emailVerifiedAt" FROM users WHERE email=$1`, [email])).rows[0].emailVerifiedAt !== null;

describe('registration: verify e-mail with the 6-digit code', () => {
  it('mails a code; a wrong code is refused; the right code verifies once', async () => {
    const c = await t.newClient();
    const email = await register(c, 'codeuser');
    const { code, text } = await codeFor(email, 'Mã xác minh');
    expect(text).toContain('/xac-minh-email?token='); // the link still works alongside the code

    const bad = await c.post('/auth/verify-email-code', { code: wrong(code) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CODE_INVALID');
    expect(await verified(email)).toBe(false);

    expect((await c.post('/auth/verify-email-code', { code })).status).toBe(204);
    expect(await verified(email)).toBe(true);
    expect((await c.post('/auth/verify-email-code', { code })).status).toBe(400); // single use
  });

  it('burns the code after 5 wrong guesses, even if the correct code comes next; a resend issues a fresh one', async () => {
    const c = await t.newClient();
    const email = await register(c, 'bruteforce');
    const { code } = await codeFor(email, 'Mã xác minh');
    for (let i = 0; i < 5; i++) expect((await c.post('/auth/verify-email-code', { code: wrong(code) })).status).toBe(400);
    expect((await c.post('/auth/verify-email-code', { code })).status).toBe(400); // too late
    expect(await verified(email)).toBe(false);

    await mailpit.clear();
    expect((await c.post('/auth/resend-verification')).status).toBe(202);
    const fresh = await codeFor(email, 'Mã xác minh');
    expect((await c.post('/auth/verify-email-code', { code: fresh.code })).status).toBe(204);
    expect(await verified(email)).toBe(true);
  });

  it('needs a signed-in user, a well-formed code, and cannot verify somebody else', async () => {
    const a = await t.newClient();
    const emailA = await register(a, 'alice');
    const { code } = await codeFor(emailA, 'Mã xác minh');
    expect((await (await t.newClient()).post('/auth/verify-email-code', { code })).status).toBe(401);
    expect((await a.post('/auth/verify-email-code', { code: '12345' })).status).toBe(400);
    expect((await a.post('/auth/verify-email-code', { code: 'abcdef' })).status).toBe(400);

    const b = await t.newClient();
    await register(b, 'bob');
    expect((await b.post('/auth/verify-email-code', { code })).status).toBe(400); // Alice's code is bound to Alice
    expect(await verified(emailA)).toBe(false);
  });
});

describe('forgot password: reset with the 6-digit code', () => {
  it('mails a code; wrong code, wrong e-mail and unknown e-mail look identical; the right code sets the password once and revokes sessions', async () => {
    const user = await t.makeUser({ role: 'MEMBER' });
    const session = await t.loginAs(user);
    const anon = await t.newClient();
    expect((await anon.post('/auth/forgot-password', { email: user.email })).status).toBe(202);
    const { code } = await codeFor(user.email, 'Đặt lại mật khẩu');
    const newPassword = 'a-brand-new-password-1';

    const wrongCode = await anon.post('/auth/reset-password-code', { email: user.email, code: wrong(code), password: newPassword });
    const unknown = await anon.post('/auth/reset-password-code', { email: 'nobody@example.test', code, password: newPassword });
    expect(wrongCode.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe(wrongCode.body.error.code);
    expect(unknown.body.error.message).toBe(wrongCode.body.error.message);

    expect((await anon.post('/auth/reset-password-code', { email: user.email, code, password: newPassword })).status).toBe(204);
    expect((await anon.post('/auth/reset-password-code', { email: user.email, code, password: 'another-password-22' })).status).toBe(400); // single use
    expect((await session.get('/auth/me')).body.user).toBeNull(); // old session revoked
    expect((await (await t.newClient()).post('/auth/login', { portal: 'MEMBER', identifier: user.email, password: user.password })).status).toBe(401);
    expect((await (await t.newClient()).post('/auth/login', { portal: 'MEMBER', identifier: user.email, password: newPassword })).status).toBe(200);
  });

  it('burns the reset code after 5 wrong guesses', async () => {
    const user = await t.makeUser({ role: 'MEMBER' });
    const anon = await t.newClient();
    await anon.post('/auth/forgot-password', { email: user.email });
    const { code } = await codeFor(user.email, 'Đặt lại mật khẩu');
    for (let i = 0; i < 5; i++)
      expect((await anon.post('/auth/reset-password-code', { email: user.email, code: wrong(code), password: 'a-brand-new-password-1' })).status).toBe(400);
    expect((await anon.post('/auth/reset-password-code', { email: user.email, code, password: 'a-brand-new-password-1' })).status).toBe(400);
    expect((await (await t.newClient()).post('/auth/login', { portal: 'MEMBER', identifier: user.email, password: user.password })).status).toBe(200); // password untouched
  });

  it('a verification code can never reset a password (codes are bound to their purpose)', async () => {
    const c = await t.newClient();
    const email = await register(c, 'crosscheck');
    const { code } = await codeFor(email, 'Mã xác minh');
    const r = await (await t.newClient()).post('/auth/reset-password-code', { email, code, password: 'a-brand-new-password-1' });
    expect(r.status).toBe(400);
    expect((await (await t.newClient()).post('/auth/login', { portal: 'MEMBER', identifier: email, password: 'long-enough-pass' })).status).toBe(200);
  });

  it('rejects weak passwords and malformed bodies before touching the code', async () => {
    const anon = await t.newClient();
    expect((await anon.post('/auth/reset-password-code', { email: 'a@example.test', code: '123456', password: 'short' })).status).toBe(400);
    expect((await anon.post('/auth/reset-password-code', { email: 'a@example.test', code: '12', password: 'long-enough-pass' })).status).toBe(400);
    expect((await anon.post('/auth/reset-password-code', { email: 'a@example.test', code: '123456', password: 'long-enough-pass', role: 'ADMIN' })).status).toBe(400);
  });
});

describe('admin invites a user by e-mail', () => {
  it('the invitee gets the code at their own address and can activate with it (no link needed)', async () => {
    const admin = await t.loginAs(await t.makeUser({ role: 'ADMIN', mfa: true }));
    const inv = await admin.post('/admin/users', { username: 'moi.nguoi', email: 'moi.nguoi@example.test', displayName: 'Người Được Mời', role: 'COLLABORATOR' });
    expect(inv.status).toBe(201);
    const { code, text } = await codeFor('moi.nguoi@example.test', 'Kích hoạt tài khoản');
    expect(text).toContain('Người Được Mời');

    const password = 'invited-user-pass-1';
    expect((await (await t.newClient()).post('/auth/reset-password-code', { email: 'moi.nguoi@example.test', code, password })).status).toBe(204);
    const login = await (await t.newClient()).post('/auth/login', { portal: 'COLLABORATOR', identifier: 'moi.nguoi', password });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('COLLABORATOR');
    expect(login.body.user.emailVerified).toBe(true);
  });
});

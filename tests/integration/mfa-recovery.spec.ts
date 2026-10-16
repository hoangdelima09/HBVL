import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, insertPublished } from './support/fixtures';
import { createTestApp, type Client, type TestApp, type TestUser } from './support/app';
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

/** Password step only: the session exists but the two-factor step is still pending. */
async function halfSignIn(u: TestUser): Promise<Client> {
  const c = await t.newClient();
  const r = await c.post('/auth/login', { portal: u.role, identifier: u.username, password: u.password });
  expect(r.status).toBe(200);
  expect(r.body.mfaRequired).toBe(true);
  return c;
}
async function mailTo(to: string, subject: string) {
  const m = await mailpit.waitFor((x) => x.To[0]?.Address === to && x.Subject.includes(subject));
  expect(m, `mail "${subject}" to ${to}`).toBeDefined();
  return { subject: m!.Subject, text: await mailpit.fullText(m!.ID) };
}
const mfaOf = async (id: string) => (await t.admin.query(`SELECT "mfaEnabled", "mfaSecretEnc" FROM users WHERE id=$1`, [id])).rows[0];

describe('the two-factor step is enforced for every role', () => {
  it('a member with 2FA who only gave the password is treated as signed out', async () => {
    const cat = await categoryId(t, 'chuyen-vuon-len');
    const author = await t.makeUser();
    const post = await insertPublished(t, { authorId: author.id, categoryId: cat });
    const m = await t.makeUser({ role: 'MEMBER', mfa: true });
    const c = await halfSignIn(m);
    const me = await c.get('/auth/me');
    expect(me.body).toMatchObject({ user: null, mfaPending: true });
    for (const r of [
      await c.get('/me'),
      await c.get('/me/notifications'),
      await c.post(`/posts/${post.id}/comments`, { body: 'Chưa qua bước 2' }),
      await c.patch('/me', { bio: 'x' }),
    ]) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('MFA_REQUIRED');
    }
    // the public thread does not treat a half signed-in visitor as the account owner either
    expect((await c.get(`/posts/${post.id}/comments`)).status).toBe(200);
    // after the code everything works (TestApp.loginAs does the second step)
    const full = await t.loginAs(m);
    expect((await full.get('/me')).status).toBe(200);
    expect((await full.get('/auth/me')).body.user.username).toBe(m.username);
  });
});

describe('collaborator / member lost their authenticator', () => {
  it('code by e-mail → request to every admin (in-app + e-mail) → admin approves → 2FA removed, user told by e-mail', async () => {
    const admin = await t.makeUser({ role: 'ADMIN', mfa: true });
    const admin2 = await t.makeUser({ role: 'ADMIN', mfa: true });
    const ctv = await t.makeUser({ role: 'COLLABORATOR', mfa: true });
    const c = await halfSignIn(ctv);

    expect((await c.post('/auth/mfa/recovery/send-code')).status).toBe(200);
    const { text } = await mailTo(ctv.email, 'Mã xác nhận yêu cầu gỡ xác thực 2 lớp');
    const code = /(\d{6})/.exec(text)![1]!;
    expect((await c.post('/auth/mfa/recovery/request', { code: code === '000000' ? '111111' : '000000' })).body.error.code).toBe('CODE_INVALID');
    const r = await c.post('/auth/mfa/recovery/request', { code, note: 'Em làm mất điện thoại.' });
    expect(r.status).toBe(200);
    // a second request while one is open is refused (and no new code is sent)
    expect((await c.post('/auth/mfa/recovery/send-code')).body.error.details).toMatchObject({ reason: 'ALREADY_PENDING' });
    expect((await c.get('/auth/mfa/recovery/status')).body.request.status).toBe('PENDING');

    // every administrator: in-app alert + e-mail; the requester gets a receipt
    for (const a of [admin, admin2]) {
      const mail = await mailTo(a.email, 'Yêu cầu gỡ xác thực 2 lớp');
      expect(mail.text).toContain(ctv.username);
      expect(mail.text).toContain('Em làm mất điện thoại.');
      expect(mail.text).toContain('/admin/yeu-cau-xac-thuc');
    }
    await mailTo(ctv.email, 'Đã gửi yêu cầu gỡ xác thực 2 lớp');
    const ac = await t.loginAs(admin);
    expect((await ac.get('/me/notifications')).body.items[0]).toMatchObject({ type: 'mfa.reset_request', readAt: null });
    expect((await ac.get('/admin/dashboard')).body.mfaRequests).toBe(1);

    const list = await ac.get('/admin/mfa-requests?status=PENDING');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ note: 'Em làm mất điện thoại.', user: { username: ctv.username, role: 'COLLABORATOR' } });
    const id = list.body.items[0].id as string;

    const ok = await ac.post(`/admin/mfa-requests/${id}/approve`, { note: 'Đã gọi điện xác minh.' });
    expect(ok.status).toBe(200);
    expect(await mfaOf(ctv.id)).toMatchObject({ mfaEnabled: false, mfaSecretEnc: null });
    expect((await t.admin.query(`SELECT count(*)::int n FROM mfa_recovery_codes WHERE "userId"=$1`, [ctv.id])).rows[0].n).toBe(0);
    expect((await c.get('/auth/me')).body.user).toBeNull(); // the half session was signed out
    const told = await mailTo(ctv.email, 'Đã gỡ xác thực 2 lớp');
    expect(told.text).toContain('Đã gọi điện xác minh.');
    expect(told.text).toContain('/dang-nhap-cong-tac-vien');
    // a second administrator acting on the same request gets 409; their alert is already cleared
    const ac2 = await t.loginAs(admin2);
    expect((await ac2.post(`/admin/mfa-requests/${id}/reject`, { note: 'muộn' })).body.error.details).toMatchObject({ reason: 'ALREADY_HANDLED' });
    expect((await ac2.get('/me/notifications')).body.unread).toBe(0);
    // signs in with the password alone now
    const again = await (await t.newClient()).post('/auth/login', { portal: 'COLLABORATOR', identifier: ctv.username, password: ctv.password });
    expect(again.body.mfaRequired).toBe(false);
    const audit = await t.admin.query(`SELECT action FROM audit_logs WHERE "resourceId"=$1 AND action LIKE '%mfa%' ORDER BY id`, [ctv.id]);
    expect(audit.rows.map((x) => x.action)).toEqual(['auth.mfa_recovery_code', 'auth.mfa_reset_request', 'user.mfa_reset_approve']);
  });

  it('an administrator may reject with a reason; the member is told and 2FA stays', async () => {
    const admin = await t.makeUser({ role: 'ADMIN', mfa: true });
    const m = await t.makeUser({ role: 'MEMBER', mfa: true });
    const c = await halfSignIn(m);
    await c.post('/auth/mfa/recovery/send-code');
    const code = /(\d{6})/.exec((await mailTo(m.email, 'Mã xác nhận')).text)![1]!;
    await c.post('/auth/mfa/recovery/request', { code });
    const ac = await t.loginAs(admin);
    const id = (await ac.get('/admin/mfa-requests')).body.items[0].id;
    expect((await ac.post(`/admin/mfa-requests/${id}/reject`, {})).status).toBe(400); // a reason is required
    expect((await ac.post(`/admin/mfa-requests/${id}/reject`, { note: 'Không xác minh được người gửi.' })).status).toBe(200);
    expect((await mfaOf(m.id)).mfaEnabled).toBe(true);
    expect((await mailTo(m.email, 'bị từ chối')).text).toContain('Không xác minh được người gửi.');
    // after a decision a new request is possible again
    expect((await c.post('/auth/mfa/recovery/send-code')).status).toBe(200);
  });

  it('needs the password step first, 2FA enabled, and is not for administrators or fully signed-in sessions', async () => {
    const anon = await t.newClient();
    expect((await anon.post('/auth/mfa/recovery/send-code')).status).toBe(401);
    const plain = await t.loginAs(await t.makeUser()); // no 2FA
    expect((await plain.post('/auth/mfa/recovery/send-code')).status).toBe(409);
    const m = await t.makeUser({ mfa: true });
    expect((await (await t.loginAs(m)).post('/auth/mfa/recovery/send-code')).status).toBe(409); // already verified: manage it in Account
    const admin = await t.makeUser({ role: 'ADMIN', mfa: true });
    expect((await (await halfSignIn(admin)).post('/auth/mfa/recovery/send-code')).status).toBe(403);
    // members cannot reach the admin queue; collaborators neither
    const ctv = await t.loginAs(await t.makeUser({ role: 'COLLABORATOR' }));
    expect((await ctv.get('/admin/mfa-requests')).status).toBe(403);
  });

  it('the e-mailed code is bound to its purpose and burns after 5 wrong guesses', async () => {
    const m = await t.makeUser({ mfa: true });
    const c = await halfSignIn(m);
    await c.post('/auth/mfa/recovery/send-code');
    const code = /(\d{6})/.exec((await mailTo(m.email, 'Mã xác nhận')).text)![1]!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await c.post('/auth/mfa/recovery/request', { code: wrong });
    expect((await c.post('/auth/mfa/recovery/request', { code })).body.error.code).toBe('CODE_INVALID');
    // not usable to reset the password either (different purpose)
    expect((await (await t.newClient()).post('/auth/reset-password-code', { email: m.email, portal: 'MEMBER', code, password: 'mat-khau-moi-dai-du' })).status).toBe(400);
  });
});

describe('administrator lost their authenticator or password', () => {
  it('2FA: a one-time link by e-mail (no code) removes it; the admin area stays locked until it is enabled again', async () => {
    const admin = await t.makeUser({ role: 'ADMIN', mfa: true });
    const c = await halfSignIn(admin);
    expect((await c.post('/auth/mfa/reset-link')).status).toBe(200);
    const mail = await mailTo(admin.email, 'Liên kết gỡ xác thực 2 lớp');
    expect(mail.text).not.toMatch(/\b\d{6}\b/); // link only, no code
    const token = decodeURIComponent(/go-xac-thuc\?token=(\S+)/.exec(mail.text)![1]!);

    expect((await (await t.newClient()).post('/auth/mfa/reset', { token: 'x'.repeat(40) })).status).toBe(400);
    expect((await (await t.newClient()).post('/auth/mfa/reset', { token })).status).toBe(204);
    expect((await (await t.newClient()).post('/auth/mfa/reset', { token })).status).toBe(400); // one use
    expect((await mfaOf(admin.id)).mfaEnabled).toBe(false);
    expect((await c.get('/auth/me')).body.user).toBeNull(); // every session signed out
    await mailTo(admin.email, 'Xác thực 2 lớp đã được gỡ');

    // password-only sign-in works, but /admin refuses until 2FA is enabled again
    const fresh = await t.newClient();
    const login = await fresh.post('/auth/login', { portal: 'ADMIN', identifier: admin.username, password: admin.password });
    expect(login.body.mfaRequired).toBe(false);
    expect((await fresh.get('/admin/dashboard')).body.error.code).toBe('MFA_ENROLL_REQUIRED');
  });

  it('the link needs the password step first and is only for administrators', async () => {
    expect((await (await t.newClient()).post('/auth/mfa/reset-link')).status).toBe(401);
    const m = await t.makeUser({ mfa: true });
    expect((await (await halfSignIn(m)).post('/auth/mfa/reset-link')).status).toBe(403);
    // a member token cannot be replayed as an MFA reset
    const admin = await t.makeUser({ role: 'ADMIN', mfa: true });
    await (await t.newClient()).post('/auth/forgot-password', { email: admin.email, portal: 'ADMIN' });
    const resetMail = await mailTo(admin.email, 'Đặt lại mật khẩu quản trị');
    const pwToken = decodeURIComponent(/dat-lai-mat-khau\?token=([^&\s]+)/.exec(resetMail.text)![1]!);
    expect((await (await t.newClient()).post('/auth/mfa/reset', { token: pwToken })).status).toBe(400);
    expect((await mfaOf(admin.id)).mfaEnabled).toBe(true);
  });

  it('password: an administrator gets a link only — a 6-digit code is never sent nor accepted', async () => {
    const admin = await t.makeUser({ role: 'ADMIN', mfa: true });
    await (await t.newClient()).post('/auth/forgot-password', { email: admin.email, portal: 'ADMIN' });
    const mail = await mailTo(admin.email, 'Đặt lại mật khẩu quản trị');
    expect(mail.subject).not.toMatch(/\d{6}/);
    expect(mail.text).not.toMatch(/\b\d{6}\b/);
    expect((await t.admin.query(`SELECT "codeHash" FROM auth_tokens WHERE "userId"=$1 AND purpose='RESET_PASSWORD'`, [admin.id])).rows[0].codeHash).toBeNull();
    for (const code of ['000000', '123456']) {
      expect((await (await t.newClient()).post('/auth/reset-password-code', { email: admin.email, portal: 'ADMIN', code, password: 'mat-khau-moi-dai-du' })).body.error.code).toBe('CODE_INVALID');
    }
    const token = decodeURIComponent(/dat-lai-mat-khau\?token=([^&\s]+)/.exec(mail.text)![1]!);
    expect((await (await t.newClient()).post('/auth/reset-password', { token, password: 'mat-khau-moi-dai-du' })).status).toBe(204);
    // the password changed; two-factor authentication did not
    expect((await mfaOf(admin.id)).mfaEnabled).toBe(true);
    const c = await t.newClient();
    expect((await c.post('/auth/login', { portal: 'ADMIN', identifier: admin.username, password: 'mat-khau-moi-dai-du' })).body.mfaRequired).toBe(true);
    // members still get a code
    const m = await t.makeUser();
    await (await t.newClient()).post('/auth/forgot-password', { email: m.email, portal: 'MEMBER' });
    expect((await mailTo(m.email, 'Đặt lại mật khẩu')).subject).toMatch(/\d{6}/);
  });
});

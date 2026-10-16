import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, createDraft, insertPublished, submit } from './support/fixtures';
import { createTestApp, type Client, type TestApp, type TestUser } from './support/app';

let t: TestApp;
let cat: string;
let admin: TestUser, collab: TestUser, collab2: TestUser, member: TestUser, member2: TestUser;
let ac: Client, cc: Client, cc2: Client, mc: Client;

beforeAll(async () => {
  t = await createTestApp();
  cat = await categoryId(t, 'chuyen-vuon-len');
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  member = await t.makeUser({ role: 'MEMBER' });
  member2 = await t.makeUser({ role: 'MEMBER' });
  collab = await t.makeUser({ role: 'COLLABORATOR' });
  collab2 = await t.makeUser({ role: 'COLLABORATOR' });
  admin = await t.makeUser({ role: 'ADMIN', mfa: true });
  [mc, cc, cc2, ac] = await Promise.all([t.loginAs(member), t.loginAs(collab), t.loginAs(collab2), t.loginAs(admin)]);
});

const feedback = { subject: 'Đề xuất cải thiện trang bản đồ', message: 'Mong ban biên tập thêm chú giải màu cho bản đồ.' };

describe('feedback alerts for staff', () => {
  it('every collaborator and admin is told; opening it clears only your own alert; reading one item clears just that item', async () => {
    const sent = await mc.post('/feedback', feedback);
    expect(sent.status).toBe(201);
    const fid = sent.body.id as string;

    for (const c of [cc, cc2, ac]) {
      const n = await c.get('/me/notifications');
      expect(n.body.unread).toBe(1);
      expect(n.body.items[0]).toMatchObject({ type: 'feedback.new', data: { feedbackId: fid }, readAt: null });
      expect(n.body.items[0].title).toContain('Đề xuất cải thiện trang bản đồ');
    }
    expect((await mc.get('/me/notifications')).body.unread).toBe(0); // not the sender
    const other = await t.loginAs(member2);
    expect((await other.get('/me/notifications')).body.unread).toBe(0); // not other members

    // collaborator 1 opens the feedback → their alert is gone, the others' stay
    expect((await cc.get(`/staff/feedback/${fid}`)).status).toBe(200);
    expect((await cc.get('/me/notifications')).body.unread).toBe(0);
    expect((await cc2.get('/me/notifications')).body.unread).toBe(1);
    expect((await ac.get('/me/notifications')).body.unread).toBe(1);

    // collaborator 2 marks that single item read from the bell
    const id = (await cc2.get('/me/notifications')).body.items[0].id as string;
    expect((await cc2.post(`/me/notifications/${id}/read`)).status).toBe(204);
    expect((await cc2.get('/me/notifications')).body.unread).toBe(0);
    // someone else's notification id is a silent no-op
    expect((await cc.post(`/me/notifications/${(await ac.get('/me/notifications')).body.items[0].id}/read`)).status).toBe(204);
    expect((await ac.get('/me/notifications')).body.unread).toBe(1);
  });

  it('feedback posted by a collaborator does not alert themselves', async () => {
    expect((await cc.post('/feedback', feedback)).status).toBe(201);
    expect((await cc.get('/me/notifications')).body.unread).toBe(0);
    expect((await cc2.get('/me/notifications')).body.unread).toBe(1);
    expect((await ac.get('/me/notifications')).body.unread).toBe(1);
  });
});

describe('post submitted → e-mail to collaborators', () => {
  async function queuedMails() {
    const r = await t.admin.query(`SELECT "aggregateId", "dedupeKey", payload->>'kind' AS kind FROM outbox_events WHERE type='EMAIL_SEND' AND payload->>'kind'='POST_SUBMITTED'`);
    return r.rows as { aggregateId: string; dedupeKey: string; kind: string }[];
  }

  it('each collaborator gets one mail, admins and the sender do not; staff still get the in-app alert', async () => {
    const d = await createDraft(mc, cat);
    expect((await submit(mc, d.id, d.version)).status).toBe(200);
    const mails = await queuedMails();
    expect(mails).toHaveLength(2);
    const keys = mails.map((m) => m.dedupeKey);
    for (const u of [collab, collab2]) expect(keys.some((k) => new RegExp(`^post-submitted-${d.id}-v\\d+-${u.id}$`).test(k))).toBe(true);
    expect(keys.some((k) => k.endsWith(admin.id) || k.endsWith(member.id))).toBe(false);
    for (const c of [cc, cc2, ac]) expect((await c.get('/me/notifications')).body.items.some((i: { type: string }) => i.type === 'post.submitted')).toBe(true);
  });

  it("a collaborator's own submission is mailed to the other collaborators only", async () => {
    const d = await createDraft(cc, cat);
    await submit(cc, d.id, d.version);
    const mails = await queuedMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.dedupeKey).toContain(collab2.id);
  });
});

describe('administrator resets a password to the default', () => {
  const DEFAULT = '123456789';

  it('signs the person out, sets the default, and forces a new password before anything else works', async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const old = await t.loginAs(member); // an existing device
    await t.admin.query(`UPDATE users SET "failedLoginCount"=5, "lockedUntil"=now()+interval '1 hour' WHERE id=$1`, [member.id]);

    const r = await ac.post(`/admin/users/${member.id}/reset-password`);
    expect(r.status).toBe(200);
    expect((await old.get('/auth/me')).body.user).toBeNull(); // every session ended
    expect((await mc.get('/auth/me')).body.user).toBeNull();
    // the old password is dead, the default works (lock cleared)
    expect((await (await t.newClient()).post('/auth/login', { portal: 'MEMBER', identifier: member.username, password: member.password })).status).toBe(401);
    const c = await t.newClient();
    const login = await c.post('/auth/login', { portal: 'MEMBER', identifier: member.username, password: DEFAULT });
    expect(login.status).toBe(200);
    expect(login.body.redirectTo).toBe('/tai-khoan');
    expect(login.body.user.mustChangePassword).toBe(true);
    expect((await c.get('/auth/me')).body.user.mustChangePassword).toBe(true);

    // everything is refused until the password is changed…
    for (const res of [
      await c.post(`/posts/${p.id}/comments`, { body: 'Thử bình luận' }),
      await c.put(`/posts/${p.id}/like`),
      await c.get('/me/notifications'),
      await c.get('/me/sessions'),
      await c.post('/feedback', feedback),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    // …except choosing a new one (the weak default is not accepted as the new password)
    expect((await c.post('/me/password', { currentPassword: DEFAULT, newPassword: DEFAULT })).status).toBe(400);
    expect((await c.post('/me/password', { currentPassword: 'sai-mat-khau-hien-tai', newPassword: 'mat-khau-moi-rat-dai-1' })).status).toBe(400);
    expect((await c.post('/me/password', { currentPassword: DEFAULT, newPassword: 'mat-khau-moi-rat-dai-1' })).status).toBe(204);
    expect((await c.get('/auth/me')).body.user.mustChangePassword).toBe(false);
    expect((await c.post(`/posts/${p.id}/comments`, { body: 'Giờ thì được rồi' })).status).toBe(201);
    // the default no longer opens the account
    expect((await (await t.newClient()).post('/auth/login', { portal: 'MEMBER', identifier: member.username, password: DEFAULT })).status).toBe(401);
  });

  it('may sign out while the change is pending', async () => {
    await ac.post(`/admin/users/${member.id}/reset-password`);
    const c = await t.newClient();
    await c.post('/auth/login', { portal: 'MEMBER', identifier: member.username, password: DEFAULT });
    expect((await c.post('/auth/logout')).status).toBe(204);
  });

  it('a collaborator account can be reset too; the sign-in portal keeps working', async () => {
    expect((await ac.post(`/admin/users/${collab.id}/reset-password`)).status).toBe(200);
    const c = await t.newClient();
    const login = await c.post('/auth/login', { portal: 'COLLABORATOR', identifier: collab.username, password: DEFAULT });
    expect(login.status).toBe(200);
    expect(login.body.redirectTo).toBe('/tai-khoan'); // not the console, until the password is changed
    expect((await c.get('/staff/dashboard')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('never for administrators, yourself, accounts that never activated, unknown ids; only administrators can ask', async () => {
    const admin2 = await t.makeUser({ role: 'ADMIN', mfa: true });
    expect((await ac.post(`/admin/users/${admin2.id}/reset-password`)).status).toBe(403);
    expect((await ac.post(`/admin/users/${admin.id}/reset-password`)).status).toBe(403);
    const pending = await t.makeUser({ status: 'PENDING_RESET' });
    expect((await ac.post(`/admin/users/${pending.id}/reset-password`)).status).toBe(409);
    expect((await ac.post('/admin/users/00000000-0000-7000-8000-000000000000/reset-password')).status).toBe(404);
    expect((await cc.post(`/admin/users/${member.id}/reset-password`)).status).toBe(403);
    expect((await mc.post(`/admin/users/${member2.id}/reset-password`)).status).toBe(403);
    expect((await (await t.newClient()).post(`/admin/users/${member.id}/reset-password`)).status).toBe(401);
    // nothing changed for the refused ones
    expect(
      (await t.admin.query(`SELECT "mustChangePassword" FROM users WHERE id=ANY($1)`, [[admin2.id, admin.id, pending.id, member.id]])).rows.every(
        (r) => r.mustChangePassword === false,
      ),
    ).toBe(true);
  });

  it('is audited, the owner is told (in-app + e-mail without the password) and old reset codes are revoked', async () => {
    await mc.post('/auth/forgot-password', { email: member.email, portal: 'MEMBER' }); // creates a reset token
    await ac.post(`/admin/users/${member.id}/reset-password`);
    const a = await t.admin.query(`SELECT "actorId", metadata FROM audit_logs WHERE action='user.reset_password' AND "resourceId"=$1`, [member.id]);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].actorId).toBe(admin.id);
    expect(JSON.stringify(a.rows[0].metadata)).not.toContain(DEFAULT);
    expect((await t.admin.query(`SELECT count(*)::int n FROM notifications WHERE "userId"=$1 AND type='account.password_reset'`, [member.id])).rows[0].n).toBe(1);
    expect((await t.admin.query(`SELECT count(*)::int n FROM outbox_events WHERE payload->>'kind'='PASSWORD_RESET_BY_ADMIN' AND "aggregateId"=$1`, [member.id])).rows[0].n).toBe(1);
    expect((await t.admin.query(`SELECT count(*)::int n FROM auth_tokens WHERE "userId"=$1 AND purpose='RESET_PASSWORD'`, [member.id])).rows[0].n).toBe(0);
    // the stored e-mail payload is encrypted and never contains the temporary password in clear
    const raw = await t.admin.query(`SELECT payload::text AS p FROM outbox_events WHERE payload->>'kind'='PASSWORD_RESET_BY_ADMIN'`);
    expect(raw.rows[0].p).not.toContain(DEFAULT);
  });
});

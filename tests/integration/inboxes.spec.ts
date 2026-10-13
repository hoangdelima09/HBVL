import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type Client, type TestApp, type TestUser } from './support/app';

let t: TestApp;
let admin: TestUser, collab: TestUser, member: TestUser;
let ac: Client, cc: Client, mc: Client;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  member = await t.makeUser({ role: 'MEMBER' });
  collab = await t.makeUser({ role: 'COLLABORATOR' });
  admin = await t.makeUser({ role: 'ADMIN', mfa: true });
  [mc, cc, ac] = await Promise.all([t.loginAs(member), t.loginAs(collab), t.loginAs(admin)]);
});

const fb = (over: Record<string, unknown> = {}) => ({ subject: 'Góp ý về website', message: "Nội dung góp ý có dấu, dấu nháy O'Reilly và C:\\notes\\new.", ...over });
const ct = (over: Record<string, unknown> = {}) => ({
  name: 'Nguyễn Văn A',
  email: 'a@example.test',
  subject: 'Hỏi về học bổng',
  message: 'Tôi muốn biết thêm thông tin.',
  ...over,
});

describe('feedback (member → collaborator + admin only)', () => {
  it('stores text verbatim (unicode + backslash), enforces limits, 60 s cooldown', async () => {
    const ok = await mc.post('/feedback', fb());
    expect(ok.status).toBe(201);
    const row = await t.admin.query(`SELECT message, subject FROM feedbacks`);
    expect(row.rows[0].message).toBe(fb().message);
    // cooldown
    const again = await mc.post('/feedback', fb());
    expect(again.status).toBe(429);
    expect(again.headers['retry-after']).toBeDefined();
    // limits (use another account to bypass the cooldown)
    const u2 = await t.loginAs(await t.makeUser());
    expect((await u2.post('/feedback', fb({ subject: 'x'.repeat(161) }))).status).toBe(400);
    expect((await u2.post('/feedback', fb({ message: 'x'.repeat(5001) }))).status).toBe(400);
    expect((await u2.post('/feedback', fb({ subject: '   ' }))).status).toBe(400);
    expect((await u2.post('/feedback', fb({ subject: 'x'.repeat(160), message: 'y'.repeat(5000) }))).status).toBe(201);
    expect((await (await t.newClient()).post('/feedback', fb())).status).toBe(401);
  });

  it('a failed validation does not consume the cooldown', async () => {
    expect((await mc.post('/feedback', fb({ message: '' }))).status).toBe(400);
    expect((await mc.post('/feedback', fb())).status).toBe(201);
  });

  it('honeypot submissions are swallowed without storing anything', async () => {
    const r = await mc.post('/feedback', fb({ website: 'http://spam.test' }));
    expect(r.status).toBe(201);
    expect((await t.admin.query(`SELECT count(*)::int n FROM feedbacks`)).rows[0].n).toBe(0);
  });

  it('inbox is readable by collaborator and admin, never by members or guests (list, detail, counts, status)', async () => {
    await mc.post('/feedback', fb());
    const id = (await t.admin.query(`SELECT id FROM feedbacks`)).rows[0].id as string;
    for (const c of [cc, ac]) {
      expect((await c.get('/staff/feedback')).body.items).toHaveLength(1);
      expect((await c.get(`/staff/feedback/${id}`)).body.message).toBe(fb().message);
      expect((await c.get('/staff/feedback/counts')).body.NEW).toBe(1);
    }
    const anon = await t.newClient();
    for (const path of ['/staff/feedback', `/staff/feedback/${id}`, '/staff/feedback/counts']) {
      expect((await mc.get(path)).status).toBe(403);
      expect((await anon.get(path)).status).toBe(401);
    }
    expect((await mc.patch(`/staff/feedback/${id}`, { status: 'RESOLVED' })).status).toBe(403);
    // staff notes never alter the sender's original text and are logged
    const st = await cc.patch(`/staff/feedback/${id}`, { status: 'IN_PROGRESS', note: 'Đã chuyển cho nhóm kỹ thuật.' });
    expect(st.status).toBe(200);
    const detail = await ac.get(`/staff/feedback/${id}`);
    expect(detail.body.message).toBe(fb().message);
    expect(detail.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['NEW', 'IN_PROGRESS']);
    expect(detail.body.history[1].note).toBe('Đã chuyển cho nhóm kỹ thuật.');
  });
});

describe('contact (member → admin only)', () => {
  it('stores the message first, returns a receipt (not "delivered"), queues exactly one notification', async () => {
    const r = await mc.post('/contact', ct());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ received: true, notification: 'QUEUED' });
    expect(r.body.receiptCode).toMatch(/^LH-\d{4}-\d{6}$/);
    const row = await t.admin.query(`SELECT "mailState", status, subject FROM contact_messages`);
    expect(row.rows[0]).toMatchObject({ mailState: 'QUEUED', status: 'NEW' });
    const ob = await t.admin.query(`SELECT type, status FROM outbox_events WHERE "aggregateType"='contact'`);
    expect(ob.rows).toEqual([{ type: 'EMAIL_SEND', status: 'PENDING' }]);
  });

  it('validates limits; default subject; cooldown', async () => {
    expect((await mc.post('/contact', ct({ name: 'x'.repeat(121) }))).status).toBe(400);
    expect((await mc.post('/contact', ct({ email: 'not-an-email' }))).status).toBe(400);
    expect((await mc.post('/contact', ct({ email: `${'a'.repeat(250)}@x.co` }))).status).toBe(400);
    expect((await mc.post('/contact', ct({ subject: 's'.repeat(201) }))).status).toBe(400);
    expect((await mc.post('/contact', ct({ message: 'm'.repeat(5001) }))).status).toBe(400);
    const ok = await mc.post('/contact', ct({ subject: '' }));
    expect(ok.status).toBe(201);
    expect((await t.admin.query(`SELECT subject FROM contact_messages`)).rows[0].subject).toBe('Liên hệ từ website');
    expect((await mc.post('/contact', ct())).status).toBe(429);
  });

  it('only ADMIN reads or processes the contact inbox (collaborator and member are refused)', async () => {
    await mc.post('/contact', ct());
    const id = (await t.admin.query(`SELECT id FROM contact_messages`)).rows[0].id as string;
    expect((await ac.get('/admin/contact')).body.items).toHaveLength(1);
    expect((await ac.get(`/admin/contact/${id}`)).body.message).toBe(ct().message);
    for (const path of ['/admin/contact', `/admin/contact/${id}`]) {
      expect((await cc.get(path)).status).toBe(403);
      expect((await mc.get(path)).status).toBe(403);
    }
    expect((await cc.patch(`/admin/contact/${id}`, { status: 'DONE' })).status).toBe(403);
    expect((await ac.patch(`/admin/contact/${id}`, { status: 'DONE' })).status).toBe(200);
    expect((await ac.get('/admin/contact?status=DONE')).body.items).toHaveLength(1);
  });

  it('guests cannot send; unverified accounts cannot send', async () => {
    expect((await (await t.newClient()).post('/contact', ct())).status).toBe(401);
    const unv = await t.loginAs(await t.makeUser({ verified: false }));
    const r = await unv.post('/contact', ct());
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

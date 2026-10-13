import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, createDraft, draftBody, key, submit } from './support/fixtures';
import { createTestApp, type Client, type TestApp, type TestUser } from './support/app';

let t: TestApp;
let cat: string;
let member: TestUser, other: TestUser, collab: TestUser, admin: TestUser;
let mc: Client, oc: Client, cc: Client, ac: Client;

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
  other = await t.makeUser({ role: 'MEMBER' });
  collab = await t.makeUser({ role: 'COLLABORATOR' });
  admin = await t.makeUser({ role: 'ADMIN', mfa: true });
  [mc, oc, cc, ac] = await Promise.all([t.loginAs(member), t.loginAs(other), t.loginAs(collab), t.loginAs(admin)]);
});

const ifm = (v: number) => ({ 'If-Match': `"${v}"` });

describe('end-to-end review flow (state machine over HTTP)', () => {
  it('member → collaborator requests changes → member resubmits → admin publishes → public', async () => {
    const d = await createDraft(mc, cat);
    expect(d.status).toBe('DRAFT');
    expect((await submit(mc, d.id, d.version)).status).toBe(200);

    // collaborator sees it in the queue and edits content
    const queue = await cc.get('/staff/review-queue');
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(d.id);
    const staffView = await cc.get(`/staff/posts/${d.id}`);
    const edited = await cc.patch(`/staff/posts/${d.id}`, { contentHtml: '<p>Đã biên tập bởi cộng tác viên.</p>' }, ifm(staffView.body.version));
    expect(edited.status).toBe(200);

    // request changes requires a reason
    const noReason = await cc.post(`/staff/posts/${d.id}/request-changes`, { reason: '   ' }, ifm(edited.body.version));
    expect(noReason.status).toBe(400);
    const rc = await cc.post(`/staff/posts/${d.id}/request-changes`, { reason: 'Vui lòng bổ sung nguồn trích dẫn.' }, ifm(edited.body.version));
    expect(rc.status).toBe(200);
    expect(rc.body.status).toBe('CHANGES_REQUESTED');

    // sender sees the reason and can edit again; another member cannot
    const mine = await mc.get(`/me/posts/${d.id}`);
    expect(mine.body.feedback.reason).toBe('Vui lòng bổ sung nguồn trích dẫn.');
    expect((await oc.get(`/me/posts/${d.id}`)).status).toBe(404);
    const fixed = await mc.put(`/me/posts/${d.id}`, draftBody(cat, { contentHtml: '<p>Đã bổ sung nguồn.</p>' }), ifm(mine.body.version));
    expect(fixed.status).toBe(200);
    const re = await submit(mc, d.id, fixed.body.version);
    expect(re.status).toBe(200);
    expect(re.body.status).toBe('PENDING_REVIEW');

    // collaborator cannot use the admin endpoint; admin can publish
    const cpub = await cc.post(`/admin/posts/${d.id}/publish`, undefined, ifm(re.body.version));
    expect(cpub.status).toBe(403);
    expect((await t.admin.query(`SELECT status FROM posts WHERE id=$1`, [d.id])).rows[0].status).toBe('PENDING_REVIEW');
    const pub = await ac.post(`/admin/posts/${d.id}/publish`, undefined, ifm(re.body.version));
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('PUBLISHED');
    expect(pub.body.slug).toBe('hanh-trinh-vuon-len-cua-em');

    // public API now serves it; history has every transition with actor and reason
    const anon = await t.newClient();
    const pubGet = await anon.get(`/posts/${pub.body.slug}`);
    expect(pubGet.status).toBe(200);
    expect(pubGet.body.title).toBe('Hành trình vươn lên của em');
    const hist = await ac.get(`/admin/posts/${d.id}`);
    const actions = hist.body.history.map((h: { action: string }) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['CREATE', 'SUBMIT', 'STAFF_EDIT', 'REQUEST_CHANGES', 'SAVE_DRAFT', 'PUBLISH']));
    expect(hist.body.history.find((h: { action: string }) => h.action === 'REQUEST_CHANGES').reason).toBe('Vui lòng bổ sung nguồn trích dẫn.');

    // published ⇒ locked for the sender; unpublish hides it everywhere
    const lockedEdit = await mc.put(`/me/posts/${d.id}`, draftBody(cat), ifm(pub.body.version));
    expect(lockedEdit.status).toBe(403);
    expect(lockedEdit.body.error.code).toBe('STATE_LOCKED');
    const un = await ac.post(`/admin/posts/${d.id}/unpublish`, undefined, ifm(pub.body.version));
    expect(un.status).toBe(200);
    expect((await anon.get(`/posts/${pub.body.slug}`)).status).toBe(404);
  });

  it('admin rejects with a reason; sender cannot edit or resubmit a rejected post', async () => {
    const d = await createDraft(mc, cat);
    const s = await submit(mc, d.id, d.version);
    expect((await ac.post(`/admin/posts/${d.id}/reject`, { reason: '' }, ifm(s.body.version))).status).toBe(400);
    const rj = await ac.post(`/admin/posts/${d.id}/reject`, { reason: 'Nội dung không phù hợp với chuyên mục.' }, ifm(s.body.version));
    expect(rj.body.status).toBe('REJECTED');
    const mine = await mc.get(`/me/posts/${d.id}`);
    expect(mine.body.feedback).toMatchObject({ action: 'REJECT', reason: 'Nội dung không phù hợp với chuyên mục.' });
    expect((await mc.put(`/me/posts/${d.id}`, draftBody(cat), ifm(rj.body.version))).status).toBe(403);
    expect((await submit(mc, d.id, rj.body.version)).status).toBe(403);
    // a rejected post is never public
    expect((await (await t.newClient()).get(`/posts/hanh-trinh-vuon-len-cua-em`)).status).toBe(404);
  });

  it("collaborator publishes others' pending posts via /staff, but not their own; /admin endpoints stay admin-only", async () => {
    const d = await createDraft(mc, cat);
    const s = await submit(mc, d.id, d.version);
    const pub = await cc.post(`/staff/posts/${d.id}/publish`, undefined, ifm(s.body.version));
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('PUBLISHED');
    expect((await (await t.newClient()).get(`/posts/${pub.body.slug}`)).status).toBe(200);
    expect((await cc.post(`/admin/posts/${d.id}/unpublish`, undefined, ifm(pub.body.version))).status).toBe(403);

    const own = await createDraft(cc, cat);
    const os = await submit(cc, own.id, own.version);
    expect((await cc.post(`/staff/posts/${own.id}/publish`, undefined, ifm(os.body.version))).status).toBe(403); // no self-approval
  });

  it('the /admin post endpoints (MFA console) stay closed to a collaborator even with a correct version; /staff does the same work', async () => {
    const d = await createDraft(mc, cat);
    const s = await submit(mc, d.id, d.version);
    expect((await cc.post(`/admin/posts/${d.id}/reject`, { reason: 'x' }, ifm(s.body.version))).status).toBe(403);
    expect((await cc.post(`/admin/posts/${d.id}/publish`, undefined, ifm(s.body.version))).status).toBe(403);
    expect((await cc.patch(`/admin/posts/${d.id}`, { title: 'hack' }, ifm(s.body.version))).status).toBe(403);
    expect((await cc.delete(`/admin/posts/${d.id}`, ifm(s.body.version))).status).toBe(403);
    // a collaborator now handles others' posts (everything except an administrator's) through the staff API
    const gone = await cc.delete(`/staff/posts/${d.id}`, ifm(s.body.version));
    expect(gone.status).toBe(200);
    expect(gone.body.status).toBe('TRASHED');
  });
});

describe('IDOR / visibility', () => {
  it("another member gets 404 for read/update/submit of someone else's draft", async () => {
    const d = await createDraft(mc, cat);
    expect((await oc.get(`/me/posts/${d.id}`)).status).toBe(404);
    expect((await oc.put(`/me/posts/${d.id}`, draftBody(cat), ifm(d.version))).status).toBe(404);
    expect((await submit(oc, d.id, d.version)).status).toBe(404);
    expect((await oc.get(`/staff/posts/${d.id}`)).status).toBe(403); // not a staff endpoint for members
    expect((await oc.get('/staff/review-queue')).status).toBe(403);
  });

  it("collaborator cannot see other users' drafts or private posts (narrower than WordPress edit_others_posts)", async () => {
    const d = await createDraft(mc, cat);
    expect((await cc.get(`/staff/posts/${d.id}`)).status).toBe(404);
    expect((await cc.get('/staff/review-queue')).body.items).toHaveLength(0);
  });

  it('drafts and pending posts never appear in public lists, search, or by slug', async () => {
    const d = await createDraft(mc, cat, { title: 'Bài bí mật chưa duyệt' });
    await submit(mc, d.id, d.version);
    const anon = await t.newClient();
    expect((await anon.get('/posts')).body.items).toHaveLength(0);
    expect((await anon.get('/search?q=bi%20mat')).body.items).toHaveLength(0);
    expect((await anon.get('/posts/bai-bi-mat-chua-duyet')).status).toBe(404);
    const row = await t.admin.query(`SELECT slug FROM posts WHERE id=$1`, [d.id]);
    expect((await anon.get(`/posts/${row.rows[0].slug}`)).status).toBe(404);
  });

  it('unauthenticated requests get 401 on protected routes', async () => {
    const anon = await t.newClient();
    expect((await anon.get('/me/posts')).status).toBe(401);
    expect((await anon.get('/staff/review-queue')).status).toBe(401);
    expect((await anon.get('/admin/posts')).status).toBe(401);
  });
});

describe('concurrency & idempotency', () => {
  it('same Idempotency-Key + same payload creates exactly one post (even in parallel)', async () => {
    const k = key();
    const body = draftBody(cat);
    const results = await Promise.all(Array.from({ length: 5 }, () => mc.post('/me/posts', body, { 'Idempotency-Key': k })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect((await t.admin.query(`SELECT count(*)::int n FROM posts WHERE "authorId"=$1`, [member.id])).rows[0].n).toBe(1);
    expect(results.filter((r) => r.headers['idempotency-replayed'] === 'true').length).toBeGreaterThanOrEqual(1);
  });

  it('same key with a different payload is rejected (422)', async () => {
    const k = key();
    expect((await mc.post('/me/posts', draftBody(cat), { 'Idempotency-Key': k })).status).toBe(201);
    const r = await mc.post('/me/posts', draftBody(cat, { title: 'Khác' }), { 'Idempotency-Key': k });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('retrying submit with the same key replays the first result; parallel submits make exactly one transition', async () => {
    const d = await createDraft(mc, cat);
    const k = key();
    const rs = await Promise.all(Array.from({ length: 4 }, () => submit(mc, d.id, d.version, k)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const events = await t.admin.query(`SELECT count(*)::int n FROM review_events WHERE "postId"=$1 AND action='SUBMIT'`, [d.id]);
    expect(events.rows[0].n).toBe(1);
  });

  it('a missing Idempotency-Key is refused', async () => {
    expect((await mc.post('/me/posts', draftBody(cat))).status).toBe(400);
  });

  it('stale version → 409 with currentVersion (no silent overwrite); missing If-Match → 428', async () => {
    const d = await createDraft(mc, cat);
    const a = await mc.put(`/me/posts/${d.id}`, draftBody(cat, { title: 'Bản A' }), ifm(d.version));
    expect(a.status).toBe(200);
    const stale = await mc.put(`/me/posts/${d.id}`, draftBody(cat, { title: 'Bản B (cũ)' }), ifm(d.version));
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details.currentVersion).toBe(a.body.version);
    expect((await t.admin.query(`SELECT title FROM posts WHERE id=$1`, [d.id])).rows[0].title).toBe('Bản A');
    expect((await mc.put(`/me/posts/${d.id}`, draftBody(cat))).status).toBe(428);
  });

  it('two reviewers acting on the same version: exactly one wins, the other gets 409', async () => {
    const d = await createDraft(mc, cat);
    const s = await submit(mc, d.id, d.version);
    const collab2 = await t.makeUser({ role: 'COLLABORATOR' });
    const cc2 = await t.loginAs(collab2);
    const [r1, r2] = await Promise.all([
      cc.post(`/staff/posts/${d.id}/request-changes`, { reason: 'Lý do A' }, ifm(s.body.version)),
      cc2.post(`/staff/posts/${d.id}/request-changes`, { reason: 'Lý do B' }, ifm(s.body.version)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const n = await t.admin.query(`SELECT count(*)::int n FROM review_events WHERE "postId"=$1 AND action='REQUEST_CHANGES'`, [d.id]);
    expect(n.rows[0].n).toBe(1);
  });
});

describe('validation rules', () => {
  it('enforces title ≤ 200, content ≤ 50,000 visible chars, existing category, blank content on submit', async () => {
    expect((await mc.post('/me/posts', draftBody(cat, { title: 'a'.repeat(201) }), { 'Idempotency-Key': key() })).status).toBe(400);
    expect((await mc.post('/me/posts', draftBody(cat, { title: 'a'.repeat(200) }), { 'Idempotency-Key': key() })).status).toBe(201);
    expect((await mc.post('/me/posts', draftBody(cat, { contentHtml: `<p>${'x'.repeat(50_001)}</p>` }), { 'Idempotency-Key': key() })).status).toBe(400);
    expect((await mc.post('/me/posts', draftBody('00000000-0000-7000-8000-000000000000'), { 'Idempotency-Key': key() })).status).toBe(400);
    // draft with blank content is allowed, submit is not
    const blank = await mc.post('/me/posts', draftBody(cat, { contentHtml: '<p> </p><p><br></p>' }), { 'Idempotency-Key': key() });
    expect(blank.status).toBe(201);
    const s = await submit(mc, blank.body.id, blank.body.version);
    expect(s.status).toBe(400);
  });

  it('rejects privileged/unknown fields on every write DTO (mass assignment)', async () => {
    const r = await mc.post('/me/posts', { ...draftBody(cat), status: 'PUBLISHED', authorId: other.id }, { 'Idempotency-Key': key() });
    expect(r.status).toBe(400);
    const d = await createDraft(mc, cat);
    expect((await mc.put(`/me/posts/${d.id}`, { ...draftBody(cat), version: 99, status: 'PUBLISHED' }, ifm(d.version))).status).toBe(400);
  });

  it('keeps unicode and backslashes in content; strips scripts (stored XSS)', async () => {
    const d = await createDraft(mc, cat, { contentHtml: "<p>O'Reilly C:\\notes\\new — Đồng Tháp</p><script>alert(1)</script><img src=x onerror=alert(1)>" });
    const got = await mc.get(`/me/posts/${d.id}`);
    expect(got.body.contentHtml).toContain('C:\\notes\\new — Đồng Tháp');
    expect(got.body.contentHtml).not.toMatch(/script|onerror|alert/);
  });
});

describe('unverified e-mail', () => {
  it('can save drafts but cannot submit for review', async () => {
    const u = await t.makeUser({ role: 'MEMBER', verified: false });
    const c = await t.loginAs(u);
    const d = await createDraft(c, cat);
    const r = await submit(c, d.id, d.version);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

describe('admin MFA gate', () => {
  it('admin without a completed MFA step cannot use /admin; collaborator/member are 403', async () => {
    const noMfa = await t.makeUser({ role: 'ADMIN', mfa: false });
    const c = await t.loginAs(noMfa);
    const r = await c.get('/admin/posts');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MFA_ENROLL_REQUIRED');
    expect((await cc.get('/admin/posts')).status).toBe(403);
    expect((await mc.get('/admin/posts')).status).toBe(403);
    expect((await ac.get('/admin/posts')).status).toBe(200);
  });
});

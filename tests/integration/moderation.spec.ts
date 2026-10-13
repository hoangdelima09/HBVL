import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, insertPublished } from './support/fixtures';
import { createTestApp, type Client, type TestApp, type TestUser } from './support/app';

let t: TestApp;
let cat: string;
let admin: TestUser, collab: TestUser, collab2: TestUser, member: TestUser, member2: TestUser;
let ac: Client, cc: Client, cc2: Client, mc: Client, mc2: Client;

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
  [mc, mc2, cc, cc2, ac] = await Promise.all([t.loginAs(member), t.loginAs(member2), t.loginAs(collab), t.loginAs(collab2), t.loginAs(admin)]);
});

const v = (n: number) => ({ 'If-Match': `"${n}"` });
async function comment(c: Client, postId: string, body = 'Bình luận cần xem xét') {
  const r = await c.post(`/posts/${postId}/comments`, { body });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
async function notifiedUsers(commentId: string): Promise<string[]> {
  const r = await t.admin.query(`SELECT "userId" FROM notifications WHERE type='comment.reported' AND data->>'commentId' = $1`, [commentId]);
  return r.rows.map((x) => x.userId as string);
}

describe('collaborator handles posts (except administrator-owned ones)', () => {
  it('lists, unpublishes, republishes, deletes and restores a member post', async () => {
    const p = await insertPublished(t, { authorId: member.id, categoryId: cat });
    const list = await cc.get('/staff/posts?status=PUBLISHED');
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(p.id);

    const un = await cc.post(`/staff/posts/${p.id}/unpublish`, undefined, v(1));
    expect(un.status).toBe(200);
    expect(un.body.status).toBe('PRIVATE');
    const re = await cc.post(`/staff/posts/${p.id}/publish`, undefined, v(un.body.version));
    expect(re.status).toBe(200);
    expect(re.body.status).toBe('PUBLISHED');
    const del = await cc.delete(`/staff/posts/${p.id}`, v(re.body.version));
    expect(del.status).toBe(200);
    expect(del.body.status).toBe('TRASHED');
    expect((await mc.get(`/posts/${p.slug}`)).status).toBe(404);
    const back = await cc.post(`/staff/posts/${p.id}/restore`, undefined, v(del.body.version));
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('DRAFT');
  });

  it('rejects a pending post with a reason; a collaborator cannot review their own', async () => {
    const mine = await t.admin.query(
      `INSERT INTO posts (id, kind, slug, "authorId", status, title, "submittedAt", "updatedAt") VALUES (gen_random_uuid(),'POST','nhap-a',$1,'PENDING_REVIEW','Bài chờ',now(),now()) RETURNING id`,
      [member.id],
    );
    const bad = await cc.post(`/staff/posts/${mine.rows[0].id}/reject`, {}, v(1));
    expect(bad.status).toBe(400); // reason is mandatory
    const ok = await cc.post(`/staff/posts/${mine.rows[0].id}/reject`, { reason: 'Nội dung chưa phù hợp.' }, v(1));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('REJECTED');

    const own = await t.admin.query(
      `INSERT INTO posts (id, kind, slug, "authorId", status, title, "submittedAt", "updatedAt") VALUES (gen_random_uuid(),'POST','nhap-b',$1,'PENDING_REVIEW','Bài của CTV',now(),now()) RETURNING id`,
      [collab.id],
    );
    expect((await cc.post(`/staff/posts/${own.rows[0].id}/publish`, undefined, v(1))).status).toBe(403);
    expect((await cc.post(`/staff/posts/${own.rows[0].id}/reject`, { reason: 'x' }, v(1))).status).toBe(403);
    // another collaborator can
    expect((await cc2.post(`/staff/posts/${own.rows[0].id}/publish`, undefined, v(1))).status).toBe(200);
  });

  it('never sees or touches a post written by an administrator', async () => {
    const p = await insertPublished(t, { authorId: admin.id, categoryId: cat });
    expect((await cc.get(`/staff/posts/${p.id}`)).status).toBe(404);
    expect((await cc.delete(`/staff/posts/${p.id}`, v(1))).status).toBe(404);
    expect((await cc.post(`/staff/posts/${p.id}/unpublish`, undefined, v(1))).status).toBe(404);
    const list = await cc.get('/staff/posts');
    expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(p.id);
    // the administrator can
    expect((await ac.delete(`/staff/posts/${p.id}`, v(1))).status).toBe(200);
  });

  it("does not expose a member's private draft to collaborators; members have no staff access", async () => {
    const d = await t.admin.query(
      `INSERT INTO posts (id, kind, slug, "authorId", status, title, "updatedAt") VALUES (gen_random_uuid(),'POST','nhap-c',$1,'DRAFT','Nháp riêng',now()) RETURNING id`,
      [member.id],
    );
    expect((await cc.get(`/staff/posts/${d.rows[0].id}`)).status).toBe(404);
    expect((await cc.get('/staff/posts')).body.items).toHaveLength(0);
    expect((await mc.get('/staff/posts')).status).toBe(403);
    expect((await mc.post(`/staff/users/${member2.id}/block`, { reason: 'x' })).status).toBe(403);
    expect((await (await t.newClient()).get('/staff/reports')).status).toBe(401);
  });
});

describe('restrict and block members', () => {
  it('a restricted member can sign in and read but cannot comment, like or send feedback; lifting restores it', async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const r = await cc.post(`/staff/users/${member.id}/restrict`, { days: 7, reason: 'Bình luận gây tranh cãi.' });
    expect(r.status).toBe(200);
    const me = await mc.get('/auth/me');
    expect(me.body.user.restriction).toMatchObject({ reason: 'Bình luận gây tranh cãi.' });

    const c = await mc.post(`/posts/${p.id}/comments`, { body: 'Thử bình luận' });
    expect(c.status).toBe(403);
    expect(c.body.error.code).toBe('ACCOUNT_RESTRICTED');
    expect((await mc.put(`/posts/${p.id}/like`)).body.error.code).toBe('ACCOUNT_RESTRICTED');
    expect((await mc.post('/feedback', { subject: 'Chủ đề', message: 'Nội dung ý kiến' })).body.error.code).toBe('ACCOUNT_RESTRICTED');
    expect((await mc.get(`/posts/${p.id}/comments`)).status).toBe(200); // reading is untouched

    expect((await cc.post(`/staff/users/${member.id}/unrestrict`)).status).toBe(200);
    expect((await mc.post(`/posts/${p.id}/comments`, { body: 'Giờ được rồi' })).status).toBe(201);
  });

  it('a timed restriction ends by itself', async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    await cc.post(`/staff/users/${member.id}/restrict`, { days: 1, reason: 'Thử' });
    await t.admin.query(`UPDATE users SET "restrictedUntil" = now() - interval '1 minute' WHERE id = $1`, [member.id]);
    expect((await mc.post(`/posts/${p.id}/comments`, { body: 'Hết hạn hạn chế' })).status).toBe(201);
    expect((await mc.get('/auth/me')).body.user.restriction).toBeNull();
  });

  it('blocking signs the member out everywhere and refuses sign-in until unblocked', async () => {
    const second = await t.loginAs(member); // another device
    expect((await cc.post(`/staff/users/${member.id}/block`, { reason: 'Vi phạm nhiều lần.' })).status).toBe(200);
    expect((await mc.get('/auth/me')).body.user).toBeNull();
    expect((await second.get('/auth/me')).body.user).toBeNull();
    const again = await (await t.newClient()).post('/auth/login', { portal: 'MEMBER', identifier: member.username, password: member.password });
    expect(again.status).toBe(401);
    expect((await cc.post(`/staff/users/${member.id}/unblock`)).status).toBe(200);
    expect((await t.loginAs(member)) !== undefined).toBe(true);
  });

  it('a collaborator manages members only; the administrator manages anyone but themselves', async () => {
    expect((await cc.post(`/staff/users/${collab2.id}/restrict`, { reason: 'x' })).status).toBe(404);
    expect((await cc.post(`/staff/users/${admin.id}/block`, { reason: 'x' })).status).toBe(404);
    expect((await cc.post(`/staff/users/${collab.id}/restrict`, { reason: 'x' })).status).toBe(403); // not yourself
    const list = await cc.get('/staff/members');
    expect(list.status).toBe(200);
    const roles = new Set(list.body.items.map((i: { role: string }) => i.role));
    expect([...roles]).toEqual(['MEMBER']);
    expect(list.body.items[0].email).toBeUndefined(); // collaborators do not get e-mail addresses

    expect((await ac.post(`/staff/users/${collab2.id}/restrict`, { reason: 'Thử nghiệm' })).status).toBe(200);
    expect((await ac.post(`/staff/users/${admin.id}/block`, { reason: 'x' })).status).toBe(403);
    // every action is in the audit trail
    const a = await t.admin.query(`SELECT action FROM audit_logs WHERE action IN ('user.restrict','user.block','user.unblock','user.unrestrict')`);
    expect(a.rows.length).toBeGreaterThan(0);
  });
});

describe('reporting comments', () => {
  it('a verified member reports; every collaborator and admin is notified once; reporting twice is idempotent', async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const cid = await comment(mc2, p.id);
    const reporter = await t.makeUser();
    const rc = await t.loginAs(reporter);

    const r = await rc.post(`/comments/${cid}/report`, { reason: 'ABUSE', note: 'Xúc phạm người khác' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ reported: true, duplicate: false });
    const who = await notifiedUsers(cid);
    expect(new Set(who)).toEqual(new Set([collab.id, collab2.id, admin.id])); // not the reporter, not the author, not other members
    expect(who).toHaveLength(3);

    expect((await rc.post(`/comments/${cid}/report`, { reason: 'ABUSE' })).body.duplicate).toBe(true);
    // a second person reporting the same comment joins the open item without paging staff again
    await mc.post(`/comments/${cid}/report`, { reason: 'SPAM' });
    expect(await notifiedUsers(cid)).toHaveLength(3);
    expect((await t.admin.query(`SELECT count(*)::int n FROM comment_reports WHERE "commentId"=$1`, [cid])).rows[0].n).toBe(2);
  });

  it('rejects own comments, guests, unverified accounts and unknown / hidden comments', async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const cid = await comment(mc, p.id);
    expect((await mc.post(`/comments/${cid}/report`, { reason: 'SPAM' })).status).toBe(400);
    expect((await (await t.newClient()).post(`/comments/${cid}/report`, { reason: 'SPAM' })).status).toBe(401);
    const unverified = await t.loginAs(await t.makeUser({ verified: false }));
    expect((await unverified.post(`/comments/${cid}/report`, { reason: 'SPAM' })).body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await mc2.post(`/comments/00000000-0000-7000-8000-000000000000/report`, { reason: 'SPAM' })).status).toBe(404);
    expect((await mc2.post(`/comments/${cid}/report`, { reason: 'NOPE' })).status).toBe(400);
    expect((await mc2.post(`/comments/${cid}/report`, { reason: 'SPAM', extra: 1 })).status).toBe(400); // strict body
  });

  it('first come, first served: one staff member claims, the others see who; resolving closes it for everyone', async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const cid = await comment(mc2, p.id);
    await mc.post(`/comments/${cid}/report`, { reason: 'ABUSE' });

    const open = await cc2.get('/staff/reports?scope=open');
    expect(open.body.items).toHaveLength(1);
    expect((await cc2.get('/staff/reports/count')).body).toEqual({ open: 1 });

    expect((await cc.post(`/staff/reports/${cid}/claim`)).status).toBe(200);
    const blocked = await cc2.post(`/staff/reports/${cid}/claim`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details).toMatchObject({ reason: 'CLAIMED' });
    expect((await cc2.post(`/staff/reports/${cid}/resolve`, { action: 'DISMISS' })).status).toBe(409);
    expect((await cc2.get('/staff/reports?scope=open')).body.items[0].assignedTo.displayName).toBeTruthy();

    // the administrator may take over
    const done = await ac.post(`/staff/reports/${cid}/resolve`, { action: 'REMOVE_COMMENT', note: 'Vi phạm quy tắc.' });
    expect(done.status).toBe(200);
    expect((await t.admin.query(`SELECT status FROM comments WHERE id=$1`, [cid])).rows[0].status).toBe('TRASHED');
    expect((await cc.post(`/staff/reports/${cid}/resolve`, { action: 'REMOVE_COMMENT' })).body.error.details).toMatchObject({ reason: 'ALREADY_HANDLED' });
    expect((await cc2.get('/staff/reports?scope=open')).body.items).toHaveLength(0);
    const closed = await cc2.get('/staff/reports?scope=closed');
    expect(closed.body.items[0]).toMatchObject({ status: 'RESOLVED', resolution: 'REMOVE_COMMENT', handledBy: { displayName: expect.any(String) } });
    // everybody's unread alert for it is cleared, and the author is told
    const unread = await t.admin.query(`SELECT count(*)::int n FROM notifications WHERE type='comment.reported' AND "readAt" IS NULL`);
    expect(unread.rows[0].n).toBe(0);
    expect((await t.admin.query(`SELECT count(*)::int n FROM notifications WHERE type='comment.removed' AND "userId"=$1`, [member2.id])).rows[0].n).toBe(1);
    expect((await mc2.get(`/posts/${p.id}/comments`)).body.items).toHaveLength(0);
  });

  it('two staff members acting at the same instant: exactly one action is applied', async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const cid = await comment(mc2, p.id);
    await mc.post(`/comments/${cid}/report`, { reason: 'SPAM' });
    const [a, b] = await Promise.all([cc.post(`/staff/reports/${cid}/resolve`, { action: 'REMOVE_COMMENT' }), cc2.post(`/staff/reports/${cid}/resolve`, { action: 'DISMISS' })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const audits = await t.admin.query(`SELECT count(*)::int n FROM audit_logs WHERE action='comment.report.resolve' AND "resourceId"=$1`, [cid]);
    expect(audits.rows[0].n).toBe(1);
  });

  it('dismissing keeps the comment; removing + restricting acts on the author in the same step', async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const c1 = await comment(mc2, p.id, 'Bình luận bị tố cáo nhầm');
    await mc.post(`/comments/${c1}/report`, { reason: 'OTHER' });
    expect((await cc.post(`/staff/reports/${c1}/resolve`, { action: 'DISMISS' })).status).toBe(200);
    expect((await t.admin.query(`SELECT status FROM comments WHERE id=$1`, [c1])).rows[0].status).toBe('APPROVED');
    expect((await t.admin.query(`SELECT status FROM comment_reports WHERE "commentId"=$1`, [c1])).rows[0].status).toBe('DISMISSED');

    const c2 = await comment(mc2, p.id, 'Bình luận vi phạm nặng');
    await mc.post(`/comments/${c2}/report`, { reason: 'HATE' });
    const r = await cc.post(`/staff/reports/${c2}/resolve`, { action: 'REMOVE_AND_RESTRICT', days: 3, note: 'Phát ngôn thù ghét.' });
    expect(r.status).toBe(200);
    expect((await t.admin.query(`SELECT status FROM comments WHERE id=$1`, [c2])).rows[0].status).toBe('TRASHED');
    const u = await t.admin.query(`SELECT "restrictedAt", "restrictedUntil", "restrictionReason" FROM users WHERE id=$1`, [member2.id]);
    expect(u.rows[0].restrictedAt).not.toBeNull();
    expect(u.rows[0].restrictionReason).toBe('Phát ngôn thù ghét.');
    expect((await mc2.post(`/posts/${p.id}/comments`, { body: 'Thử lại' })).body.error.code).toBe('ACCOUNT_RESTRICTED');

    const c3 = await insertPublished(t, { authorId: member.id, categoryId: cat });
    const m3 = await t.makeUser();
    const m3c = await t.loginAs(m3);
    const c3id = await comment(m3c, c3.id, 'Spam liên tục');
    await mc.post(`/comments/${c3id}/report`, { reason: 'SPAM' });
    expect((await cc.post(`/staff/reports/${c3id}/resolve`, { action: 'REMOVE_AND_BLOCK', note: 'Spam.' })).status).toBe(200);
    expect((await m3c.get('/auth/me')).body.user).toBeNull();
  });

  it("a collaborator cannot punish another collaborator's account, and nothing is half-applied", async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const cid = await comment(cc2, p.id, 'Bình luận của CTV khác');
    await mc.post(`/comments/${cid}/report`, { reason: 'ABUSE' });
    const r = await cc.post(`/staff/reports/${cid}/resolve`, { action: 'REMOVE_AND_BLOCK' });
    expect(r.status).toBe(404);
    expect((await t.admin.query(`SELECT status FROM comments WHERE id=$1`, [cid])).rows[0].status).toBe('APPROVED'); // rolled back
    expect((await t.admin.query(`SELECT status FROM users WHERE id=$1`, [collab2.id])).rows[0].status).toBe('ACTIVE');
    // removing just the comment is allowed
    expect((await cc.post(`/staff/reports/${cid}/resolve`, { action: 'REMOVE_COMMENT' })).status).toBe(200);
    // and the administrator can do the whole thing
    const cid2 = await comment(cc2, p.id, 'Lại một bình luận');
    await mc.post(`/comments/${cid2}/report`, { reason: 'ABUSE' });
    expect((await ac.post(`/staff/reports/${cid2}/resolve`, { action: 'REMOVE_AND_RESTRICT', days: 1, note: 'Thử' })).status).toBe(200);
  });

  it("reports about an administrator's comment are hidden from collaborators and handled by the administrator alone", async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const admin2 = await t.makeUser({ role: 'ADMIN', mfa: true }); // the author is never paged about their own comment
    const ac2 = await t.loginAs(admin2);
    const cid = await comment(ac, p.id, 'Bình luận của quản trị viên');
    await mc.post(`/comments/${cid}/report`, { reason: 'MISINFO' });
    expect(await notifiedUsers(cid)).toEqual([admin2.id]); // collaborators are not even told
    expect((await cc.get('/staff/reports?scope=open')).body.items).toHaveLength(0);
    expect((await cc.get('/staff/reports/count')).body).toEqual({ open: 0 });
    expect((await cc.post(`/staff/reports/${cid}/claim`)).status).toBe(404);
    expect((await cc.post(`/staff/reports/${cid}/resolve`, { action: 'REMOVE_COMMENT' })).status).toBe(404);
    expect((await ac2.get('/staff/reports?scope=open')).body.items).toHaveLength(1);
    expect((await ac2.post(`/staff/reports/${cid}/resolve`, { action: 'DISMISS' })).status).toBe(200);
  });

  it('taking the comment down from the comment screen settles its open reports', async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const cid = await comment(mc2, p.id);
    await mc.post(`/comments/${cid}/report`, { reason: 'SPAM' });
    expect((await cc.patch(`/staff/comments/${cid}`, { status: 'TRASHED' })).status).toBe(200);
    expect((await cc2.get('/staff/reports?scope=open')).body.items).toHaveLength(0);
    expect((await cc2.get('/staff/reports?scope=closed')).body.items[0].resolution).toBe('REMOVE_COMMENT');
  });

  it("the dashboards count open reports per comment, and a collaborator's count leaves out the administrator's", async () => {
    const p = await insertPublished(t, { authorId: member2.id, categoryId: cat });
    const c1 = await comment(mc2, p.id);
    const c2 = await comment(ac, p.id, 'Của quản trị viên');
    await mc.post(`/comments/${c1}/report`, { reason: 'SPAM' });
    await t
      .makeUser()
      .then((u) => t.loginAs(u))
      .then((c) => c.post(`/comments/${c1}/report`, { reason: 'ABUSE' }));
    await mc.post(`/comments/${c2}/report`, { reason: 'SPAM' });
    expect((await cc.get('/staff/dashboard')).body.openReports).toBe(1);
    expect((await ac.get('/staff/dashboard')).body.openReports).toBe(2);
    expect((await ac.get('/admin/dashboard')).body.openReports).toBe(2);
  });
});

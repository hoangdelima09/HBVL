import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, insertPublished } from './support/fixtures';
import { createTestApp, type Client, type TestApp, type TestUser } from './support/app';

let t: TestApp;
let cat: string;
let author: TestUser, other: TestUser, collab: TestUser, admin: TestUser;
let au: Client, ot: Client, cc: Client, ac: Client;
let post: { id: string; slug: string };

beforeAll(async () => {
  t = await createTestApp();
  cat = await categoryId(t, 'chuyen-vuon-len');
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  author = await t.makeUser();
  other = await t.makeUser();
  collab = await t.makeUser({ role: 'COLLABORATOR' });
  admin = await t.makeUser({ role: 'ADMIN', mfa: true });
  [au, ot, cc, ac] = await Promise.all([t.loginAs(author), t.loginAs(other), t.loginAs(collab), t.loginAs(admin)]);
  post = await insertPublished(t, { authorId: other.id, categoryId: cat });
});

async function comment(c: Client, body = 'Bình luận ban đầu', parentId?: string) {
  const r = await c.post(`/posts/${post.id}/comments`, { body, ...(parentId ? { parentId } : {}) });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
const list = async (c: Client) => (await c.get(`/posts/${post.id}/comments`)).body.items as Record<string, unknown>[];

describe('editing a comment', () => {
  it('only the author can edit; everyone sees "edited" and can read every earlier version', async () => {
    const id = await comment(au, 'Bản đầu tiên');
    const e1 = await au.patch(`/comments/${id}`, { body: 'Bản thứ hai' });
    expect(e1.status).toBe(200);
    expect(e1.body).toMatchObject({ body: 'Bản thứ hai', editCount: 1, status: 'APPROVED' });
    await au.patch(`/comments/${id}`, { body: 'Bản cuối cùng' });

    // a guest sees the current text, the edited marker and the full history
    const guest = await t.newClient();
    const [row] = await list(guest);
    expect(row).toMatchObject({ id, body: 'Bản cuối cùng', editCount: 2, mine: false, canEdit: false, canDelete: false });
    expect(row!.editedAt).toBeTruthy();
    expect(row!.authorId).toBeUndefined(); // ids are never published
    const h = await guest.get(`/comments/${id}/revisions`);
    expect(h.status).toBe(200);
    expect(h.body.current.body).toBe('Bản cuối cùng');
    expect(h.body.items.map((x: { body: string }) => x.body)).toEqual(['Bản thứ hai', 'Bản đầu tiên']); // newest first

    // the author sees their own controls
    expect((await list(au))[0]).toMatchObject({ mine: true, canEdit: true, canDelete: true });
    // others cannot edit — not even staff (moderators remove, they never rewrite someone's words)
    for (const c of [ot, cc, ac]) expect((await c.patch(`/comments/${id}`, { body: 'Sửa trộm' })).status).toBe(403);
    expect((await (await t.newClient()).patch(`/comments/${id}`, { body: 'x' })).status).toBe(401);
    expect((await list(guest))[0]!.body).toBe('Bản cuối cùng');
  });

  it('validates input, ignores no-op edits, caps the number of edits and keeps every version on concurrent edits', async () => {
    const id = await comment(au, 'Giữ nguyên');
    expect((await au.patch(`/comments/${id}`, { body: '   ' })).status).toBe(400);
    expect((await au.patch(`/comments/${id}`, { body: 'x'.repeat(5001) })).status).toBe(400);
    expect((await au.patch(`/comments/${id}`, { body: 'ok', status: 'APPROVED' })).status).toBe(400); // strict body
    const same = await au.patch(`/comments/${id}`, { body: 'Giữ nguyên' });
    expect(same.body.editCount).toBe(0); // unchanged text is not a revision

    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => au.patch(`/comments/${id}`, { body: `Song song ${i}` })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const n = (await t.admin.query(`SELECT "editCount", (SELECT count(*)::int FROM comment_revisions WHERE "commentId"=$1) AS revs FROM comments WHERE id=$1`, [id])).rows[0];
    expect(n.editCount).toBe(5);
    expect(n.revs).toBe(5); // no version lost

    await t.admin.query(`UPDATE comments SET "editCount" = 20 WHERE id = $1`, [id]);
    expect((await au.patch(`/comments/${id}`, { body: 'Lần thứ 21' })).status).toBe(409);
  });

  it('an edit that looks like spam is taken off the page; edits are refused when comments are closed or the account is restricted', async () => {
    const id = await comment(au, 'Bình thường');
    const spam = await au.patch(`/comments/${id}`, { body: 'http://a.x http://b.x http://c.x http://d.x' });
    expect(spam.body).toMatchObject({ status: 'SPAM', awaitingModeration: true });
    expect(await list(await t.newClient())).toHaveLength(0);

    const id2 = await comment(au, 'Thứ hai');
    await t.admin.query(`UPDATE posts SET "commentsOpen" = false WHERE id = $1`, [post.id]);
    expect((await au.patch(`/comments/${id2}`, { body: 'Sửa khi đã đóng' })).status).toBe(403);
    expect((await list(au))[0]).toMatchObject({ canEdit: false, canDelete: true });
    await t.admin.query(`UPDATE posts SET "commentsOpen" = true WHERE id = $1`, [post.id]);

    await cc.post(`/staff/users/${author.id}/restrict`, { reason: 'Thử' });
    expect((await au.patch(`/comments/${id2}`, { body: 'Bị hạn chế' })).body.error.code).toBe('ACCOUNT_RESTRICTED');
    expect((await au.delete(`/comments/${id2}`)).status).toBe(200); // deleting your own words is always allowed
  });

  it('is audited', async () => {
    const id = await comment(au);
    await au.patch(`/comments/${id}`, { body: 'Đã sửa' });
    await au.delete(`/comments/${id}`);
    const a = await t.admin.query(`SELECT action FROM audit_logs WHERE "resourceId"=$1 ORDER BY id`, [id]);
    expect(a.rows.map((r) => r.action)).toEqual(['comment.edit', 'comment.delete_own']);
  });
});

describe('deleting a comment', () => {
  it('the author deletes; a comment with replies stays as an empty placeholder, one without disappears', async () => {
    const parent = await comment(au, 'Câu hỏi của tôi');
    await comment(ot, 'Câu trả lời', parent);
    const lonely = await comment(au, 'Không ai trả lời');
    expect((await au.delete(`/comments/${parent}`)).status).toBe(200);
    expect((await au.delete(`/comments/${lonely}`)).status).toBe(200);
    expect((await au.delete(`/comments/${lonely}`)).status).toBe(404); // already gone

    const rows = await list(await t.newClient());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: parent, deleted: true, body: '', author: '', canDelete: false });
    expect(rows[1]).toMatchObject({ body: 'Câu trả lời', deleted: false });
    expect((await (await t.newClient()).get(`/comments/${parent}/revisions`)).status).toBe(404); // history of deleted text is not public
    expect((await au.patch(`/comments/${parent}`, { body: 'Hồi sinh' })).status).toBe(404);
  });

  it('others cannot delete; staff can from the page (collaborators not an administrator’s comment)', async () => {
    const mine = await comment(au);
    expect((await ot.delete(`/comments/${mine}`)).status).toBe(403);
    expect((await list(cc)).find((r) => r.id === mine)).toMatchObject({ canDelete: true, canEdit: false, mine: false });
    expect((await cc.delete(`/comments/${mine}`)).status).toBe(200);

    const adminComment = await comment(ac, 'Bình luận của quản trị viên');
    expect((await list(cc)).find((r) => r.id === adminComment)).toMatchObject({ canDelete: false });
    expect((await cc.delete(`/comments/${adminComment}`)).status).toBe(403);
    expect((await ac.delete(`/comments/${adminComment}`)).status).toBe(200);
  });

  it('deleting your reported comment closes its reports and clears the staff alerts', async () => {
    const id = await comment(au, 'Lời lẽ khó nghe');
    await ot.post(`/comments/${id}/report`, { reason: 'ABUSE' });
    expect((await cc.get('/staff/reports/count')).body.open).toBe(1);
    await au.delete(`/comments/${id}`);
    expect((await cc.get('/staff/reports/count')).body.open).toBe(0);
    expect((await cc.get('/staff/reports?scope=closed')).body.items[0]).toMatchObject({ resolution: 'AUTHOR_DELETED' });
    expect((await t.admin.query(`SELECT count(*)::int n FROM notifications WHERE type='comment.reported' AND "readAt" IS NULL`)).rows[0].n).toBe(0);
  });

  it('staff see what a reported comment said before it was edited', async () => {
    const id = await comment(au, 'Câu xúc phạm ban đầu');
    await ot.post(`/comments/${id}/report`, { reason: 'ABUSE' });
    await au.patch(`/comments/${id}`, { body: 'Câu đã được sửa cho nhẹ nhàng' });
    const item = (await cc.get('/staff/reports?scope=open')).body.items[0];
    expect(item.comment).toMatchObject({ body: 'Câu đã được sửa cho nhẹ nhàng', editCount: 1 });
    expect(item.comment.revisions[0].body).toBe('Câu xúc phạm ban đầu');
  });
});

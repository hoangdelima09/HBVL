import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, insertPublished } from './support/fixtures';
import { createTestApp, type Client, type TestApp, type TestUser } from './support/app';

let t: TestApp;
let cat: string;
let admin: TestUser, collab: TestUser, member: TestUser;
let ac: Client, cc: Client, mc: Client;
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
  member = await t.makeUser({ role: 'MEMBER' });
  collab = await t.makeUser({ role: 'COLLABORATOR' });
  admin = await t.makeUser({ role: 'ADMIN', mfa: true });
  [mc, cc, ac] = await Promise.all([t.loginAs(member), t.loginAs(collab), t.loginAs(admin)]);
  post = await insertPublished(t, { authorId: member.id, categoryId: cat, legacyLikes: 7 });
});

describe('likes', () => {
  it('require login + verified e-mail; PUT/DELETE are idempotent; legacy total is preserved', async () => {
    const anon = await t.newClient();
    expect((await anon.put(`/posts/${post.id}/like`)).status).toBe(401);
    const unverified = await t.loginAs(await t.makeUser({ verified: false }));
    const uv = await unverified.put(`/posts/${post.id}/like`);
    expect(uv.status).toBe(403);
    expect(uv.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const a = await mc.put(`/posts/${post.id}/like`);
    expect(a.body).toEqual({ likes: 8, likedByMe: true }); // 7 legacy + 1
    const b = await mc.put(`/posts/${post.id}/like`); // retry
    expect(b.body).toEqual({ likes: 8, likedByMe: true });
    expect((await mc.get(`/posts/${post.id}/engagement`)).body).toMatchObject({ likes: 8, likedByMe: true });
    // another device/session of the same account sees the same state (state is per account, not per cookie)
    const second = await t.loginAs(member);
    expect((await second.get(`/posts/${post.id}/engagement`)).body.likedByMe).toBe(true);
    expect((await mc.delete(`/posts/${post.id}/like`)).body).toEqual({ likes: 7, likedByMe: false });
    expect((await mc.delete(`/posts/${post.id}/like`)).body).toEqual({ likes: 7, likedByMe: false }); // never below legacy, never negative
    expect((await t.admin.query(`SELECT "likeCount" FROM posts WHERE id=$1`, [post.id])).rows[0].likeCount).toBe(0);
  });

  it('concurrent likes from many users: counter equals unique rows; double-submit does not drift', async () => {
    const users = await Promise.all(Array.from({ length: 12 }, () => t.makeUser()));
    const clients = await Promise.all(users.map((u) => t.loginAs(u)));
    await Promise.all(clients.flatMap((c) => [c.put(`/posts/${post.id}/like`), c.put(`/posts/${post.id}/like`)]));
    const rows = await t.admin.query(`SELECT (SELECT count(*)::int FROM post_likes WHERE "postId"=$1) AS n, "likeCount" FROM posts WHERE id=$1`, [post.id]);
    expect(rows.rows[0].n).toBe(12);
    expect(rows.rows[0].likeCount).toBe(12);
    await Promise.all(clients.flatMap((c) => [c.delete(`/posts/${post.id}/like`), c.delete(`/posts/${post.id}/like`)]));
    const after = await t.admin.query(`SELECT "likeCount" FROM posts WHERE id=$1`, [post.id]);
    expect(after.rows[0].likeCount).toBe(0);
  });

  it('only published posts can be liked (draft, private, unknown id, contact/feedback ids → 404)', async () => {
    const draft = await t.admin.query(
      `INSERT INTO posts (id, kind, slug, "authorId", status, title, "updatedAt") VALUES (gen_random_uuid(),'POST','nhap-1',$1,'DRAFT','Nháp',now()) RETURNING id`,
      [member.id],
    );
    expect((await mc.put(`/posts/${draft.rows[0].id}/like`)).status).toBe(404);
    expect((await mc.put(`/posts/00000000-0000-7000-8000-000000000000/like`)).status).toBe(404);
    const f = await t.admin.query(`INSERT INTO feedbacks (id, "authorId", subject, message, "updatedAt") VALUES (gen_random_uuid(), $1, 's', 'm', now()) RETURNING id`, [
      member.id,
    ]);
    expect((await mc.put(`/posts/${f.rows[0].id}/like`)).status).toBe(404);
  });
});

describe('comments', () => {
  it('guests are blocked; all authenticated website roles are auto-approved', async () => {
    const anon = await t.newClient();
    expect((await anon.post(`/posts/${post.id}/comments`, { body: 'Xin chào' })).status).toBe(401);
    for (const c of [mc, cc, ac]) {
      const r = await c.post(`/posts/${post.id}/comments`, { body: `Bình luận của ${Math.random()}` });
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('APPROVED');
    }
    expect((await anon.get(`/posts/${post.id}/comments`)).body.items).toHaveLength(3);
  });

  it('spam is kept out (auto-approve never overrides a spam decision)', async () => {
    const r = await mc.post(`/posts/${post.id}/comments`, { body: 'http://a.test http://b.test http://c.test http://d.test mua ngay' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('SPAM');
    expect(r.body.awaitingModeration).toBe(true);
    const anon = await t.newClient();
    expect((await anon.get(`/posts/${post.id}/comments`)).body.items).toHaveLength(0);
    const first = await mc.post(`/posts/${post.id}/comments`, { body: 'Cảm ơn bài viết' });
    const dupe = await mc.post(`/posts/${post.id}/comments`, { body: 'Cảm ơn bài viết' });
    expect([first.body.status, dupe.body.status]).toEqual(['APPROVED', 'SPAM']);
  });

  it('threads: parent must belong to the same post; depth is bounded; closed comments are refused', async () => {
    const other = await insertPublished(t, { authorId: member.id, categoryId: cat, slug: 'bai-khac' });
    const root = await mc.post(`/posts/${post.id}/comments`, { body: 'Gốc' });
    const foreign = await mc.post(`/posts/${other.id}/comments`, { body: 'Trả lời nhầm bài', parentId: root.body.id });
    expect(foreign.status).toBe(400);
    let parent = root.body.id as string;
    for (let d = 1; d <= 4; d++) {
      const r = await mc.post(`/posts/${post.id}/comments`, { body: `Cấp ${d}`, parentId: parent });
      expect(r.status).toBe(201);
      expect(r.body.depth).toBe(d);
      parent = r.body.id;
    }
    expect((await mc.post(`/posts/${post.id}/comments`, { body: 'Quá sâu', parentId: parent })).status).toBe(400);
    const closed = await insertPublished(t, { authorId: member.id, categoryId: cat, slug: 'bai-dong', commentsOpen: false });
    expect((await mc.post(`/posts/${closed.id}/comments`, { body: 'x' })).status).toBe(403);
    expect((await mc.post(`/posts/${post.id}/comments`, { body: 'a'.repeat(5001) })).status).toBe(400);
  });

  it('moderation: collaborator can moderate member comments but not admin comments; member cannot moderate', async () => {
    const mcmt = await mc.post(`/posts/${post.id}/comments`, { body: 'Từ thành viên' });
    const acmt = await ac.post(`/posts/${post.id}/comments`, { body: 'Từ quản trị viên' });
    expect((await cc.patch(`/staff/comments/${mcmt.body.id}`, { status: 'TRASHED' })).status).toBe(200);
    const blocked = await cc.patch(`/staff/comments/${acmt.body.id}`, { status: 'TRASHED' });
    expect(blocked.status).toBe(403);
    expect((await t.admin.query(`SELECT status FROM comments WHERE id=$1`, [acmt.body.id])).rows[0].status).toBe('APPROVED');
    expect((await mc.patch(`/staff/comments/${mcmt.body.id}`, { status: 'APPROVED' })).status).toBe(403);
    expect((await mc.get('/staff/comments')).status).toBe(403);
    expect((await ac.patch(`/staff/comments/${acmt.body.id}`, { status: 'SPAM' })).status).toBe(200);
  });
});
